import crypto from 'crypto';
import { getDbPool } from './db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface JobEmbeddingRow extends RowDataPacket {
  id: string;
  job_id: string;
  text_hash: string;
  embedding_vector: string;
  dimensions: number;
  model: string;
  created_at: Date;
}

export interface CvProfileEmbeddingRow extends RowDataPacket {
  id: string;
  cv_profile_id: string;
  user_id: string;
  text_hash: string;
  embedding_vector: string;
  dimensions: number;
  model: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserMatchCacheRow extends RowDataPacket {
  id: string;
  user_id: string;
  cv_profile_id: string;
  job_pool_version: string;
  filters_hash: string;
  created_at: Date;
  updated_at: Date;
}

export interface UserJobMatchRow extends RowDataPacket {
  id: string;
  match_cache_id: string;
  user_id: string;
  job_id: string;
  score: number;
  label: string;
  is_excluded: number;
  excluded_reason: string | null;
  explanation: string | null;
  rank_order: number;
  created_at: Date;
  // Joined from cached_jobs
  title?: string;
  company?: string;
  location?: string | null;
  remote?: number;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  description?: string | null;
  apply_url?: string | null;
  source_providers?: string;
  external_ids?: string;
}

export interface CachedJobForEmbedding {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  applyUrl: string | null;
  company: string;
  embeddingVector?: number[];
}

export interface SaveUserMatchItem {
  jobId: string;
  score: number;
  label: string;
  isExcluded: boolean;
  excludedReason: string | null;
  explanation: string | null;
  rankOrder: number;
}

export class MatchingDal {
  // -------------------------------------------------------------------------
  // 1. Shared Job Embeddings (ZERO user_id, global to cached_jobs)
  // -------------------------------------------------------------------------

  /**
   * Save or update an embedding vector for a cached job.
   */
  async saveJobEmbedding(params: {
    jobId: string;
    textHash: string;
    vector: number[];
    dimensions: number;
    model: string;
  }): Promise<void> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    const vectorJson = JSON.stringify(params.vector);

    await pool.execute(
      `INSERT INTO job_embeddings (id, job_id, text_hash, embedding_vector, dimensions, model)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         text_hash = VALUES(text_hash),
         embedding_vector = VALUES(embedding_vector),
         dimensions = VALUES(dimensions),
         model = VALUES(model)`,
      [id, params.jobId, params.textHash, vectorJson, params.dimensions, params.model]
    );
  }

  /**
   * Get an embedding for a specific job.
   */
  async getJobEmbedding(jobId: string): Promise<{ vector: number[]; textHash: string; dimensions: number; model: string } | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<JobEmbeddingRow[]>(
      `SELECT * FROM job_embeddings WHERE job_id = ? LIMIT 1`,
      [jobId]
    );
    if (rows.length === 0) return null;
    return {
      vector: JSON.parse(rows[0].embedding_vector),
      textHash: rows[0].text_hash,
      dimensions: rows[0].dimensions,
      model: rows[0].model,
    };
  }

  /**
   * Get all cached jobs with their existing embeddings (if present).
   */
  async getCachedJobsWithEmbeddings(): Promise<CachedJobForEmbedding[]> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
         j.id, j.title, j.description, j.company, j.location, j.remote,
         j.salary_min, j.salary_max, j.salary_currency, j.apply_url,
         e.embedding_vector
       FROM cached_jobs j
       LEFT JOIN job_embeddings e ON j.id = e.job_id
       ORDER BY j.fetched_at DESC`
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      company: r.company,
      location: r.location,
      remote: Boolean(r.remote),
      salaryMin: r.salary_min !== null ? Number(r.salary_min) : null,
      salaryMax: r.salary_max !== null ? Number(r.salary_max) : null,
      salaryCurrency: r.salary_currency,
      applyUrl: r.apply_url,
      embeddingVector: r.embedding_vector ? JSON.parse(r.embedding_vector) : undefined,
    }));
  }

  /**
   * Returns a signature representing the current job cache state (job pool version).
   * Changes whenever cached_jobs are inserted/updated or cleared.
   */
  async getJobPoolVersion(): Promise<string> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as cnt, MAX(updated_at) as max_upd FROM cached_jobs`
    );
    const cnt = rows[0]?.cnt || 0;
    const maxUpd = rows[0]?.max_upd ? new Date(rows[0].max_upd).toISOString() : 'empty';
    return crypto.createHash('sha256').update(`${cnt}:${maxUpd}`).digest('hex');
  }

  // -------------------------------------------------------------------------
  // 2. User CV Profile Embeddings (STRICTLY user_id scoped)
  // -------------------------------------------------------------------------

  /**
   * Save or update an embedding for a user's active CV profile.
   */
  async saveCvProfileEmbedding(params: {
    userId: string;
    cvProfileId: string;
    textHash: string;
    vector: number[];
    dimensions: number;
    model: string;
  }): Promise<void> {
    if (!params.userId) throw new Error('saveCvProfileEmbedding requires userId');
    const pool = getDbPool();
    const id = crypto.randomUUID();
    const vectorJson = JSON.stringify(params.vector);

    await pool.execute(
      `INSERT INTO cv_profile_embeddings (id, cv_profile_id, user_id, text_hash, embedding_vector, dimensions, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         text_hash = VALUES(text_hash),
         embedding_vector = VALUES(embedding_vector),
         dimensions = VALUES(dimensions),
         model = VALUES(model),
         updated_at = NOW()`,
      [id, params.cvProfileId, params.userId, params.textHash, vectorJson, params.dimensions, params.model]
    );
  }

  /**
   * Get an embedding for a user's CV profile (verifying user ownership).
   */
  async getCvProfileEmbedding(
    userId: string,
    cvProfileId: string
  ): Promise<{ vector: number[]; textHash: string; dimensions: number; model: string } | null> {
    if (!userId) throw new Error('getCvProfileEmbedding requires userId');
    const pool = getDbPool();
    const [rows] = await pool.query<CvProfileEmbeddingRow[]>(
      `SELECT * FROM cv_profile_embeddings WHERE user_id = ? AND cv_profile_id = ? LIMIT 1`,
      [userId, cvProfileId]
    );
    if (rows.length === 0) return null;
    return {
      vector: JSON.parse(rows[0].embedding_vector),
      textHash: rows[0].text_hash,
      dimensions: rows[0].dimensions,
      model: rows[0].model,
    };
  }

  // -------------------------------------------------------------------------
  // 3. User Match Results Cache & Retrieval (STRICTLY user_id scoped)
  // -------------------------------------------------------------------------

  /**
   * Retrieve cached match results for a user if cache entry is valid.
   */
  async getUserMatchCache(
    userId: string,
    cvProfileId: string,
    jobPoolVersion: string,
    filtersHash: string
  ): Promise<UserMatchCacheRow | null> {
    if (!userId) throw new Error('getUserMatchCache requires userId');
    const pool = getDbPool();
    const [rows] = await pool.query<UserMatchCacheRow[]>(
      `SELECT * FROM user_match_cache 
       WHERE user_id = ? 
         AND cv_profile_id = ? 
         AND job_pool_version = ? 
         AND filters_hash = ?
       LIMIT 1`,
      [userId, cvProfileId, jobPoolVersion, filtersHash]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get saved match records for a user from user_job_matches joined with cached_jobs.
   */
  async getUserJobMatches(
    userId: string,
    matchCacheId: string,
    options: { includeExcluded?: boolean; minScore?: number } = {}
  ): Promise<UserJobMatchRow[]> {
    if (!userId) throw new Error('getUserJobMatches requires userId');
    const pool = getDbPool();

    let query = `
      SELECT 
        m.id, m.match_cache_id, m.user_id, m.job_id, m.score, m.label,
        m.is_excluded, m.excluded_reason, m.explanation, m.rank_order, m.created_at,
        j.title, j.company, j.location, j.remote, j.salary_min, j.salary_max,
        j.salary_currency, j.description, j.apply_url, j.source_providers, j.external_ids
      FROM user_job_matches m
      JOIN cached_jobs j ON m.job_id = j.id
      WHERE m.user_id = ? AND m.match_cache_id = ?
    `;
    const params: any[] = [userId, matchCacheId];

    if (!options.includeExcluded) {
      query += ` AND m.is_excluded = 0 AND m.score >= 40.0`;
    }

    if (options.minScore && options.minScore > 0) {
      query += ` AND m.score >= ?`;
      params.push(options.minScore);
    }

    query += ` ORDER BY m.rank_order ASC`;

    const [rows] = await pool.query<UserJobMatchRow[]>(query, params);
    return rows;
  }

  /**
   * Save a computed set of match results for a user in a single atomic transaction.
   */
  async saveUserMatches(params: {
    userId: string;
    cvProfileId: string;
    jobPoolVersion: string;
    filtersHash: string;
    matches: SaveUserMatchItem[];
  }): Promise<string> {
    if (!params.userId) throw new Error('saveUserMatches requires userId');
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Invalidate / remove previous cache entries for the same filters
      await conn.execute(
        `DELETE FROM user_match_cache 
         WHERE user_id = ? AND cv_profile_id = ? AND filters_hash = ?`,
        [params.userId, params.cvProfileId, params.filtersHash]
      );

      // Create new cache entry
      const cacheId = crypto.randomUUID();
      await conn.execute(
        `INSERT INTO user_match_cache (id, user_id, cv_profile_id, job_pool_version, filters_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [cacheId, params.userId, params.cvProfileId, params.jobPoolVersion, params.filtersHash]
      );

      // Insert ranked matches
      for (const m of params.matches) {
        const matchId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO user_job_matches 
             (id, match_cache_id, user_id, job_id, score, label, is_excluded, excluded_reason, explanation, rank_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            matchId,
            cacheId,
            params.userId,
            m.jobId,
            m.score,
            m.label,
            m.isExcluded ? 1 : 0,
            m.excludedReason || null,
            m.explanation || null,
            m.rankOrder,
          ]
        );
      }

      await conn.commit();
      return cacheId;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Invalidate all match caches for a user (e.g. when their active CV profile is updated or changed).
   */
  async invalidateUserMatchCache(userId: string): Promise<void> {
    if (!userId) throw new Error('invalidateUserMatchCache requires userId');
    const pool = getDbPool();
    await pool.execute(`DELETE FROM user_match_cache WHERE user_id = ?`, [userId]);
  }

  /**
   * Test helper: clear matching tables.
   */
  async resetAllForTesting(): Promise<void> {
    const pool = getDbPool();
    await pool.execute(`DELETE FROM user_job_matches`);
    await pool.execute(`DELETE FROM user_match_cache`);
    await pool.execute(`DELETE FROM cv_profile_embeddings`);
    await pool.execute(`DELETE FROM job_embeddings`);
  }
}

export const matchingDal = new MatchingDal();
