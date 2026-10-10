import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authDal } from '../dal/authDal';
import { config } from '../config/env';

// Dummy bcrypt hash for constant-time comparison when email is unknown (Item 9)
const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export function isValidEmailFormat(email: string): boolean {
  if (!email || email.length > 255) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class AuthService {
  async signup(email: string, password: string): Promise<{ message: string }> {
    const trimmedEmail = email.toLowerCase().trim();
    const genericResponse = {
      message: 'If your email is valid, a verification link has been sent.',
    };

    try {
      if (!isValidEmailFormat(email)) {
        throw new Error('Invalid email address format.');
      }

      const passwordBytes = Buffer.byteLength(password, 'utf8');
      if (password.length < 10) {
        throw new Error('Password must be at least 10 characters long.');
      }
      if (passwordBytes > 72) {
        throw new Error('Password exceeds maximum length of 72 bytes.');
      }

      const existing = await authDal.findUserByEmail(trimmedEmail);

      if (existing) {
        // Item 5 & 6: Run dummy bcrypt hash for timing parity with new signup (~100ms)
        await bcrypt.hash(password, 10);

        // Item 5: Existing account signup handling
        if (!existing.is_verified) {
          // Unverified: Enqueue outbox email with userId only (token created at send time in worker)
          await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'verification', trimmedEmail, {
            userId: existing.id,
          });
        } else {
          // Verified: Send "already registered" email with login & reset links without overwriting password
          await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'already_registered', trimmedEmail, {});
        }

        return genericResponse;
      }

      // New account creation
      const userId = crypto.randomUUID();
      const passwordHash = await bcrypt.hash(password, 10);
      await authDal.createUser(userId, trimmedEmail, passwordHash);

      // Item 4: Enqueue outbox email with userId only
      await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'verification', trimmedEmail, {
        userId,
      });

      return genericResponse;
    } catch (error: any) {
      // Item 7: Catch duplicate-key errors on concurrent signup and treat as existing account
      if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062 || error.message?.includes('ER_DUP_ENTRY')) {
        const existing = await authDal.findUserByEmail(trimmedEmail);
        if (existing) {
          if (!existing.is_verified) {
            await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'verification', trimmedEmail, { userId: existing.id });
          } else {
            await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'already_registered', trimmedEmail, {});
          }
          return genericResponse;
        }
      }

      console.error('[SIGNUP ERROR DETAILS]', error);
      if (error.message.includes('at least 10 characters') || error.message.includes('72 bytes') || error.message.includes('Invalid email')) {
        throw error;
      }
      throw new Error('Signup failed. Please try again later.');
    }
  }

  async verifyEmail(rawToken: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    // Item 8: Single atomic UPDATE consumption requiring unexpired & unused token
    const result = await authDal.consumeEmailVerificationToken(tokenHash);
    return result.success;
  }

  async resendVerification(email: string): Promise<string> {
    const genericMsg = 'If an unverified account exists with that email, a verification link has been sent.';
    if (!isValidEmailFormat(email)) return genericMsg;

    const trimmedEmail = email.toLowerCase().trim();
    const user = await authDal.findUserByEmail(trimmedEmail);

    if (user && !user.is_verified) {
      // Item 4: Enqueue outbox with userId only
      await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'verification', trimmedEmail, {
        userId: user.id,
      });
    }

    return genericMsg;
  }

  async login(
    email: string,
    password: string,
    clientIp: string = '127.0.0.1'
  ): Promise<{ rawToken: string; userId: string } | { error: string } | { rateLimited: true; retryAfterSeconds: number }> {
    const trimmedEmail = email.toLowerCase().trim();
    const trackKey = crypto.createHash('sha256').update(`${trimmedEmail}:${clientIp}`).digest('hex');

    // Item 2: MySQL-backed failed login attempts rate limit check (7 failures in 15 minutes)
    const accountLimit = await authDal.checkRateLimit('login_account', trackKey, 7);
    if (!accountLimit.allowed) {
      return { rateLimited: true, retryAfterSeconds: accountLimit.retryAfterSeconds };
    }

    // Item 13: Validate password byte length
    const passwordBytes = Buffer.byteLength(password, 'utf8');
    if (passwordBytes > 72) {
      await authDal.recordFailedLogin(trackKey, 7, 900);
      return { error: 'Invalid credentials.' };
    }

    const user = await authDal.findUserByEmail(trimmedEmail);

    if (!user) {
      // Item 9: Constant-time dummy compare when email is unknown
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      await authDal.recordFailedLogin(trackKey, 7, 900);
      return { error: 'Invalid credentials.' };
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await authDal.recordFailedLogin(trackKey, 7, 900);
      return { error: 'Invalid credentials.' };
    }

    // Reset failed login rate limit on successful login
    await authDal.clearFailedLogin(trackKey);

    if (!user.is_verified) {
      return { error: 'Email is not verified. Please verify your email address before logging in.' };
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const sessionId = crypto.randomUUID();

    const now = Date.now();
    const expiresAt = new Date(now + config.session.maxLifetimeHours * 60 * 60 * 1000);
    const idleExpiresAt = new Date(now + config.session.idleTimeoutMinutes * 60 * 1000);

    await authDal.createSession(
      sessionId,
      user.id,
      tokenHash,
      expiresAt,
      idleExpiresAt
    );

    // Schedule background job on login (Item 3 & Test a)
    const { agentSessionService } = require('./agentSessionService');
    await agentSessionService.scheduleUserJob(user.id).catch((err: any) => {
      console.warn(`Failed to schedule job on login: ${err.message}`);
    });

    return { rawToken, userId: user.id };
  }

  async validateAndTouchSession(
    rawToken: string,
    isActivityRoute: boolean = false
  ): Promise<{ userId: string; sessionId: string } | null> {
    const tokenHash = hashToken(rawToken);
    const session = await authDal.findSessionByTokenHash(tokenHash);

    if (!session) {
      return null;
    }

    const now = new Date();

    if (now > new Date(session.expires_at)) {
      await authDal.deleteSession(session.id);
      const { agentSessionService } = require('./agentSessionService');
      await agentSessionService.removeUserJob(session.user_id).catch(() => {});
      return null;
    }

    if (now > new Date(session.idle_expires_at)) {
      await authDal.deleteSession(session.id);
      const { agentSessionService } = require('./agentSessionService');
      await agentSessionService.removeUserJob(session.user_id).catch(() => {});
      return null;
    }

    if (isActivityRoute) {
      const nextIdleMs = Date.now() + config.session.idleTimeoutMinutes * 60 * 1000;
      const maxExpiryMs = new Date(session.expires_at).getTime();
      const finalIdleMs = Math.min(nextIdleMs, maxExpiryMs);
      const newIdleExpiresAt = new Date(finalIdleMs);

      await authDal.touchSession(session.id, newIdleExpiresAt);

      // Ensure active user background job is scheduled on heartbeat/activity
      const { agentSessionService } = require('./agentSessionService');
      await agentSessionService.scheduleUserJob(session.user_id).catch(() => {});
    }

    return { userId: session.user_id, sessionId: session.id };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const session = await authDal.findSessionByTokenHash(tokenHash);
    if (session) {
      await authDal.deleteSessionByTokenHash(tokenHash);
      const { agentSessionService } = require('./agentSessionService');
      await agentSessionService.removeUserJob(session.user_id).catch((err: any) => {
        console.warn(`Failed to remove job on logout: ${err.message}`);
      });
    }
  }

  async requestPasswordReset(email: string): Promise<string> {
    const genericMsg = 'If an account exists with that email, a password reset link has been sent.';
    if (!isValidEmailFormat(email)) return genericMsg;

    const trimmedEmail = email.toLowerCase().trim();
    const user = await authDal.findUserByEmail(trimmedEmail);

    if (user) {
      // Item 4 & 6: Enqueue outbox email with userId only
      await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'password_reset', trimmedEmail, {
        userId: user.id,
      });
    } else {
      // Item 6: Enqueue dummy outbox item to ensure identical work (1 SELECT + 1 INSERT) for unknown emails
      await authDal.enqueueOutboxEmail(crypto.randomUUID(), 'dummy_timing', 'dummy_timing_check@localhost', {
        userId: '00000000-0000-0000-0000-000000000000',
      });
    }

    return genericMsg;
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    const passwordBytes = Buffer.byteLength(newPassword, 'utf8');
    if (newPassword.length < 10) {
      throw new Error('Password must be at least 10 characters long.');
    }
    if (passwordBytes > 72) {
      throw new Error('Password exceeds maximum length of 72 bytes.');
    }

    const tokenHash = hashToken(rawToken);
    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    // Item 8: Single atomic UPDATE consumption
    const result = await authDal.consumePasswordResetToken(tokenHash, newPasswordHash);
    return result.success;
  }
}

function rawVerificationTokenOrReset(rawToken: string) {
  return rawToken;
}

export const authService = new AuthService();
