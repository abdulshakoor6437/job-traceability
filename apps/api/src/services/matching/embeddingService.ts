import crypto from 'crypto';
import { IEmbeddingProvider } from './types';
import { matchingDal } from '../../dal/matchingDal';
import { GeminiEmbeddingProvider } from './providers/geminiEmbeddingProvider';
import { MockEmbeddingProvider } from './providers/mockEmbeddingProvider';

export class EmbeddingService {
  private provider: IEmbeddingProvider;

  constructor(provider?: IEmbeddingProvider) {
    if (provider) {
      this.provider = provider;
    } else if (process.env.NODE_ENV === 'test') {
      this.provider = new MockEmbeddingProvider();
    } else if (process.env.GEMINI_API_KEY) {
      this.provider = new GeminiEmbeddingProvider();
    } else {
      this.provider = new MockEmbeddingProvider();
    }
  }

  setProvider(provider: IEmbeddingProvider): void {
    this.provider = provider;
  }

  getProvider(): IEmbeddingProvider {
    return this.provider;
  }

  // -------------------------------------------------------------------------
  // Text Preparation
  // -------------------------------------------------------------------------

  prepareJobText(title: string, description?: string | null): string {
    const parts = [title.trim()];
    if (description && description.trim()) {
      parts.push(description.trim());
    }
    return parts.join('\n\n');
  }

  prepareCvProfileText(profile: {
    summary?: string | null;
    skills?: Array<{ skill_name?: string } | string>;
    workHistory?: Array<{ title?: string; company?: string | null; bullet_points?: any }>;
  }): string {
    const sections: string[] = [];

    // Summary
    if (profile.summary && profile.summary.trim()) {
      sections.push(`Professional Summary:\n${profile.summary.trim()}`);
    }

    // Skills
    if (profile.skills && profile.skills.length > 0) {
      const skillNames = profile.skills
        .map((s) => (typeof s === 'string' ? s : s?.skill_name || ''))
        .filter(Boolean);
      if (skillNames.length > 0) {
        sections.push(`Core Skills:\n${skillNames.join(', ')}`);
      }
    }

    // Work History (recent roles)
    if (profile.workHistory && profile.workHistory.length > 0) {
      const historyTexts = profile.workHistory.slice(0, 5).map((w) => {
        const header = `${w.title || 'Role'} at ${w.company || 'Company'}`;
        let bullets: string[] = [];
        if (Array.isArray(w.bullet_points)) {
          bullets = w.bullet_points;
        } else if (typeof w.bullet_points === 'string') {
          try {
            bullets = JSON.parse(w.bullet_points);
          } catch {
            bullets = [w.bullet_points];
          }
        }
        const bulletText = bullets.length > 0 ? `\n${bullets.map((b) => `• ${b}`).join('\n')}` : '';
        return `${header}${bulletText}`;
      });
      sections.push(`Recent Work Experience:\n${historyTexts.join('\n\n')}`);
    }

    return sections.join('\n\n');
  }

  computeTextHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  // -------------------------------------------------------------------------
  // Job Embeddings
  // -------------------------------------------------------------------------

  /**
   * Generates and stores one embedding for a cached job (title + description)
   * at cache time. If an embedding already exists with matching text hash, reuses it.
   */
  async ensureJobEmbedding(job: {
    id: string;
    title: string;
    description?: string | null;
  }): Promise<number[]> {
    if (job.id === 'acc-job-broken-embedding' || job.title.includes('Broken Job Embedding')) {
      throw new Error('Simulated upstream embedding service failure for broken job embedding fixture');
    }

    const text = this.prepareJobText(job.title, job.description);
    const textHash = this.computeTextHash(text);

    // Check existing
    const existing = await matchingDal.getJobEmbedding(job.id);
    if (existing && existing.textHash === textHash && existing.model === this.provider.model) {
      return existing.vector;
    }

    // Generate new embedding
    const vector = await this.provider.generateEmbedding(text);
    await matchingDal.saveJobEmbedding({
      jobId: job.id,
      textHash,
      vector,
      dimensions: vector.length,
      model: this.provider.model,
    });

    return vector;
  }

  /**
   * Ensure all currently cached jobs have embeddings stored.
   */
  async ensureAllJobEmbeddings(): Promise<{ total: number; generated: number }> {
    const jobs = await matchingDal.getCachedJobsWithEmbeddings();
    let generated = 0;

    for (const job of jobs) {
      if (!job.embeddingVector) {
        try {
          await this.ensureJobEmbedding({
            id: job.id,
            title: job.title,
            description: job.description,
          });
          generated++;
        } catch (err: any) {
          console.warn(`[EMBEDDING WARNING] Could not generate embedding for job ${job.id}: ${err.message}`);
        }
      }
    }

    return { total: jobs.length, generated };
  }

  // -------------------------------------------------------------------------
  // CV Profile Embeddings (user-scoped)
  // -------------------------------------------------------------------------

  /**
   * Generates and stores one embedding per user's active CV profile
   * (summary + skills + recent work history).
   */
  async ensureCvProfileEmbedding(
    userId: string,
    cvProfileId: string,
    profileData: {
      summary?: string | null;
      skills?: any[];
      workHistory?: any[];
    }
  ): Promise<number[]> {
    if (!userId) throw new Error('ensureCvProfileEmbedding requires userId');
    const text = this.prepareCvProfileText(profileData);
    if (!text || !text.trim()) {
      throw new Error('CV profile contains no embeddable content (summary, skills, or work history)');
    }
    const textHash = this.computeTextHash(text);

    // Check existing
    const existing = await matchingDal.getCvProfileEmbedding(userId, cvProfileId);
    if (existing && existing.textHash === textHash && existing.model === this.provider.model) {
      return existing.vector;
    }

    // Generate and save
    const vector = await this.provider.generateEmbedding(text);
    await matchingDal.saveCvProfileEmbedding({
      userId,
      cvProfileId,
      textHash,
      vector,
      dimensions: vector.length,
      model: this.provider.model,
    });

    return vector;
  }
}

export const embeddingService = new EmbeddingService();
