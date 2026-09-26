import { IJobSource, NormalizedJob } from './types';
import { jobDal, computeSearchCacheKey } from '../../dal/jobDal';
import { deduplicateJobs } from './deduplicator';
import { JOB_SOURCING_CONFIG } from './config';
import { JSearchProvider } from './providers/jsearchProvider';
import { SerpApiProvider } from './providers/serpApiProvider';
import { RemotiveProvider } from './providers/remotiveProvider';

export interface JobSearchFilters {
  remoteOnly?: boolean;
  minSalary?: number;
  salaryCurrency?: string;
  limit?: number;
}

export interface JobSearchResult {
  jobs: NormalizedJob[];
  fromCache: boolean;
  totalCount: number;
  cacheKey: string;
  externalCallsMade: number;
  providersQueried: string[];
  skippedProviders: Array<{ provider: string; reason: string }>;
}

export class JobSearchService {
  private providers: Map<string, IJobSource> = new Map();
  private externalCallCounter: number = 0;

  constructor(customProviders?: IJobSource[]) {
    if (customProviders && customProviders.length > 0) {
      for (const p of customProviders) {
        this.providers.set(p.name, p);
      }
    } else {
      // Default production providers
      this.providers.set('jsearch', new JSearchProvider());
      this.providers.set('serpapi', new SerpApiProvider());
      this.providers.set('remotive', new RemotiveProvider());
    }
  }

  public registerProvider(provider: IJobSource) {
    this.providers.set(provider.name, provider);
  }

  public getExternalCallCount(): number {
    return this.externalCallCounter;
  }

  public resetCallCounter(): void {
    this.externalCallCounter = 0;
  }

  /**
   * Primary entry point: coordinates shared caching, quota checking, provider fallback,
   * cross-provider deduplication, and persistence.
   */
  async searchJobs(params: {
    query: string;
    location?: string | null;
    filters?: JobSearchFilters;
    page?: number;
    ttlHours?: number;
    forceRefresh?: boolean;
  }): Promise<JobSearchResult> {
    const query = (params.query || '').trim();
    const location = params.location ? params.location.trim() : null;
    const filters = params.filters || {};
    const ttlHours = params.ttlHours || JOB_SOURCING_CONFIG.defaultCacheTtlHours;
    const cacheKey = computeSearchCacheKey(query, location, filters);

    // 1. Shared Cache Lookup (Keyed by role+location+filters, NOT by user)
    if (!params.forceRefresh) {
      const cached = await jobDal.getCachedSearch(cacheKey);
      if (cached) {
        let filteredJobs = cached.jobs;
        if (filters.remoteOnly) {
          filteredJobs = filteredJobs.filter((j) => j.remote);
        }
        if (filters.minSalary && filters.minSalary > 0) {
          filteredJobs = filteredJobs.filter((j) => j.salaryMax !== null && j.salaryMax >= filters.minSalary!);
        }
        if (filters.limit && filters.limit > 0) {
          filteredJobs = filteredJobs.slice(0, filters.limit);
        }

        return {
          jobs: filteredJobs,
          fromCache: true,
          totalCount: filteredJobs.length,
          cacheKey,
          externalCallsMade: 0, // Zero calls on cache hit!
          providersQueried: [],
          skippedProviders: [],
        };
      }
    }

    // 2. Cache Miss: Query Providers with Quota Verification & Resilience
    const collectedJobs: NormalizedJob[] = [];
    const providersQueried: string[] = [];
    const skippedProviders: Array<{ provider: string; reason: string }> = [];

    const providerList = Array.from(this.providers.values());

    for (const provider of providerList) {
      const quotaConfig = JOB_SOURCING_CONFIG.providerQuotas[provider.name];

      // Check current monthly quota in database
      if (quotaConfig && quotaConfig.monthlyLimit !== Infinity) {
        try {
          const usedThisMonth = await jobDal.getProviderUsageThisMonth(provider.name);
          const limit = quotaConfig.monthlyLimit;
          const thresholdCalls = Math.floor(limit * (quotaConfig.nearQuotaThresholdPercent / 100));

          if (usedThisMonth >= limit) {
            console.warn(
              `[QUOTA EXCEEDED] Provider '${provider.name}' reached monthly limit (${usedThisMonth}/${limit}). Skipping.`
            );
            skippedProviders.push({
              provider: provider.name,
              reason: `Monthly quota exceeded (${usedThisMonth}/${limit} calls)`,
            });
            continue;
          }

          if (usedThisMonth >= thresholdCalls) {
            console.warn(
              `[QUOTA WARNING] Provider '${provider.name}' is near monthly quota (${usedThisMonth}/${limit} calls).`
            );
          }
        } catch (err: any) {
          console.warn(`[QUOTA CHECK ERROR] Could not verify quota for ${provider.name}: ${err.message}`);
        }
      }

      // Execute provider call with latency & logging
      const startTime = Date.now();
      try {
        // Increment exact external call counter
        this.externalCallCounter++;
        providersQueried.push(provider.name);

        const jobs = await provider.searchJobs(query, location || undefined, params.page || 1);
        const latencyMs = Date.now() - startTime;

        // Log call in database
        await jobDal.logProviderCall({
          provider: provider.name,
          query: location ? `${query} in ${location}` : query,
          responseCount: jobs.length,
          latencyMs,
          statusCode: 200,
          isSuccess: true,
        });

        collectedJobs.push(...jobs);
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const statusCode = err.statusCode || 500;

        console.error(`[PROVIDER ERROR] '${provider.name}' failed: ${err.message}`);

        // Log failure in database
        try {
          await jobDal.logProviderCall({
            provider: provider.name,
            query: location ? `${query} in ${location}` : query,
            responseCount: 0,
            latencyMs,
            statusCode,
            isSuccess: false,
            errorMessage: err.message,
          });
        } catch (logErr: any) {
          console.error(`[LOGGING ERROR] Could not log provider failure: ${logErr.message}`);
        }

        skippedProviders.push({
          provider: provider.name,
          reason: `Execution failure: ${err.message}`,
        });
      }
    }

    // 3. Deduplicate collected jobs across providers
    const deduplicated = deduplicateJobs(collectedJobs);

    // 4. Save to shared database cache
    try {
      await jobDal.saveCachedSearch({
        cacheKey,
        query,
        location,
        filters,
        ttlHours,
        jobs: deduplicated,
      });
    } catch (saveErr: any) {
      console.error(`[CACHE SAVE ERROR] Could not persist search to cache: ${saveErr.message}`);
    }

    // 5. Apply filters to response
    let finalJobs = deduplicated;
    if (filters.remoteOnly) {
      finalJobs = finalJobs.filter((j) => j.remote);
    }
    if (filters.minSalary && filters.minSalary > 0) {
      finalJobs = finalJobs.filter((j) => j.salaryMax !== null && j.salaryMax >= filters.minSalary!);
    }
    if (filters.limit && filters.limit > 0) {
      finalJobs = finalJobs.slice(0, filters.limit);
    }

    return {
      jobs: finalJobs,
      fromCache: false,
      totalCount: finalJobs.length,
      cacheKey,
      externalCallsMade: providersQueried.length,
      providersQueried,
      skippedProviders,
    };
  }
}

export const jobSearchService = new JobSearchService();
