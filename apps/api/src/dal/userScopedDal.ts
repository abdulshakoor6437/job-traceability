import { getDbPool } from './db';
import { RowDataPacket } from 'mysql2/promise';

export interface UserSettingsRow extends RowDataPacket {
  id: string;
  user_id: string;
  timezone: string;
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

  async updateSettings(timezone: string): Promise<UserSettingsRow> {
    const pool = getDbPool();
    // Verify existing setting owned by this user
    const existing = await this.getSettings();
    if (!existing) {
      const id = crypto.randomUUID();
      await pool.execute(
        `INSERT INTO user_settings (id, user_id, timezone) VALUES (?, ?, ?)`,
        [id, this.userId, timezone]
      );
    } else {
      await pool.execute(
        `UPDATE user_settings SET timezone = ?, updated_at = NOW() WHERE user_id = ?`,
        [timezone, this.userId]
      );
    }
    const updated = await this.getSettings();
    if (!updated) {
      throw new Error('Failed to retrieve updated user settings.');
    }
    return updated;
  }
}

export function createUserScopedDal(userId: string): UserScopedDal {
  return new UserScopedDal(userId);
}
