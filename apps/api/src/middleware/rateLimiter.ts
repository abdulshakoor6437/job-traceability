import { Request, Response, NextFunction } from 'express';
import { authDal } from '../dal/authDal';

export async function checkAndIncrementRateLimit(
  bucket: string,
  identifier: string,
  maxHits: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfterSeconds: number; currentHits: number }> {
  return authDal.checkAndIncrementRateLimit(bucket, identifier, maxHits, windowSeconds);
}

export async function checkRecipientEmailCap(
  recipient: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  return authDal.checkRecipientEmailCap(recipient);
}

export function createRateLimiter(bucketName: string, maxHits: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Item 5a: Client IP comes ONLY from req.ip
    const clientIp = req.ip || '127.0.0.1';

    // Item 5b: MySQL-backed Rate Limit check per IP via authDal
    const ipLimit = await authDal.checkAndIncrementRateLimit(bucketName, clientIp, maxHits, windowSeconds);
    if (!ipLimit.allowed) {
      res.setHeader('Retry-After', ipLimit.retryAfterSeconds.toString());
      res.status(429).json({ message: 'Too many requests. Please try again later.' });
      return;
    }

    // Item 5d: Recipient Email Cap check via authDal
    if (req.body?.email && typeof req.body.email === 'string') {
      const recipientCap = await authDal.checkRecipientEmailCap(req.body.email);
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
