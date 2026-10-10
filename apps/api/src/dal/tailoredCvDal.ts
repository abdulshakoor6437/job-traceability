import crypto from 'crypto';
import { getDbPool } from './db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { CvStructuredProfile } from '../services/cv/schemaValidator';

// ---------------------------------------------------------------------------
// Row interfaces
// ---------------------------------------------------------------------------
export interface TailoredCvRow extends RowDataPacket {
  id: string;
  user_id: string;
  source_cv_profile_id: string;
  job_id: string;
  job_title: string;
  version_number: number;
  is_current: number;
  generation_status: string;
  validation_status: string;
  validation_issues: string | null;
  regeneration_count: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
  summary: string | null;
  is_user_edited: number;
  created_at: Date;
  updated_at: Date;
}

export interface TailoredCvWorkHistoryRow extends RowDataPacket {
  id: string;
  tailored_cv_id: string;
  user_id: string;
  title: string;
  company: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: number;
  bullet_points: any;
  display_order: number;
}

export interface TailoredCvEducationRow extends RowDataPacket {
  id: string;
  tailored_cv_id: string;
  user_id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  display_order: number;
}

export interface TailoredCvSkillRow extends RowDataPacket {
  id: string;
  tailored_cv_id: string;
  user_id: string;
  skill_name: string;
  category: string | null;
  display_order: number;
}

export interface TailoredCvCertificationRow extends RowDataPacket {
  id: string;
  tailored_cv_id: string;
  user_id: string;
  name: string;
  issuing_organization: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  credential_id: string | null;
  display_order: number;
}

export interface FullTailoredCv {
  tailoredCv: TailoredCvRow;
  workHistory: TailoredCvWorkHistoryRow[];
  education: TailoredCvEducationRow[];
  skills: TailoredCvSkillRow[];
  certifications: TailoredCvCertificationRow[];
}

export interface TailoredCvSummaryRow {
  id: string;
  jobId: string;
  job_id: string;
  jobTitle: string;
  job_title: string;
  company: string | null;
  versionNumber: number;
  version_number: number;
  createdAt: Date;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// DAL
// ---------------------------------------------------------------------------
export class TailoredCvDal {

  /**
   * Read today's generation count for this user.
   * All queries include user_id to satisfy cross-user isolation rules.
   */
  async getDailyGenerationCount(userId: string): Promise<number> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT count FROM tailored_cv_generation_log WHERE user_id = ? AND log_date = CURDATE() LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? Number(rows[0].count) : 0;
  }

  /**
   * Atomically increment today's generation counter and return the new value.
   * Uses ON DUPLICATE KEY UPDATE for safe concurrent writes.
   */
  async incrementDailyGenerationCount(userId: string): Promise<number> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO tailored_cv_generation_log (id, user_id, log_date, count)
         VALUES (?, ?, CURDATE(), 1)
       ON DUPLICATE KEY UPDATE count = count + 1, updated_at = NOW()`,
      [id, userId]
    );
    return this.getDailyGenerationCount(userId);
  }

  /**
   * Insert a new tailored CV record plus all child rows in one transaction.
   * Also bumps version numbering and marks all previous versions for this
   * user+job as is_current=0.
   */
  async createTailoredCv(params: {
    userId: string;
    sourceCvProfileId: string;
    jobId: string;
    jobTitle: string;
    structuredData: CvStructuredProfile;
    generationStatus: string;
    validationStatus: string;
    validationIssues?: string | null;
    regenerationCount?: number;
  }): Promise<FullTailoredCv> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Determine next version number for this user+job pair
      const [verRows] = await conn.query<RowDataPacket[]>(
        `SELECT MAX(version_number) as max_ver FROM tailored_cvs WHERE user_id = ? AND job_id = ?`,
        [params.userId, params.jobId]
      );
      const nextVersion = ((verRows[0]?.max_ver as number) || 0) + 1;

      // Mark all existing versions for this user+job as not current
      await conn.execute(
        `UPDATE tailored_cvs SET is_current = 0 WHERE user_id = ? AND job_id = ?`,
        [params.userId, params.jobId]
      );

      const tailoredId = crypto.randomUUID();
      const contact = params.structuredData.contact_info || {};

      await conn.execute(
        `INSERT INTO tailored_cvs
           (id, user_id, source_cv_profile_id, job_id, job_title, version_number, is_current,
            generation_status, validation_status, validation_issues, regeneration_count,
            full_name, email, phone, location, linkedin_url, website, summary, is_user_edited)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        [
          tailoredId,
          params.userId,
          params.sourceCvProfileId,
          params.jobId,
          params.jobTitle,
          nextVersion,
          params.generationStatus,
          params.validationStatus,
          params.validationIssues || null,
          params.regenerationCount || 0,
          contact.full_name || null,
          contact.email || null,
          contact.phone || null,
          contact.location || null,
          contact.linkedin_url || null,
          contact.website || null,
          params.structuredData.summary || null,
        ]
      );

      // Insert child rows
      await this._insertChildren(conn, tailoredId, params.userId, params.structuredData);

      await conn.commit();
      return this._loadById(params.userId, tailoredId) as Promise<FullTailoredCv>;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Return a single fully-hydrated tailored CV, scoped strictly to userId. */
  async getById(userId: string, tailoredCvId: string): Promise<FullTailoredCv | null> {
    return this._loadById(userId, tailoredCvId);
  }

  /** Return all versions for a given user+job, ordered newest-first. */
  async listByJob(userId: string, jobId: string): Promise<TailoredCvRow[]> {
    const pool = getDbPool();
    const [rows] = await pool.query<TailoredCvRow[]>(
      `SELECT * FROM tailored_cvs WHERE user_id = ? AND job_id = ? ORDER BY version_number DESC`,
      [userId, jobId]
    );
    return rows;
  }

  /**
   * Return current tailored CV versions (is_current = 1) for a user,
   * joined with cached_jobs to include company name.
   * Scoped strictly to userId.
   */
  async listCurrentByUser(userId: string): Promise<TailoredCvSummaryRow[]> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 
         t.id,
         t.job_id,
         t.job_title,
         t.version_number,
         t.created_at,
         c.company
       FROM tailored_cvs t
       LEFT JOIN cached_jobs c ON t.job_id = c.id
       WHERE t.user_id = ? AND t.is_current = 1
       ORDER BY t.created_at DESC`,
      [userId]
    );

    return rows.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      job_id: r.job_id,
      jobTitle: r.job_title,
      job_title: r.job_title,
      company: r.company || null,
      versionNumber: Number(r.version_number),
      version_number: Number(r.version_number),
      createdAt: r.created_at,
      created_at: r.created_at,
    }));
  }

  /** Return the current version for a user+job pair (is_current=1). */
  async getCurrentByJob(userId: string, jobId: string): Promise<FullTailoredCv | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<TailoredCvRow[]>(
      `SELECT * FROM tailored_cvs WHERE user_id = ? AND job_id = ? AND is_current = 1 LIMIT 1`,
      [userId, jobId]
    );
    if (rows.length === 0) return null;
    return this._loadById(userId, rows[0].id);
  }

  /**
   * Update the structured content of an existing tailored CV (user-edit path).
   * Sets is_user_edited=1 and updates child rows.
   * Scoped strictly to userId.
   */
  async updateTailoredCv(
    userId: string,
    tailoredCvId: string,
    structuredData: CvStructuredProfile
  ): Promise<FullTailoredCv | null> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<TailoredCvRow[]>(
        `SELECT * FROM tailored_cvs WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [tailoredCvId, userId]
      );
      if (rows.length === 0) {
        await conn.rollback();
        return null;
      }

      const contact = structuredData.contact_info || {};
      await conn.execute(
        `UPDATE tailored_cvs SET
           full_name = ?, email = ?, phone = ?, location = ?, linkedin_url = ?, website = ?,
           summary = ?, is_user_edited = 1, updated_at = NOW()
         WHERE id = ? AND user_id = ?`,
        [
          contact.full_name || null,
          contact.email || null,
          contact.phone || null,
          contact.location || null,
          contact.linkedin_url || null,
          contact.website || null,
          structuredData.summary || null,
          tailoredCvId,
          userId,
        ]
      );

      // Replace child rows
      await conn.execute(
        `DELETE FROM tailored_cv_work_history WHERE tailored_cv_id = ? AND user_id = ?`,
        [tailoredCvId, userId]
      );
      await conn.execute(
        `DELETE FROM tailored_cv_education WHERE tailored_cv_id = ? AND user_id = ?`,
        [tailoredCvId, userId]
      );
      await conn.execute(
        `DELETE FROM tailored_cv_skills WHERE tailored_cv_id = ? AND user_id = ?`,
        [tailoredCvId, userId]
      );
      await conn.execute(
        `DELETE FROM tailored_cv_certifications WHERE tailored_cv_id = ? AND user_id = ?`,
        [tailoredCvId, userId]
      );

      await this._insertChildren(conn, tailoredCvId, userId, structuredData);

      await conn.commit();
      return this._loadById(userId, tailoredCvId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Update only the generation/validation status columns (no child row changes).
   * Used after a regeneration attempt.
   */
  async updateStatus(
    userId: string,
    tailoredCvId: string,
    params: {
      generationStatus?: string;
      validationStatus?: string;
      validationIssues?: string | null;
      regenerationCount?: number;
    }
  ): Promise<void> {
    const pool = getDbPool();
    const sets: string[] = [];
    const values: any[] = [];

    if (params.generationStatus !== undefined) { sets.push('generation_status = ?'); values.push(params.generationStatus); }
    if (params.validationStatus !== undefined) { sets.push('validation_status = ?'); values.push(params.validationStatus); }
    if (params.validationIssues !== undefined) { sets.push('validation_issues = ?'); values.push(params.validationIssues); }
    if (params.regenerationCount !== undefined) { sets.push('regeneration_count = ?'); values.push(params.regenerationCount); }

    if (sets.length === 0) return;
    sets.push('updated_at = NOW()');
    values.push(tailoredCvId, userId);

    await pool.execute(
      `UPDATE tailored_cvs SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
  }

  /**
   * Test helper: hard-delete all tailored CV data for a list of user IDs.
   * Never exposed via any API route.
   */
  async resetForUsers(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const pool = getDbPool();
    const placeholders = userIds.map(() => '?').join(',');
    await pool.execute(`DELETE FROM tailored_cv_generation_log WHERE user_id IN (${placeholders})`, userIds);
    await pool.execute(`DELETE FROM tailored_cvs WHERE user_id IN (${placeholders})`, userIds);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _loadById(userId: string, tailoredCvId: string): Promise<FullTailoredCv | null> {
    const pool = getDbPool();

    const [cvRows] = await pool.query<TailoredCvRow[]>(
      `SELECT * FROM tailored_cvs WHERE id = ? AND user_id = ? LIMIT 1`,
      [tailoredCvId, userId]
    );
    if (cvRows.length === 0) return null;

    const [workHistory] = await pool.query<TailoredCvWorkHistoryRow[]>(
      `SELECT * FROM tailored_cv_work_history WHERE tailored_cv_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [tailoredCvId, userId]
    );
    const [education] = await pool.query<TailoredCvEducationRow[]>(
      `SELECT * FROM tailored_cv_education WHERE tailored_cv_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [tailoredCvId, userId]
    );
    const [skills] = await pool.query<TailoredCvSkillRow[]>(
      `SELECT * FROM tailored_cv_skills WHERE tailored_cv_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [tailoredCvId, userId]
    );
    const [certifications] = await pool.query<TailoredCvCertificationRow[]>(
      `SELECT * FROM tailored_cv_certifications WHERE tailored_cv_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [tailoredCvId, userId]
    );

    return { tailoredCv: cvRows[0], workHistory, education, skills, certifications };
  }

  private async _insertChildren(
    conn: any,
    tailoredCvId: string,
    userId: string,
    data: CvStructuredProfile
  ): Promise<void> {
    let order = 0;
    for (const w of data.work_history || []) {
      await conn.execute(
        `INSERT INTO tailored_cv_work_history
           (id, tailored_cv_id, user_id, title, company, location, start_date, end_date, is_current, bullet_points, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          tailoredCvId,
          userId,
          w.title || '',
          w.company || null,
          w.location || null,
          w.start_date || null,
          w.end_date || null,
          w.is_current ? 1 : 0,
          JSON.stringify(w.bullet_points || []),
          order++,
        ]
      );
    }

    order = 0;
    for (const e of data.education || []) {
      await conn.execute(
        `INSERT INTO tailored_cv_education
           (id, tailored_cv_id, user_id, institution, degree, field_of_study, start_date, end_date, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          tailoredCvId,
          userId,
          e.institution || '',
          e.degree || null,
          e.field_of_study || null,
          e.start_date || null,
          e.end_date || null,
          order++,
        ]
      );
    }

    order = 0;
    for (const s of data.skills || []) {
      await conn.execute(
        `INSERT INTO tailored_cv_skills
           (id, tailored_cv_id, user_id, skill_name, category, display_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), tailoredCvId, userId, s.skill_name || '', s.category || null, order++]
      );
    }

    order = 0;
    for (const c of data.certifications || []) {
      await conn.execute(
        `INSERT INTO tailored_cv_certifications
           (id, tailored_cv_id, user_id, name, issuing_organization, issue_date, expiration_date, credential_id, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          tailoredCvId,
          userId,
          c.name || '',
          c.issuing_organization || null,
          c.issue_date || null,
          c.expiration_date || null,
          c.credential_id || null,
          order++,
        ]
      );
    }
  }
}

export const tailoredCvDal = new TailoredCvDal();
