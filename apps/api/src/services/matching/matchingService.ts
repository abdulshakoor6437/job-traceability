import crypto from 'crypto';
import { matchingDal, UserJobMatchRow } from '../../dal/matchingDal';
import { cvDal } from '../../dal/cvDal';
import { EmbeddingService } from './embeddingService';
import { GeminiEmbeddingProvider } from './providers/geminiEmbeddingProvider';
import { MockEmbeddingProvider } from './providers/mockEmbeddingProvider';
import { IEmbeddingProvider, MatchSearchParams, MatchSearchResult, ScoredJobMatch } from './types';
import { computeCosineSimilarity, convertCosineToScore, getMatchLabel } from './cosineSimilarity';
import { screenJobDescription } from './redFlagFilter';
import { defaultFitExplanationService, FitExplanationService } from './fitExplanationService';
import { MATCHING_CONFIG } from './matchingConfig';

export class MatchingService {
  private embeddingProvider: IEmbeddingProvider;
  private embeddingService: EmbeddingService;
  private fitExplanationService: FitExplanationService;

  constructor(options?: {
    embeddingProvider?: IEmbeddingProvider;
    embeddingService?: EmbeddingService;
    fitExplanationService?: FitExplanationService;
  }) {
    this.embeddingProvider =
      options?.embeddingProvider ||
      (process.env.GEMINI_API_KEY ? new GeminiEmbeddingProvider() : new MockEmbeddingProvider());
    this.embeddingService =
      options?.embeddingService || new EmbeddingService(this.embeddingProvider);
    this.fitExplanationService = options?.fitExplanationService || defaultFitExplanationService;
  }

  /**
   * Set custom provider dynamically (e.g. for testing or isolated environments)
   */
  setProviders(params: {
    embeddingProvider?: IEmbeddingProvider;
    fitExplanationService?: FitExplanationService;
  }) {
    if (params.embeddingProvider) {
      this.embeddingProvider = params.embeddingProvider;
    }
    if (params.fitExplanationService) {
      this.fitExplanationService = params.fitExplanationService;
    }
  }

  /**
   * Generates a deterministic hash representing search filters
   */
  private computeFiltersHash(filters: MatchSearchParams): string {
    const canonical = {
      location: (filters.location || '').trim().toLowerCase(),
      remoteOnly: Boolean(filters.remoteOnly),
      minScore: filters.minScore !== undefined ? filters.minScore : MATCHING_CONFIG.defaultMinScore,
      includeExcluded: Boolean(filters.includeExcluded),
    };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').substring(0, 32);
  }

  /**
   * Map UserJobMatchRow to ScoredJobMatch domain model
   */
  private mapRowToScoredMatch(r: UserJobMatchRow): ScoredJobMatch {
    return {
      jobId: r.job_id,
      title: r.title || '',
      company: r.company || '',
      location: r.location || null,
      remote: Boolean(r.remote),
      salaryMin: r.salary_min !== null && r.salary_min !== undefined ? Number(r.salary_min) : null,
      salaryMax: r.salary_max !== null && r.salary_max !== undefined ? Number(r.salary_max) : null,
      salaryCurrency: r.salary_currency || null,
      description: r.description || null,
      applyUrl: r.apply_url || null,
      score: Number(r.score),
      label: r.label as any,
      isExcluded: Boolean(r.is_excluded),
      excludedReason: r.excluded_reason || null,
      explanation: r.explanation || null,
      rankOrder: r.rank_order,
    };
  }

  /**
   * Main matching & search method.
   * Cross-user isolated via authenticated userId.
   */
  async searchMatches(
    userId: string,
    filters: MatchSearchParams = {},
    options: { forceRefresh?: boolean } = {}
  ): Promise<MatchSearchResult> {
    if (!userId) {
      throw new Error('Authentication required: userId is missing');
    }

    // 1. Retrieve user's active CV profile (ensures cross-user isolation: User A cannot access User B's profile)
    const activeCv = await cvDal.getActiveProfile(userId);
    if (!activeCv) {
      throw new Error('No active CV profile found for this user. Please upload or activate a CV first.');
    }

    const cvProfileId = (activeCv as any).id || (activeCv as any).profile?.id;
    if (!cvProfileId) {
      throw new Error('Active CV profile ID could not be determined.');
    }
    const cvSummary = (activeCv as any).summary || (activeCv as any).profile?.summary || '';
    const cvSkills = (activeCv as any).skills || [];
    const cvWorkHistory = (activeCv as any).workHistory || [];

    const minScore = filters.minScore !== undefined ? filters.minScore : MATCHING_CONFIG.defaultMinScore;
    const includeExcluded = Boolean(filters.includeExcluded);
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 50;

    // 2. Check current job pool version
    const jobPoolVersion = await matchingDal.getJobPoolVersion();
    const filtersHash = this.computeFiltersHash(filters);

    // 3. Cache Check: avoid recomputing embeddings / LLM calls if active CV & job pool have not changed
    if (!options.forceRefresh) {
      const existingCache = await matchingDal.getUserMatchCache(
        userId,
        cvProfileId,
        jobPoolVersion,
        filtersHash
      );

      if (existingCache) {
        const cachedRows = await matchingDal.getUserJobMatches(userId, existingCache.id, {
          includeExcluded,
          minScore,
        });

        // Filter in-memory for optional secondary attributes like location and remote
        let filteredMatches = cachedRows.map((r) => this.mapRowToScoredMatch(r));

        if (filters.location && filters.location.trim()) {
          const locLower = filters.location.trim().toLowerCase();
          filteredMatches = filteredMatches.filter((m) =>
            m.location ? m.location.toLowerCase().includes(locLower) : false
          );
        }

        if (filters.remoteOnly) {
          filteredMatches = filteredMatches.filter((m) => m.remote);
        }

        return {
          matches: filteredMatches.slice(0, limit),
          totalMatches: filteredMatches.length,
          fromCache: true,
          cacheId: existingCache.id,
          jobPoolVersion,
          cvProfileId,
        };
      }
    }

    // 4. Cache Miss or Force Refresh: Generate / Retrieve Active CV Embedding
    const cvVector = await this.embeddingService.ensureCvProfileEmbedding(
      userId,
      cvProfileId,
      {
        summary: cvSummary,
        skills: cvSkills,
        workHistory: cvWorkHistory,
      }
    );

    // 5. Retrieve all cached jobs
    const cachedJobs = await matchingDal.getCachedJobsWithEmbeddings();
    const candidateMatches: ScoredJobMatch[] = [];

    // Extract CV skills array and summary for fit explanations
    const cvSkillNames: string[] = cvSkills.map((s: any) =>
      typeof s === 'string' ? s : s.skill_name || ''
    ).filter(Boolean);

    // 6. Score each candidate job
    for (const job of cachedJobs) {
      let jobVector = job.embeddingVector;

      // Acceptance Test (g): Missing or failed job embedding must be handled gracefully without crashing
      if (!jobVector || jobVector.length === 0) {
        try {
          jobVector = await this.embeddingService.ensureJobEmbedding(job, this.embeddingProvider);
        } catch (err: any) {
          console.warn(`[MATCHING WARNING] Gracefully skipping job ${job.id} ("${job.title}") due to missing/failed embedding: ${err.message}`);
          continue; // Gracefully skip without crashing
        }
      }

      if (!jobVector || jobVector.length === 0) {
        console.warn(`[MATCHING WARNING] Gracefully skipping job ${job.id} ("${job.title}"): embedding vector is empty.`);
        continue;
      }

      // Check red-flag filter (Item 3)
      const screenResult = screenJobDescription(job.description || '');

      // Compute Cosine Similarity & Score (Item 2)
      const similarity = computeCosineSimilarity(cvVector, jobVector);
      const score = convertCosineToScore(similarity);
      const label = getMatchLabel(score);

      // LLM Fit Explanation (Item 4):
      // Only generate explanation if score >= threshold and not excluded
      let explanation: string | null = null;
      if (!screenResult.isExcluded && score >= this.fitExplanationService.getThreshold()) {
        const explainResult = await this.fitExplanationService.explainIfEligible({
          score,
          cvSummary,
          cvSkills: cvSkillNames,
          jobTitle: job.title,
          jobDescription: job.description || '',
        });
        explanation = explainResult.explanation;
      }

      candidateMatches.push({
        jobId: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        remote: job.remote,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        description: job.description,
        applyUrl: job.applyUrl,
        score,
        label,
        isExcluded: screenResult.isExcluded,
        excludedReason: screenResult.excludedReason,
        explanation,
        rankOrder: 0, // Assigned after sorting
      });
    }

    // 7. Sort candidate matches descending by score
    candidateMatches.sort((a, b) => b.score - a.score);
    candidateMatches.forEach((m, idx) => {
      m.rankOrder = idx + 1;
    });

    // 8. Persist to database cache (Item 6)
    const cacheItems = candidateMatches.map((m) => ({
      jobId: m.jobId,
      score: m.score,
      label: m.label,
      isExcluded: m.isExcluded,
      excludedReason: m.excludedReason,
      explanation: m.explanation,
      rankOrder: m.rankOrder,
    }));

    const newCacheId = await matchingDal.saveUserMatches({
      userId,
      cvProfileId,
      jobPoolVersion,
      filtersHash,
      matches: cacheItems,
    });

    // 9. Apply View Filters
    let finalMatches = candidateMatches;

    if (!includeExcluded) {
      finalMatches = finalMatches.filter((m) => !m.isExcluded && m.score >= minScore);
    } else {
      if (minScore > 0) {
        finalMatches = finalMatches.filter((m) => m.score >= minScore);
      }
    }

    if (filters.location && filters.location.trim()) {
      const locLower = filters.location.trim().toLowerCase();
      finalMatches = finalMatches.filter((m) =>
        m.location ? m.location.toLowerCase().includes(locLower) : false
      );
    }

    if (filters.remoteOnly) {
      finalMatches = finalMatches.filter((m) => m.remote);
    }

    const totalMatches = finalMatches.length;
    const paginatedMatches = finalMatches.slice(0, limit);

    return {
      matches: paginatedMatches,
      totalMatches,
      fromCache: false,
      cacheId: newCacheId,
      jobPoolVersion,
      cvProfileId,
    };
  }
}

export const matchingService = new MatchingService();
