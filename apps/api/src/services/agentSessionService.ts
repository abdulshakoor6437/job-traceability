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

  public getRedisClient(): Redis {
    if (!this.redis) {
      this.redis = createRedisClient();
    }
    return this.redis;
  }

  public getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(QUEUE_NAME, { connection: this.getRedisClient() });
    }
    return this.queue;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number = 2000, fallback: T): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
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

    try {
      await this.withTimeout(redis.set(redisKey, JSON.stringify(jobMetadata)), 1500, null);
    } catch (err: any) {
      console.warn(`[AGENT SESSION SERVICE] Could not write to Redis: ${err.message}`);
    }

    try {
      const queue = this.getQueue();
      await this.withTimeout(
        queue.add(
          'user-recurring-search',
          { userId },
          {
            repeat: { every: intervalMs },
            jobId: `user-search-${userId}`,
          }
        ),
        1500,
        null
      );
    } catch (err: any) {
      console.warn(`[AGENT SESSION SERVICE] BullMQ schedule error: ${err.message}`);
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

    try {
      await this.withTimeout(redis.del(redisKey), 1500, 0);
    } catch (err: any) {
      console.warn(`[AGENT SESSION SERVICE] Redis delete error: ${err.message}`);
    }

    try {
      const queue = this.getQueue();
      const repeatableJobs = await this.withTimeout(queue.getRepeatableJobs(), 1500, []);
      for (const job of repeatableJobs) {
        if (job.id === `user-search-${userId}` || (job.name === 'user-recurring-search' && job.key.includes(userId))) {
          await this.withTimeout(queue.removeRepeatableByKey(job.key), 1500, false);
        }
      }
    } catch (err: any) {
      console.warn(`[AGENT SESSION SERVICE] BullMQ remove error: ${err.message}`);
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

    try {
      const exists = await this.withTimeout(redis.exists(`agent_session:active_job:${userId}`), 1500, 0);
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

    try {
      const raw = await this.withTimeout(redis.get(`agent_session:active_job:${userId}`), 1500, null);
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
      if (quotaConfig && quotaConfig.monthlyLimit !== undefined && quotaConfig.monthlyLimit !== Infinity) {
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
      console.log(`[AGENT SESSION CONTROL] Shared search cache for '${role}' is FRESH (expires at ${cachedSearch.cache.expires_at}). 0 external API calls spent.`);
      return { executed: false, skipped: true, reason: 'cache_fresh', callsMade: 0 };
    }

    // 4. Cache is STALE: Run real search via Module 2 and score via Module 3
    console.log(`[AGENT SESSION CONTROL] Shared search cache for '${role}' is STALE or missing. Executing real provider search...`);
    const initialCalls = jobSearchService.getExternalCallCount();

    const searchResult = await jobSearchService.searchJobs({
      query: role,
      location: location || undefined,
      filters,
      forceRefresh: true,
    });

    const callsMade = jobSearchService.getExternalCallCount() - initialCalls;

    // Score results against user's active CV using Module 3's matching logic
    let totalMatches = 0;
    let notificationsCreated = 0;
    try {
      const matchResult = await matchingService.searchMatches(
        userId,
        { location: location || undefined, remoteOnly: filters.remoteOnly },
        { forceRefresh: true }
      );
      totalMatches = matchResult.totalMatches;

      // Module 8 Item 1: High-Match Notifications Hook
      const highMatchThreshold = parseInt(process.env.HIGH_MATCH_NOTIFICATION_THRESHOLD || '85', 10);
      const dailyCap = parseInt(process.env.DAILY_NOTIFICATION_CAP || '10', 10);

      let todayCount = await userDal.getTodayNotificationCount();

      for (const match of matchResult.matches || []) {
        if (match.matchScore >= highMatchThreshold) {
          if (todayCount >= dailyCap) {
            console.log(`[AGENT SESSION CONTROL] Daily notification cap (${dailyCap}) reached for user ${userId}. Skipping further notifications.`);
            break;
          }

          const alreadyNotified = await userDal.hasNotificationForJob(match.job.id);
          if (!alreadyNotified) {
            await userDal.createNotification(
              'high_match',
              `High job match: ${match.job.title} at ${match.job.company} (${match.matchScore}% match)`,
              match.job.id,
              null
            );
            todayCount++;
            notificationsCreated++;
            console.log(`[AGENT SESSION CONTROL] Created high-match notification for user ${userId}, job '${match.job.title}' (score: ${match.matchScore})`);
          }
        }
      }
    } catch (matchErr: any) {
      console.warn(`[AGENT SESSION CONTROL] Matching failed during background job (no active CV?): ${matchErr.message}`);
    }

    console.log(`[AGENT SESSION CONTROL] Background job completed for user ${userId}. External API calls made: ${callsMade}, total matches scored: ${totalMatches}, notifications created: ${notificationsCreated}.`);
    return {
      executed: true,
      skipped: false,
      callsMade,
      totalMatches,
    };
  }
}

export const agentSessionService = new AgentSessionService();
