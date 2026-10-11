import crypto from 'crypto';
import { getDbPool } from './db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface UserSettingsRow extends RowDataPacket {
  id: string;
  user_id: string;
  timezone: string;
  email_digest_opt_out: number;
  last_digest_sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserProfileRow extends RowDataPacket {
  id: string;
  email: string;
  is_verified: number;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export class UserScopedDal {
  private readonly userId: string;

  constructor(userId: string) {
    if (!userId) {
      throw new Error('UserScopedDal requires a valid userId context.');
    }
    this.userId = userId;
  }

  public getUserId(): string {
    return this.userId;
  }

  async getProfile(): Promise<UserProfileRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<UserProfileRow[]>(
      `SELECT id, email, is_verified, last_active_at, created_at, updated_at FROM users WHERE id = ? LIMIT 1`,
      [this.userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async touchLastActive(): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE users SET last_active_at = NOW() WHERE id = ?`,
      [this.userId]
    );
  }

  async getSettings(): Promise<UserSettingsRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<UserSettingsRow[]>(
      `SELECT * FROM user_settings WHERE user_id = ? LIMIT 1`,
      [this.userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Item 13 & 14: Validate timezone and perform atomic UPSERT with UNIQUE(user_id)
  async updateSettings(timezone: string): Promise<UserSettingsRow> {
    if (!timezone || !isValidIanaTimezone(timezone)) {
      throw new Error(`Invalid IANA timezone string: '${timezone}'.`);
    }

    const pool = getDbPool();
    const id = crypto.randomUUID();

    // Atomic UPSERT using ON DUPLICATE KEY UPDATE (Item 14)
    await pool.execute(
      `INSERT INTO user_settings (id, user_id, timezone) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE timezone = VALUES(timezone), updated_at = NOW()`,
      [id, this.userId, timezone]
    );

    const updated = await this.getSettings();
    if (!updated) {
      throw new Error('Failed to retrieve updated user settings.');
    }
    return updated;
  }

  async updateDigestOptOut(optOut: boolean): Promise<UserSettingsRow> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    const val = optOut ? 1 : 0;

    await pool.execute(
      `INSERT INTO user_settings (id, user_id, email_digest_opt_out) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE email_digest_opt_out = VALUES(email_digest_opt_out), updated_at = NOW()`,
      [id, this.userId, val]
    );

    const updated = await this.getSettings();
    if (!updated) {
      throw new Error('Failed to retrieve updated user settings.');
    }
    return updated;
  }

  async getUnreadDigestNotifications(): Promise<UserNotificationRow[]> {
    const pool = getDbPool();
    const settings = await this.getSettings();
    const lastSent = settings?.last_digest_sent_at;

    let sql = `SELECT * FROM user_notifications WHERE user_id = ? AND is_read = 0 AND type = 'high_match'`;
    const params: any[] = [this.userId];

    if (lastSent) {
      sql += ` AND created_at > ?`;
      params.push(lastSent);
    }
    sql += ` ORDER BY created_at DESC`;

    const [rows] = await pool.query<UserNotificationRow[]>(sql, params);
    return rows;
  }

  async markDigestSent(): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE user_settings SET last_digest_sent_at = NOW() WHERE user_id = ?`,
      [this.userId]
    );
  }

  async getSearchPreferences(): Promise<UserSearchPreferencesRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<UserSearchPreferencesRow[]>(
      `SELECT * FROM user_search_preferences WHERE user_id = ? LIMIT 1`,
      [this.userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async updateSearchPreferences(role: string, location?: string | null, filters?: any): Promise<UserSearchPreferencesRow> {
    if (!role || !role.trim()) {
      throw new Error('Role string is required for search preferences.');
    }

    const pool = getDbPool();
    const id = crypto.randomUUID();
    const filtersJson = filters !== undefined && filters !== null ? JSON.stringify(filters) : null;
    const cleanLocation = location && typeof location === 'string' ? location.trim() : null;

    await pool.execute(
      `INSERT INTO user_search_preferences (id, user_id, role, location, filters_json)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         role = VALUES(role),
         location = VALUES(location),
         filters_json = VALUES(filters_json),
         updated_at = NOW()`,
      [id, this.userId, role.trim(), cleanLocation, filtersJson]
    );

    const updated = await this.getSearchPreferences();
    if (!updated) {
      throw new Error('Failed to retrieve updated user search preferences.');
    }
    return updated;
  }

  // --- Notifications DAL Methods (Module 8 Item 1) ---

  async getNotifications(options?: { unreadOnly?: boolean; limit?: number }): Promise<{
    notifications: UserNotificationRow[];
    unreadCount: number;
  }> {
    const pool = getDbPool();
    const limit = options?.limit || 50;

    let sql = `SELECT * FROM user_notifications WHERE user_id = ?`;
    const params: any[] = [this.userId];

    if (options?.unreadOnly) {
      sql += ` AND is_read = 0`;
    }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const [notifications] = await pool.query<UserNotificationRow[]>(sql, params);

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as unread_count FROM user_notifications WHERE user_id = ? AND is_read = 0`,
      [this.userId]
    );

    return {
      notifications,
      unreadCount: countRows[0]?.unread_count || 0,
    };
  }

  async markNotificationRead(notificationId: string): Promise<boolean> {
    const pool = getDbPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [notificationId, this.userId]
    );
    return result.affectedRows > 0;
  }

  async markAllNotificationsRead(): Promise<number> {
    const pool = getDbPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE user_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [this.userId]
    );
    return result.affectedRows;
  }

  async createNotification(
    type: string,
    message: string,
    relatedJobId?: string | null,
    relatedTailoredCvId?: string | null
  ): Promise<UserNotificationRow> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    const cleanJobId = relatedJobId !== undefined && relatedJobId !== null ? relatedJobId : null;
    const cleanCvId = relatedTailoredCvId !== undefined && relatedTailoredCvId !== null ? relatedTailoredCvId : null;

    await pool.execute(
      `INSERT INTO user_notifications (id, user_id, type, message, related_job_id, related_tailored_cv_id, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, NOW())`,
      [id, this.userId, type, message, cleanJobId, cleanCvId]
    );

    const [rows] = await pool.query<UserNotificationRow[]>(
      `SELECT * FROM user_notifications WHERE id = ? AND user_id = ? LIMIT 1`,
      [id, this.userId]
    );
    return rows[0];
  }

  async getTodayNotificationCount(): Promise<number> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as today_count FROM user_notifications 
       WHERE user_id = ? AND DATE(created_at) = CURDATE()`,
      [this.userId]
    );
    return rows[0]?.today_count || 0;
  }

  async hasNotificationForJob(jobId: string): Promise<boolean> {
    if (!jobId) return false;
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM user_notifications WHERE user_id = ? AND related_job_id = ? LIMIT 1`,
      [this.userId, jobId]
    );
    return rows.length > 0;
  }
}

export interface UserSearchPreferencesRow extends RowDataPacket {
  id: string;
  user_id: string;
  role: string;
  location: string | null;
  filters_json: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserNotificationRow extends RowDataPacket {
  id: string;
  user_id: string;
  type: string;
  message: string;
  related_job_id: string | null;
  related_tailored_cv_id: string | null;
  is_read: number;
  created_at: Date;
}

export function createUserScopedDal(userId: string): UserScopedDal {
  return new UserScopedDal(userId);
}
