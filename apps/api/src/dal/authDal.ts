import { getDbPool } from './db';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  is_verified: number;
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  last_accessed_at: Date;
  expires_at: Date;
  idle_expires_at: Date;
}

export interface TokenRow extends RowDataPacket {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
  created_at: Date;
}

export class AuthDal {
  async createUser(id: string, email: string, passwordHash: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, ?, 0)`,
      [id, email.toLowerCase().trim(), passwordHash]
    );

    // Create default settings for user
    const settingsId = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO user_settings (id, user_id, timezone) VALUES (?, ?, 'UTC')`,
      [settingsId, id]
    );
  }

  async findUserByEmail(email: string): Promise<UserRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<UserRow[]>(
      `SELECT * FROM users WHERE email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async findUserById(userId: string): Promise<UserRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<UserRow[]>(
      `SELECT * FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async setUserVerified(userId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE users SET is_verified = 1 WHERE id = ?`,
      [userId]
    );
  }

  async createEmailVerificationToken(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO email_verifications (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [id, userId, tokenHash, expiresAt]
    );
  }

  async findEmailVerificationToken(tokenHash: string): Promise<TokenRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<TokenRow[]>(
      `SELECT * FROM email_verifications WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async markEmailVerificationTokenUsed(tokenId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE email_verifications SET used_at = NOW() WHERE id = ?`,
      [tokenId]
    );
  }

  async createPasswordResetToken(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [id, userId, tokenHash, expiresAt]
    );
  }

  async findPasswordResetToken(tokenHash: string): Promise<TokenRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<TokenRow[]>(
      `SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [tokenHash]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE password_resets SET used_at = NOW() WHERE id = ?`,
      [tokenId]
    );
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
      [passwordHash, userId]
    );
  }

  async createSession(
    id: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    idleExpiresAt: Date
  ): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (?, ?, ?, ?, ?)`,
      [id, userId, tokenHash, expiresAt, idleExpiresAt]
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const pool = getDbPool();
    const [rows] = await pool.query<SessionRow[]>(
      `SELECT * FROM user_sessions WHERE token_hash = ? LIMIT 1`,
      [tokenHash]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async touchSession(sessionId: string, newIdleExpiresAt: Date): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE user_sessions SET last_accessed_at = NOW(), idle_expires_at = ? WHERE id = ?`,
      [newIdleExpiresAt, sessionId]
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM user_sessions WHERE id = ?`,
      [sessionId]
    );
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM user_sessions WHERE token_hash = ?`,
      [tokenHash]
    );
  }

  async deleteUserSessions(userId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM user_sessions WHERE user_id = ?`,
      [userId]
    );
  }
}

export const authDal = new AuthDal();
