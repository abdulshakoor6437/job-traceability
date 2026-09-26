import crypto from 'crypto';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getDbPool } from './db';
import { NormalizedJob } from '../services/job/types';

export interface JobSearchCacheRow extends RowDataPacket {
  id: string;
  cache_key: string;
  query: string;
  location: string | null;
  filters_json: string | null;
  result_count: number;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CachedJobRow extends RowDataPacket {
  id: string;
  dedup_key: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_currency: string | null;
  description: string | null;
  apply_url: string | null;
  posted_date: Date | null;
  fetched_at: Date;
  source_providers: string;
  external_ids: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderApiLogRow extends RowDataPacket {
  id: string;
  provider: string;
  query: string;
  response_count: number;
  latency_ms: number;
  status_code: number;
  is_success: number;
  error_message: string | null;
  called_at: Date;
}

export function computeDedupKey(title: string, company: string, location?: string | null): string {
  const normTitle = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  const normCompany = (company || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
  // Location can be null or fuzzy (e.g. Remote vs worldwide vs US)
  const normLoc = (location || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

  return crypto
    .createHash('sha256')
    .update(`${normTitle}|${normCompany}|${normLoc}`)
    .digest('hex');
}

export function computeSearchCacheKey(query: string, location?: string | null, filters?: any): string {
  const normQuery = (query || '').toLowerCase().trim();
  const normLoc = (location || '').toLowerCase().trim();
  const sortedFilters = filters ? JSON.stringify(filters, Object.keys(filters).sort()) : '{}';

  return crypto
    .createHash('sha256')
    .update(`${normQuery}|${normLoc}|${sortedFilters}`)
    .digest('hex');
}

export class JobDal {
  /**
   * Retrieves active, non-expired search cache and linked normalized jobs.
   * Returns null if cache entry does not exist or has expired.
   */
  async getCachedSearch(cacheKey: string): Promise<{ cache: JobSearchCacheRow; jobs: NormalizedJob[] } | null> {
    const pool = getDbPool();

    const [cacheRows] = await pool.query<JobSearchCacheRow[]>(
      `SELECT * FROM job_search_cache WHERE cache_key = ? AND expires_at > NOW() LIMIT 1`,
      [cacheKey]
    );

    if (cacheRows.length === 0) {
      return null;
    }

    const cache = cacheRows[0];

    // Join cached_jobs with job_search_cache_entries ordered by rank_order
    const [jobRows] = await pool.query<CachedJobRow[]>(
      `SELECT j.* 
       FROM cached_jobs j
       INNER JOIN job_search_cache_entries e ON e.job_id = j.id
       WHERE e.search_cache_id = ?
       ORDER BY e.rank_order ASC`,
      [cache.id]
    );

    const jobs: NormalizedJob[] = jobRows.map((r) => {
      let sourceProviders: string[] = [];
      try {
        sourceProviders = JSON.parse(r.source_providers);
      } catch {
        sourceProviders = r.source_providers ? r.source_providers.split(',') : [];
      }

      let externalIds: Record<string, string> = {};
      try {
        externalIds = JSON.parse(r.external_ids);
      } catch {
        externalIds = {};
      }

      return {
        externalId: r.id,
        sourceProvider: sourceProviders[0] || 'cached',
        title: r.title,
        company: r.company,
        location: r.location,
        remote: Boolean(r.remote),
        salaryMin: r.salary_min !== null ? Number(r.salary_min) : null,
        salaryMax: r.salary_max !== null ? Number(r.salary_max) : null,
        salaryCurrency: r.salary_currency,
        description: r.description,
        applyUrl: r.apply_url,
        postedDate: r.posted_date ? new Date(r.posted_date).toISOString() : null,
        fetchedAt: new Date(r.fetched_at).toISOString(),
        sourceProviders,
        externalIds,
      };
    });

    return { cache, jobs };
  }

  /**
   * Saves a search query and its deduplicated normalized jobs into the shared cache.
   * Updates existing jobs with merged sources if already present in cached_jobs.
   */
  async saveCachedSearch(params: {
    cacheKey: string;
    query: string;
    location?: string | null;
    filters?: any;
    ttlHours: number;
    jobs: NormalizedJob[];
  }): Promise<void> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const searchCacheId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + params.ttlHours * 60 * 60 * 1000);
      const filtersJson = params.filters ? JSON.stringify(params.filters) : null;

      // 1. Delete any existing (expired or stale) cache entry with this cache_key
      const [existing] = await conn.query<JobSearchCacheRow[]>(
        `SELECT id FROM job_search_cache WHERE cache_key = ?`,
        [params.cacheKey]
      );
      if (existing.length > 0) {
        await conn.execute(`DELETE FROM job_search_cache WHERE id = ?`, [existing[0].id]);
      }

      // 2. Insert new job_search_cache record
      await conn.execute(
        `INSERT INTO job_search_cache 
          (id, cache_key, query, location, filters_json, result_count, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          searchCacheId,
          params.cacheKey,
          params.query,
          params.location || null,
          filtersJson,
          params.jobs.length,
          expiresAt,
        ]
      );

      // 3. Insert or update deduplicated jobs and create search entries
      let rank = 0;
      for (const job of params.jobs) {
        rank++;
        const dedupKey = computeDedupKey(job.title, job.company, job.location);

        // Check if cached_jobs already has this dedupKey
        const [existingJobs] = await conn.query<CachedJobRow[]>(
          `SELECT id, source_providers, external_ids FROM cached_jobs WHERE dedup_key = ? LIMIT 1`,
          [dedupKey]
        );

        let jobId: string;

        const currentSources = job.sourceProviders || [job.sourceProvider];
        const currentExtIds = job.externalIds || { [job.sourceProvider]: job.externalId };

        if (existingJobs.length > 0) {
          jobId = existingJobs[0].id;
          let mergedSources: string[] = [];
          try {
            mergedSources = JSON.parse(existingJobs[0].source_providers);
          } catch {
            mergedSources = existingJobs[0].source_providers.split(',');
          }
          for (const s of currentSources) {
            if (!mergedSources.includes(s)) mergedSources.push(s);
          }

          let mergedExtIds: Record<string, string> = {};
          try {
            mergedExtIds = JSON.parse(existingJobs[0].external_ids);
          } catch {
            mergedExtIds = {};
          }
          Object.assign(mergedExtIds, currentExtIds);

          await conn.execute(
            `UPDATE cached_jobs 
             SET source_providers = ?, external_ids = ?, updated_at = NOW()
             WHERE id = ?`,
            [JSON.stringify(mergedSources), JSON.stringify(mergedExtIds), jobId]
          );
        } else {
          jobId = crypto.randomUUID();
          await conn.execute(
            `INSERT INTO cached_jobs 
              (id, dedup_key, title, company, location, remote, salary_min, salary_max, salary_currency, description, apply_url, posted_date, fetched_at, source_providers, external_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              jobId,
              dedupKey,
              job.title,
              job.company,
              job.location || null,
              job.remote ? 1 : 0,
              job.salaryMin,
              job.salaryMax,
              job.salaryCurrency,
              job.description || null,
              job.applyUrl || null,
              job.postedDate ? new Date(job.postedDate) : null,
              new Date(job.fetchedAt || Date.now()),
              JSON.stringify(currentSources),
              JSON.stringify(currentExtIds),
            ]
          );
        }

        // 4. Link search cache to cached job
        const entryId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO job_search_cache_entries (id, search_cache_id, job_id, rank_order)
           VALUES (?, ?, ?, ?)`,
          [entryId, searchCacheId, jobId, rank]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Item 5: Log every external provider call with latency, count, and status
   */
  async logProviderCall(params: {
    provider: string;
    query: string;
    responseCount: number;
    latencyMs: number;
    statusCode: number;
    isSuccess: boolean;
    errorMessage?: string | null;
  }): Promise<void> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO provider_api_logs 
        (id, provider, query, response_count, latency_ms, status_code, is_success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.provider,
        params.query,
        params.responseCount,
        params.latencyMs,
        params.statusCode,
        params.isSuccess ? 1 : 0,
        params.errorMessage || null,
      ]
    );
  }

  /**
   * Returns total API calls made to a provider in the current calendar month.
   */
  async getProviderUsageThisMonth(provider: string): Promise<number> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as count 
       FROM provider_api_logs 
       WHERE provider = ? 
         AND called_at >= DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')`,
      [provider]
    );
    return Number(rows[0]?.count || 0);
  }

  /**
   * Retrieves recent provider API logs for verification/inspection.
   */
  async getProviderApiLogs(provider?: string, limit: number = 50): Promise<ProviderApiLogRow[]> {
    const pool = getDbPool();
    if (provider) {
      const [rows] = await pool.query<ProviderApiLogRow[]>(
        `SELECT * FROM provider_api_logs WHERE provider = ? ORDER BY called_at DESC LIMIT ?`,
        [provider, limit]
      );
      return rows;
    }
    const [rows] = await pool.query<ProviderApiLogRow[]>(
      `SELECT * FROM provider_api_logs ORDER BY called_at DESC LIMIT ?`,
      [limit]
    );
    return rows;
  }

  /**
   * Cleans up expired cache rows
   */
  async clearExpiredCache(): Promise<number> {
    const pool = getDbPool();
    const [res] = await pool.execute<ResultSetHeader>(
      `DELETE FROM job_search_cache WHERE expires_at <= NOW()`
    );
    return res.affectedRows;
  }

  /**
   * Test helper: clear all job cache and logs
   */
  async resetAllForTesting(): Promise<void> {
    const pool = getDbPool();
    await pool.execute(`DELETE FROM job_search_cache_entries`);
    await pool.execute(`DELETE FROM job_search_cache`);
    await pool.execute(`DELETE FROM cached_jobs`);
    await pool.execute(`DELETE FROM provider_api_logs`);
  }
}

export const jobDal = new JobDal();
