import { Request, Response, NextFunction } from 'express';
import { getDbPool } from '../dal/db';
import { RowDataPacket } from 'mysql2/promise';

let tableInitialized = false;

async function ensureRateLimitsTable(): Promise<void> {
  if (tableInitialized) return;
  const pool = getDbPool();
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key_name VARCHAR(191) NOT NULL PRIMARY KEY,
      hits INT NOT NULL DEFAULT 1,
      expires_at DATETIME NOT NULL,
      INDEX idx_rate_limits_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  tableInitialized = true;
}

export async function checkAndIncrementRateLimit(
  bucket: string,
  identifier: string,
  maxHits: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number; currentHits: number }> {
  await ensureRateLimitsTable();
  const pool = getDbPool();
  const keyName = `${bucket}:${identifier}`.toLowerCase();
  const nowMs = Date.now();

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT hits, UNIX_TIMESTAMP(expires_at) as expires_ts FROM rate_limits WHERE key_name = ? AND expires_at > NOW() LIMIT 1',
    [keyName]
  );

  if (rows.length === 0) {
    const expiresAt = new Date(nowMs + windowSeconds * 1000);
    await pool.execute(
      `INSERT INTO rate_limits (key_name, hits, expires_at) VALUES (?, 1, ?)
       ON DUPLICATE KEY UPDATE hits = 1, expires_at = ?`,
      [keyName, expiresAt, expiresAt]
    );
    return { allowed: true, retryAfterSeconds: 0, currentHits: 1 };
  }

  const record = rows[0];
  const expiresTsMs = record.expires_ts * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresTsMs - nowMs) / 1000));

  if (record.hits >= maxHits) {
    return { allowed: false, retryAfterSeconds, currentHits: record.hits };
  }

  await pool.execute('UPDATE rate_limits SET hits = hits + 1 WHERE key_name = ?', [keyName]);
  return { allowed: true, retryAfterSeconds: 0, currentHits: record.hits + 1 };
}

export async function checkRecipientEmailCap(
  recipient: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const pool = getDbPool();
  const trimmed = recipient.toLowerCase().trim();

  // Check 1-hour recipient cap (5 per hour)
  const [hourlyRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM email_outbox WHERE recipient = ? AND created_at >= NOW() - INTERVAL 1 HOUR",
    [trimmed]
  );
  if (hourlyRows[0]?.cnt >= 5) {
    return { allowed: false, retryAfterSeconds: 3600 };
  }

  // Check 24-hour recipient cap (20 per day)
  const [dailyRows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM email_outbox WHERE recipient = ? AND created_at >= NOW() - INTERVAL 1 DAY",
    [trimmed]
  );
  if (dailyRows[0]?.cnt >= 20) {
    return { allowed: false, retryAfterSeconds: 86400 };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function createRateLimiter(bucketName: string, maxHits: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Item 5a: Client IP comes ONLY from req.ip
    const clientIp = req.ip || '127.0.0.1';

    // Item 5b: MySQL-backed Rate Limit check per IP
    const ipLimit = await checkAndIncrementRateLimit(bucketName, clientIp, maxHits, windowSeconds);
    if (!ipLimit.allowed) {
      res.setHeader('Retry-After', ipLimit.retryAfterSeconds.toString());
      res.status(429).json({ message: 'Too many requests. Please try again later.' });
      return;
    }

    // Item 5d: Recipient Email Cap check
    if (req.body?.email && typeof req.body.email === 'string') {
      const recipientCap = await checkRecipientEmailCap(req.body.email);
      if (!recipientCap.allowed) {
        res.setHeader('Retry-After', recipientCap.retryAfterSeconds.toString());
        res.status(429).json({ message: 'Too many requests. Please try again later.' });
        return;
      }
    }

    next();
  };
}

// Item 5c: Dedicated limiter buckets for auth endpoints
export const signupRateLimiter = createRateLimiter('signup', 10, 900);
export const loginRateLimiter = createRateLimiter('login', 10, 900);
export const resetRequestRateLimiter = createRateLimiter('reset_request', 5, 900);
export const resendVerificationRateLimiter = createRateLimiter('resend_verification', 5, 900);
export const verifyEmailRateLimiter = createRateLimiter('verify_email', 20, 900);
export const resetPasswordRateLimiter = createRateLimiter('reset_password', 10, 900);
