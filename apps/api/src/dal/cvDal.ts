import crypto from 'crypto';
import { getDbPool } from './db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { CvStructuredProfile } from '../services/cv/schemaValidator';

export interface CvFileRow extends RowDataPacket {
  id: string;
  user_id: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  raw_text: string | null;
  created_at: Date;
}

export interface CvProfileRow extends RowDataPacket {
  id: string;
  user_id: string;
  cv_file_id: string;
  version_number: number;
  is_active: number;
  needs_review: number;
  parsing_status: string;
  parsing_error: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin_url: string | null;
  website: string | null;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CvWorkHistoryRow extends RowDataPacket {
  id: string;
  cv_profile_id: string;
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

export interface CvEducationRow extends RowDataPacket {
  id: string;
  cv_profile_id: string;
  user_id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  start_date: string | null;
  end_date: string | null;
  display_order: number;
}

export interface CvSkillRow extends RowDataPacket {
  id: string;
  cv_profile_id: string;
  user_id: string;
  skill_name: string;
  category: string | null;
  display_order: number;
}

export interface CvCertificationRow extends RowDataPacket {
  id: string;
  cv_profile_id: string;
  user_id: string;
  name: string;
  issuing_organization: string | null;
  issue_date: string | null;
  expiration_date: string | null;
  credential_id: string | null;
  display_order: number;
}

export interface FullCvProfile {
  profile: CvProfileRow;
  file?: CvFileRow;
  workHistory: CvWorkHistoryRow[];
  education: CvEducationRow[];
  skills: CvSkillRow[];
  certifications: CvCertificationRow[];
}

export class CvDal {
  async createCvFile(
    userId: string,
    originalFilename: string,
    storageKey: string,
    mimeType: string,
    fileSizeBytes: number,
    rawText: string | null
  ): Promise<CvFileRow> {
    const pool = getDbPool();
    const fileId = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO user_cv_files (id, user_id, original_filename, storage_key, mime_type, file_size_bytes, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fileId, userId, originalFilename, storageKey, mimeType, fileSizeBytes, rawText]
    );

    const [rows] = await pool.query<CvFileRow[]>(`SELECT * FROM user_cv_files WHERE id = ? AND user_id = ?`, [fileId, userId]);
    return rows[0];
  }

  async createCvProfile(
    userId: string,
    cvFileId: string,
    structuredData: CvStructuredProfile,
    needsReview: boolean,
    parsingStatus: string = 'completed',
    parsingError: string | null = null
  ): Promise<FullCvProfile> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Determine next version number for this user
      const [verRows] = await conn.query<RowDataPacket[]>(
        `SELECT MAX(version_number) as max_ver FROM cv_profiles WHERE user_id = ?`,
        [userId]
      );
      const nextVersion = (verRows[0]?.max_ver || 0) + 1;

      // Deactivate current active profile for this user
      await conn.execute(`UPDATE cv_profiles SET is_active = 0 WHERE user_id = ?`, [userId]);

      const profileId = crypto.randomUUID();
      const contact = structuredData.contact_info || {};

      await conn.execute(
        `INSERT INTO cv_profiles (id, user_id, cv_file_id, version_number, is_active, needs_review, parsing_status, parsing_error, full_name, email, phone, location, linkedin_url, website, summary)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profileId,
          userId,
          cvFileId,
          nextVersion,
          needsReview ? 1 : 0,
          parsingStatus,
          parsingError,
          contact.full_name || null,
          contact.email || null,
          contact.phone || null,
          contact.location || null,
          contact.linkedin_url || null,
          contact.website || null,
          structuredData.summary || null,
        ]
      );

      // Insert work history
      let order = 0;
      for (const w of structuredData.work_history || []) {
        await conn.execute(
          `INSERT INTO cv_work_history (id, cv_profile_id, user_id, title, company, location, start_date, end_date, is_current, bullet_points, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      // Insert education
      order = 0;
      for (const e of structuredData.education || []) {
        await conn.execute(
          `INSERT INTO cv_education (id, cv_profile_id, user_id, institution, degree, field_of_study, start_date, end_date, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      // Insert skills
      order = 0;
      for (const s of structuredData.skills || []) {
        await conn.execute(
          `INSERT INTO cv_skills (id, cv_profile_id, user_id, skill_name, category, display_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), profileId, userId, s.skill_name || '', s.category || null, order++]
        );
      }

      // Insert certifications
      order = 0;
      for (const c of structuredData.certifications || []) {
        await conn.execute(
          `INSERT INTO cv_certifications (id, cv_profile_id, user_id, name, issuing_organization, issue_date, expiration_date, credential_id, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      await conn.commit();

      return this.getProfileById(userId, profileId) as Promise<FullCvProfile>;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getActiveProfile(userId: string): Promise<FullCvProfile | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<CvProfileRow[]>(
      `SELECT * FROM cv_profiles WHERE user_id = ? AND is_active = 1 LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) return null;
    return this.getProfileById(userId, rows[0].id);
  }

  async getProfileById(userId: string, profileId: string): Promise<FullCvProfile | null> {
    const pool = getDbPool();
    const [pRows] = await pool.query<CvProfileRow[]>(
      `SELECT * FROM cv_profiles WHERE id = ? AND user_id = ? LIMIT 1`,
      [profileId, userId]
    );

    if (pRows.length === 0) return null;
    const profile = pRows[0];

    const [fileRows] = await pool.query<CvFileRow[]>(
      `SELECT * FROM user_cv_files WHERE id = ? AND user_id = ? LIMIT 1`,
      [profile.cv_file_id, userId]
    );

    const [workHistory] = await pool.query<CvWorkHistoryRow[]>(
      `SELECT * FROM cv_work_history WHERE cv_profile_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [profileId, userId]
    );

    const [education] = await pool.query<CvEducationRow[]>(
      `SELECT * FROM cv_education WHERE cv_profile_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [profileId, userId]
    );

    const [skills] = await pool.query<CvSkillRow[]>(
      `SELECT * FROM cv_skills WHERE cv_profile_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [profileId, userId]
    );

    const [certifications] = await pool.query<CvCertificationRow[]>(
      `SELECT * FROM cv_certifications WHERE cv_profile_id = ? AND user_id = ? ORDER BY display_order ASC`,
      [profileId, userId]
    );

    return {
      profile,
      file: fileRows[0] || undefined,
      workHistory,
      education,
      skills,
      certifications,
    };
  }

  async getProfilesByUserId(userId: string): Promise<CvProfileRow[]> {
    const pool = getDbPool();
    const [rows] = await pool.query<CvProfileRow[]>(
      `SELECT * FROM cv_profiles WHERE user_id = ? ORDER BY version_number DESC`,
      [userId]
    );
    return rows;
  }

  async setActiveProfile(userId: string, profileId: string): Promise<boolean> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Check profile exists for user
      const [pRows] = await conn.query<CvProfileRow[]>(
        `SELECT id FROM cv_profiles WHERE id = ? AND user_id = ? LIMIT 1`,
        [profileId, userId]
      );

      if (pRows.length === 0) {
        await conn.rollback();
        return false;
      }

      await conn.execute(`UPDATE cv_profiles SET is_active = 0 WHERE user_id = ?`, [userId]);
      await conn.execute(`UPDATE cv_profiles SET is_active = 1 WHERE id = ? AND user_id = ?`, [profileId, userId]);

      await conn.commit();
      return true;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async updateProfile(userId: string, profileId: string, updatedData: CvStructuredProfile): Promise<FullCvProfile | null> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Item 6 Rule: Non-active profile cannot be edited
      const [pRows] = await conn.query<CvProfileRow[]>(
        `SELECT * FROM cv_profiles WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [profileId, userId]
      );

      if (pRows.length === 0) {
        await conn.rollback();
        return null;
      }

      if (!pRows[0].is_active) {
        await conn.rollback();
        throw new Error('Non-active CV versions cannot be edited. Switch active version first.');
      }

      const contact = updatedData.contact_info || {};
      await conn.execute(
        `UPDATE cv_profiles SET
           full_name = ?, email = ?, phone = ?, location = ?, linkedin_url = ?, website = ?, summary = ?, needs_review = 0, updated_at = NOW()
         WHERE id = ? AND user_id = ?`,
        [
          contact.full_name || null,
          contact.email || null,
          contact.phone || null,
          contact.location || null,
          contact.linkedin_url || null,
          contact.website || null,
          updatedData.summary || null,
          profileId,
          userId,
        ]
      );

      // Replace child rows
      await conn.execute(`DELETE FROM cv_work_history WHERE cv_profile_id = ? AND user_id = ?`, [profileId, userId]);
      await conn.execute(`DELETE FROM cv_education WHERE cv_profile_id = ? AND user_id = ?`, [profileId, userId]);
      await conn.execute(`DELETE FROM cv_skills WHERE cv_profile_id = ? AND user_id = ?`, [profileId, userId]);
      await conn.execute(`DELETE FROM cv_certifications WHERE cv_profile_id = ? AND user_id = ?`, [profileId, userId]);

      // Re-insert work history
      let order = 0;
      for (const w of updatedData.work_history || []) {
        await conn.execute(
          `INSERT INTO cv_work_history (id, cv_profile_id, user_id, title, company, location, start_date, end_date, is_current, bullet_points, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      // Re-insert education
      order = 0;
      for (const e of updatedData.education || []) {
        await conn.execute(
          `INSERT INTO cv_education (id, cv_profile_id, user_id, institution, degree, field_of_study, start_date, end_date, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      // Re-insert skills
      order = 0;
      for (const s of updatedData.skills || []) {
        await conn.execute(
          `INSERT INTO cv_skills (id, cv_profile_id, user_id, skill_name, category, display_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), profileId, userId, s.skill_name || '', s.category || null, order++]
        );
      }

      // Re-insert certifications
      order = 0;
      for (const c of updatedData.certifications || []) {
        await conn.execute(
          `INSERT INTO cv_certifications (id, cv_profile_id, user_id, name, issuing_organization, issue_date, expiration_date, credential_id, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            crypto.randomUUID(),
            profileId,
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

      await conn.commit();
      return this.getProfileById(userId, profileId);
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async deleteCvProfile(userId: string, profileId: string): Promise<{ success: boolean; storageKey?: string }> {
    const pool = getDbPool();
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // Check profile belongs to userId
      const [pRows] = await conn.query<CvProfileRow[]>(
        `SELECT * FROM cv_profiles WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [profileId, userId]
      );

      if (pRows.length === 0) {
        await conn.rollback();
        return { success: false };
      }

      const profile = pRows[0];
      const cvFileId = profile.cv_file_id;
      const wasActive = Boolean(profile.is_active);

      // Get storage key
      const [fRows] = await conn.query<CvFileRow[]>(
        `SELECT storage_key FROM user_cv_files WHERE id = ? AND user_id = ? LIMIT 1`,
        [cvFileId, userId]
      );

      const storageKey = fRows[0]?.storage_key;

      // Delete profile record (cascades child tables and file record via FK)
      await conn.execute(`DELETE FROM cv_profiles WHERE id = ? AND user_id = ?`, [profileId, userId]);
      await conn.execute(`DELETE FROM user_cv_files WHERE id = ? AND user_id = ?`, [cvFileId, userId]);

      // If deleted profile was active, set most recent remaining profile as active
      if (wasActive) {
        const [remRows] = await conn.query<CvProfileRow[]>(
          `SELECT id FROM cv_profiles WHERE user_id = ? ORDER BY version_number DESC LIMIT 1`,
          [userId]
        );
        if (remRows.length > 0) {
          await conn.execute(`UPDATE cv_profiles SET is_active = 1 WHERE id = ? AND user_id = ?`, [remRows[0].id, userId]);
        }
      }

      await conn.commit();
      return { success: true, storageKey };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

export const cvDal = new CvDal();
