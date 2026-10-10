import crypto from 'crypto';
import { RowDataPacket } from 'mysql2/promise';
import { getDbPool } from './db';

export interface UserApplicationRow extends RowDataPacket {
  id: string;
  user_id: string;
  job_id: string;
  tailored_cv_id: string | null;
  status: string;
  notes: string | null;
  applied_at: Date;
  created_at: Date;
  updated_at: Date;
  // Joined fields from cached_jobs
  job_title?: string;
  company?: string;
}

export interface StatusHistoryRow extends RowDataPacket {
  id: string;
  user_id: string;
  application_id: string;
  from_status: string | null;
  to_status: string;
  notes: string | null;
  transitioned_at: Date;
  job_title?: string;
  company?: string;
}

export class ApplicationDal {
  /**
   * Record status transition history row
   */
  async recordStatusTransition(params: {
    userId: string;
    applicationId: string;
    fromStatus: string | null;
    toStatus: string;
    notes?: string | null;
  }): Promise<void> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO application_status_history (id, user_id, application_id, from_status, to_status, notes, transitioned_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
      [id, params.userId, params.applicationId, params.fromStatus || null, params.toStatus, params.notes || null]
    );
  }

  /**
   * Mark a job as applied (or update status) for a user with status history tracking.
   * Scoped strictly to userId.
   */
  async markAsApplied(params: {
    userId: string;
    jobId: string;
    tailoredCvId?: string | null;
    status?: string;
    notes?: string | null;
  }): Promise<UserApplicationRow> {
    if (!params.userId) throw new Error('markAsApplied requires userId');
    const pool = getDbPool();
    const appStatus = (params.status || 'APPLIED').toUpperCase();
    const tailoredCvId = params.tailoredCvId || null;
    const notes = params.notes || null;

    const existing = await this.getApplicationByJob(params.userId, params.jobId);
    const oldStatus = existing ? existing.status : null;
    const id = existing ? existing.id : crypto.randomUUID();

    await pool.execute(
      `INSERT INTO user_applications (id, user_id, job_id, tailored_cv_id, status, notes, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         tailored_cv_id = COALESCE(VALUES(tailored_cv_id), tailored_cv_id),
         status = VALUES(status),
         notes = COALESCE(VALUES(notes), notes),
         applied_at = NOW(),
         updated_at = NOW()`,
      [id, params.userId, params.jobId, tailoredCvId, appStatus, notes]
    );

    await this.recordStatusTransition({
      userId: params.userId,
      applicationId: id,
      fromStatus: oldStatus,
      toStatus: appStatus,
      notes,
    });

    const app = await this.getApplicationByJob(params.userId, params.jobId);
    if (!app) {
      throw new Error('Failed to retrieve inserted application record.');
    }
    return app;
  }

  /**
   * Get an application record for a user+job pair.
   * Scoped strictly to userId.
   */
  async getApplicationByJob(userId: string, jobId: string): Promise<UserApplicationRow | null> {
    if (!userId) throw new Error('getApplicationByJob requires userId');
    const pool = getDbPool();
    const [rows] = await pool.query<UserApplicationRow[]>(
      `SELECT a.*, j.title AS job_title, j.company
       FROM user_applications a
       LEFT JOIN cached_jobs j ON a.job_id = j.id
       WHERE a.user_id = ? AND a.job_id = ?
       LIMIT 1`,
      [userId, jobId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get application record by application ID.
   * Scoped strictly to userId.
   */
  async getById(userId: string, applicationId: string): Promise<UserApplicationRow | null> {
    if (!userId) throw new Error('getById requires userId');
    const pool = getDbPool();
    const [rows] = await pool.query<UserApplicationRow[]>(
      `SELECT a.*, j.title AS job_title, j.company
       FROM user_applications a
       LEFT JOIN cached_jobs j ON a.job_id = j.id
       WHERE a.id = ? AND a.user_id = ?
       LIMIT 1`,
      [applicationId, userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Update status of an application with transition history recording.
   * Scoped strictly to userId.
   */
  async updateStatus(
    userId: string,
    applicationId: string,
    status: string,
    notes?: string | null
  ): Promise<UserApplicationRow | null> {
    if (!userId) throw new Error('updateStatus requires userId');
    const pool = getDbPool();
    const appStatus = status.toUpperCase();

    const existing = await this.getById(userId, applicationId);
    if (!existing) return null;

    const oldStatus = existing.status;

    await pool.execute(
      `UPDATE user_applications 
       SET status = ?, notes = COALESCE(?, notes), updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [appStatus, notes || null, applicationId, userId]
    );

    await this.recordStatusTransition({
      userId,
      applicationId,
      fromStatus: oldStatus,
      toStatus: appStatus,
      notes: notes || null,
    });

    return this.getById(userId, applicationId);
  }

  /**
   * List all application records for a user.
   * Scoped strictly to userId.
   */
  async listByUser(userId: string): Promise<UserApplicationRow[]> {
    if (!userId) throw new Error('listByUser requires userId');
    const pool = getDbPool();
    const [rows] = await pool.query<UserApplicationRow[]>(
      `SELECT a.*, j.title AS job_title, j.company
       FROM user_applications a
       LEFT JOIN cached_jobs j ON a.job_id = j.id
       WHERE a.user_id = ?
       ORDER BY a.applied_at DESC`,
      [userId]
    );
    return rows;
  }

  /**
   * Query complete status transition history for a user.
   * Scoped strictly to userId.
   */
  async getStatusHistory(
    userId: string,
    options?: {
      applicationId?: string;
      status?: string;
      company?: string;
    }
  ): Promise<StatusHistoryRow[]> {
    if (!userId) throw new Error('getStatusHistory requires userId');
    const pool = getDbPool();

    let sql = `SELECT h.*, j.title AS job_title, j.company
               FROM application_status_history h
               JOIN user_applications a ON h.application_id = a.id
               LEFT JOIN cached_jobs j ON a.job_id = j.id
               WHERE h.user_id = ?`;
    const params: any[] = [userId];

    if (options?.applicationId) {
      sql += ` AND h.application_id = ?`;
      params.push(options.applicationId);
    }
    if (options?.status) {
      sql += ` AND h.to_status = ?`;
      params.push(options.status.toUpperCase());
    }
    if (options?.company) {
      sql += ` AND j.company LIKE ?`;
      params.push(`%${options.company}%`);
    }

    sql += ` ORDER BY h.transitioned_at ASC`;

    const [rows] = await pool.query<StatusHistoryRow[]>(sql, params);
    return rows;
  }

  /**
   * Test helper: clear user_applications and history tables
   */
  async resetAllForTesting(): Promise<void> {
    const pool = getDbPool();
    await pool.execute(`DELETE FROM application_status_history`);
    await pool.execute(`DELETE FROM user_applications`);
  }
}

export const applicationDal = new ApplicationDal();
