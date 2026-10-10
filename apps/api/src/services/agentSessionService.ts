import Redis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { createRedisClient } from '../queue/redis';
import { createUserScopedDal } from '../dal/userScopedDal';
import { jobSearchService } from './job/jobSearchService';
import { matchingService } from './matching/matchingService';
import { jobDal, computeSearchCacheKey } from '../dal/jobDal';
import { JOB_SOURCING_CONFIG } from './job/config';

export const QUEUE_NAME = 'agent-session-control';
export const DEFAULT_SEARCH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class AgentSessionService {
  private redis: Redis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isInitialized = false;

  constructor() {
    this.initRedis();
  }

  private initRedis() {
    try {
      this.redis = createRedisClient();
      this.queue = new Queue(QUEUE_NAME, { connection: this.redis });
    } catch (err: any) {
      console.warn(`[AGENT SESSION SERVICE] Redis initialization warning: ${err.message}`);
    }
  }

  public getRedisClient(): Redis | null {
    if (!this.redis) {
      this.initRedis();
    }
    return this.redis;
  }

  /**
   * Schedule recurring search background job for an active user.
   * Stores metadata in Redis key `agent_session:active_job:${userId}`.
   */
  async scheduleUserJob(userId: string, intervalMs: number = DEFAULT_SEARCH_INTERVAL_MS): Promise<boolean> {
    if (!userId) return false;

    const redis = this.getRedisClient();
    const redisKey = `agent_session:active_job:${userId}`;
    const jobMetadata = {
      userId,
      scheduledAt: new Date().toISOString(),
      intervalMs,
      status: 'active',
    };

    if (redis) {
      try {
        await redis.set(redisKey, JSON.stringify(jobMetadata));
      } catch (err: any) {
        console.warn(`[AGENT SESSION SERVICE] Could not write to Redis: ${err.message}`);
      }
    }

    if (this.queue) {
      try {
        const repeatKey = `user-recurring-search-${userId}`;
        // Remove old repeatable job if existing to prevent duplicates
        await this.queue.removeRepeatableByKey(repeatKey).catch(() => {});
        await this.queue.add(
          'user-recurring-search',
          { userId },
          {
            repeat: { every: intervalMs },
            jobId: `user-search-${userId}`,
          }
        );
      } catch (err: any) {
        console.warn(`[AGENT SESSION SERVICE] BullMQ schedule error: ${err.message}`);
      }
    }

    console.log(`[AGENT SESSION CONTROL] Scheduled background search job for active user ${userId} (interval: ${intervalMs}ms)`);
    return true;
  }

  /**
   * Cancel and actively remove background search job from Redis for a user.
   */
  async removeUserJob(userId: string): Promise<boolean> {
    if (!userId) return false;

    const redis = this.getRedisClient();
    const redisKey = `agent_session:active_job:${userId}`;
    let removedFromRedis = false;

    if (redis) {
      try {
        const deletedCount = await redis.del(redisKey);
        removedFromRedis = deletedCount > 0;
      } catch (err: any) {
        console.warn(`[AGENT SESSION SERVICE] Redis delete error: ${err.message}`);
      }
    }

    if (this.queue) {
      try {
        const repeatableJobs = await this.queue.getRepeatableJobs();
        for (const job of repeatableJobs) {
          if (job.id === `user-search-${userId}` || job.name === 'user-recurring-search' && job.key.includes(userId)) {
            await this.queue.removeRepeatableByKey(job.key);
          }
        }
      } catch (err: any) {
        console.warn(`[AGENT SESSION SERVICE] BullMQ remove error: ${err.message}`);
      }
    }

    console.log(`[AGENT SESSION CONTROL] Actively removed background search job from Redis for user ${userId}`);
    return true;
  }

  /**
   * Check if a job is actively scheduled in Redis for a user.
   */
  async isJobScheduled(userId: string): Promise<boolean> {
    if (!userId) return false;
    const redis = this.getRedisClient();
    if (!redis) return false;

    try {
      const exists = await redis.exists(`agent_session:active_job:${userId}`);
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Retrieve active job metadata directly from Redis.
   */
  async getJobMetadata(userId: string): Promise<any | null> {
    if (!userId) return null;
    const redis = this.getRedisClient();
    if (!redis) return null;

    try {
      const raw = await redis.get(`agent_session:active_job:${userId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Execute the recurring background job logic for a user.
   * Checks search preferences, checks quota, checks cache staleness.
   */
  async executeRecurringUserSearch(userId: string): Promise<{
    executed: boolean;
    skipped: boolean;
    reason?: string;
    callsMade: number;
    totalMatches?: number;
  }> {
    console.log(`[AGENT SESSION CONTROL] Executing recurring search check for user ${userId}...`);

    // 1. Quota Check (Item 4 & Test f): verify providers have remaining quota
    const providers = ['jsearch', 'serpapi', 'remotive'];
    let lowQuotaDetected = false;
    for (const provider of providers) {
      const quotaConfig = JOB_SOURCING_CONFIG.providerQuotas[provider];
      if (quotaConfig && quotaConfig.monthlyLimit !== Infinity) {
        try {
          const used = await jobDal.getProviderUsageThisMonth(provider);
          if (used >= quotaConfig.monthlyLimit) {
            lowQuotaDetected = true;
            console.warn(`[AGENT SESSION CONTROL] Provider '${provider}' quota exhausted (${used}/${quotaConfig.monthlyLimit}). Throttling background job for user ${userId}.`);
            break;
          }
        } catch (err: any) {
          console.warn(`[AGENT SESSION CONTROL] Quota check failed: ${err.message}`);
        }
      }
    }

    if (lowQuotaDetected) {
      console.warn(`[AGENT SESSION CONTROL] Low quota detected. Skipping background job for user ${userId} to preserve quota for manual searches.`);
      return { executed: false, skipped: true, reason: 'low_quota', callsMade: 0 };
    }

    // 2. Retrieve user's search preferences (Item 1)
    const userDal = createUserScopedDal(userId);
    const prefs = await userDal.getSearchPreferences();

    if (!prefs || !prefs.role || !prefs.role.trim()) {
      console.log(`[AGENT SESSION CONTROL] User ${userId} has no saved search preferences. Skipping background job.`);
      return { executed: false, skipped: true, reason: 'no_preferences', callsMade: 0 };
    }

    const role = prefs.role.trim();
    const location = prefs.location || null;
    const filters = prefs.filters_json ? JSON.parse(prefs.filters_json) : {};

    // 3. Check if Module 2's shared cache for this query is stale (Item 2 & Test b)
    const cacheKey = computeSearchCacheKey(role, location, filters);
    const cachedSearch = await jobDal.getCachedSearch(cacheKey);

    if (cachedSearch) {
      console.log(`[AGENT SESSION CONTROL] Shared search cache for '${role}' is FRESH (expires at ${cachedSearch.expiresAt}). 0 external API calls spent.`);
      return { executed: false, skipped: true, reason: 'cache_fresh', callsMade: 0 };
    }

    // 4. Cache is STALE: Run real search via Module 2 and score via Module 3
    console.log(`[AGENT SESSION CONTROL] Shared search cache for '${role}' is STALE or missing. Executing real provider search...`);
    const initialCalls = jobSearchService.getExternalCallCount();

    const searchResult = await jobSearchService.searchJobs({
      query: role,
      location,
      filters,
      forceRefresh: true,
    });

    const callsMade = jobSearchService.getExternalCallCount() - initialCalls;

    // Score results against user's active CV using Module 3's matching logic
    let totalMatches = 0;
    try {
      const matchResult = await matchingService.searchMatches(
        userId,
        { location, remoteOnly: filters.remoteOnly },
        { forceRefresh: true }
      );
      totalMatches = matchResult.totalMatches;
    } catch (matchErr: any) {
      console.warn(`[AGENT SESSION CONTROL] Matching failed during background job (no active CV?): ${matchErr.message}`);
    }

    console.log(`[AGENT SESSION CONTROL] Background job completed for user ${userId}. External API calls made: ${callsMade}, total matches scored: ${totalMatches}.`);
    return {
      executed: true,
      skipped: false,
      callsMade,
      totalMatches,
    };
  }
}

export const agentSessionService = new AgentSessionService();
