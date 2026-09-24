import crypto from 'crypto';
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

export interface OutboxRow extends RowDataPacket {
  id: string;
  type: string;
  recipient: string;
  payload: string;
  status: string;
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

export class AuthDal {
  async createUser(id: string, email: string, passwordHash: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, ?, 0)`,
      [id, email.toLowerCase().trim(), passwordHash]
    );

    const settingsId = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO user_settings (id, user_id, timezone) VALUES (?, ?, 'UTC') ON DUPLICATE KEY UPDATE user_id = user_id`,
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

  async deleteEmailVerificationTokens(userId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM email_verifications WHERE user_id = ?`,
      [userId]
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

  // Atomic consumption of verification token (Item 8)
  async consumeEmailVerificationToken(tokenHash: string): Promise<{ success: boolean; userId?: string }> {
    const pool = getDbPool();
    const record = await this.findEmailVerificationToken(tokenHash);

    if (!record) {
      return { success: false };
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE email_verifications SET used_at = NOW() WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [record.id]
    );

    if (result.affectedRows === 1) {
      await this.setUserVerified(record.user_id);
      return { success: true, userId: record.user_id };
    }

    return { success: false };
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

  // Atomic consumption of password reset token (Item 8)
  async consumePasswordResetToken(tokenHash: string, newPasswordHash: string): Promise<{ success: boolean; userId?: string }> {
    const pool = getDbPool();
    const record = await this.findPasswordResetToken(tokenHash);

    if (!record) {
      return { success: false };
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE password_resets SET used_at = NOW() WHERE id = ? AND used_at IS NULL AND expires_at > NOW()`,
      [record.id]
    );

    if (result.affectedRows === 1) {
      await this.updateUserPassword(record.user_id, newPasswordHash);
      await this.deleteUserSessions(record.user_id);
      return { success: true, userId: record.user_id };
    }

    return { success: false };
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

  async deletePasswordResetTokens(userId: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `DELETE FROM password_resets WHERE user_id = ?`,
      [userId]
    );
  }

  // Suppression Methods (Item 3)
  async isEmailSuppressed(email: string): Promise<boolean> {
    const pool = getDbPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM suppressed_addresses WHERE email = ? LIMIT 1`,
      [email.toLowerCase().trim()]
    );
    return rows.length > 0;
  }

  async suppressEmail(email: string, reason: string = 'bounce'): Promise<void> {
    const pool = getDbPool();
    const id = crypto.randomUUID();
    await pool.execute(
      `INSERT IGNORE INTO suppressed_addresses (id, email, reason) VALUES (?, ?, ?)`,
      [id, email.toLowerCase().trim(), reason]
    );
  }

  // Outbox Methods (Item 2 & Item 4)
  async enqueueOutboxEmail(id: string, type: string, recipient: string, payload: any): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO email_outbox (id, type, recipient, payload, status, next_attempt_at) VALUES (?, ?, ?, ?, 'pending', NOW())`,
      [id, type, recipient.toLowerCase().trim(), JSON.stringify(payload)]
    );
  }

  async findPendingOutboxEmails(limit: number = 10): Promise<OutboxRow[]> {
    const pool = getDbPool();
    const [rows] = await pool.query<OutboxRow[]>(
      `SELECT * FROM email_outbox WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY created_at ASC LIMIT ?`,
      [limit]
    );
    return rows;
  }

  // Item 4: Blank payload when item reaches sent
  async markOutboxSent(id: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE email_outbox SET status = 'sent', payload = '{}', sent_at = NOW() WHERE id = ?`,
      [id]
    );
  }

  // Item 4: Blank payload when item reaches failed
  async markOutboxFailed(id: string, lastError: string, nextAttemptAt: Date): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE email_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, status = IF(attempts >= 5, 'failed', 'pending'), payload = IF(attempts >= 4, '{}', payload) WHERE id = ?`,
      [lastError, nextAttemptAt, id]
    );
  }

  // Item 4: Blank payload when item reaches suppressed
  async markOutboxSuppressed(id: string): Promise<void> {
    const pool = getDbPool();
    await pool.execute(
      `UPDATE email_outbox SET status = 'suppressed', payload = '{}', last_error = 'Recipient address suppressed' WHERE id = ?`,
      [id]
    );
  }

  // Item 4: Purge terminal rows older than days
  async purgeOldOutboxRows(days: number = 7): Promise<number> {
    const pool = getDbPool();
    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM email_outbox WHERE status IN ('sent', 'suppressed', 'failed') AND created_at < NOW() - INTERVAL ? DAY`,
      [days]
    );
    return result.affectedRows;
  }
}

export const authDal = new AuthDal();
