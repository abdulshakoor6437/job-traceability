import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authDal } from '../dal/authDal';
import { emailService } from './emailService';
import { config } from '../config/env';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class AuthService {
  async signup(email: string, password: string): Promise<{ message: string; rawToken?: string }> {
    if (!password || password.length < 10) {
      throw new Error('Password must be at least 10 characters long.');
    }

    const trimmedEmail = email.toLowerCase().trim();
    const existing = await authDal.findUserByEmail(trimmedEmail);

    if (existing) {
      return { message: 'If your email is valid, a verification link has been sent.' };
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    await authDal.createUser(userId, trimmedEmail, passwordHash);

    // Create verification token
    const rawVerificationToken = generateOpaqueToken();
    const tokenHash = hashToken(rawVerificationToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const verificationId = crypto.randomUUID();

    await authDal.createEmailVerificationToken(
      verificationId,
      userId,
      tokenHash,
      expiresAt
    );

    const verifyUrl = `${config.appUrl}/verify-email?token=${rawVerificationToken}`;
    await emailService.sendVerificationEmail(trimmedEmail, rawVerificationToken, verifyUrl);

    return {
      message: 'If your email is valid, a verification link has been sent.',
      rawToken: rawVerificationToken, // Provided for test automation
    };
  }

  async verifyEmail(rawToken: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const record = await authDal.findEmailVerificationToken(tokenHash);

    if (!record) {
      return false;
    }

    await authDal.setUserVerified(record.user_id);
    await authDal.markEmailVerificationTokenUsed(record.id);
    return true;
  }

  async login(
    email: string,
    password: string
  ): Promise<{ rawToken: string; userId: string } | { error: string }> {
    const trimmedEmail = email.toLowerCase().trim();
    const user = await authDal.findUserByEmail(trimmedEmail);

    if (!user) {
      return { error: 'Invalid credentials.' };
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return { error: 'Invalid credentials.' };
    }

    // Require email verification (Item 2b)
    if (!user.is_verified) {
      return { error: 'Email is not verified. Please verify your email address before logging in.' };
    }

    // Generate session
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

    return { rawToken, userId: user.id };
  }

  async validateAndTouchSession(
    rawToken: string,
    isPassive: boolean = false
  ): Promise<{ userId: string; sessionId: string } | null> {
    const tokenHash = hashToken(rawToken);
    const session = await authDal.findSessionByTokenHash(tokenHash);

    if (!session) {
      return null;
    }

    const now = new Date();

    // Check max lifetime
    if (now > new Date(session.expires_at)) {
      await authDal.deleteSession(session.id);
      return null;
    }

    // Check idle timeout
    if (now > new Date(session.idle_expires_at)) {
      await authDal.deleteSession(session.id);
      return null;
    }

    // Passive polling requests DO NOT extend idle expiry (Item 3)
    if (!isPassive) {
      const nextIdleMs = Date.now() + config.session.idleTimeoutMinutes * 60 * 1000;
      const maxExpiryMs = new Date(session.expires_at).getTime();
      const finalIdleMs = Math.min(nextIdleMs, maxExpiryMs);
      const newIdleExpiresAt = new Date(finalIdleMs);

      await authDal.touchSession(session.id, newIdleExpiresAt);
    }

    return { userId: session.user_id, sessionId: session.id };
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await authDal.deleteSessionByTokenHash(tokenHash);
  }

  async requestPasswordReset(email: string): Promise<string> {
    const trimmedEmail = email.toLowerCase().trim();
    const user = await authDal.findUserByEmail(trimmedEmail);

    if (user) {
      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      const resetId = crypto.randomUUID();

      await authDal.createPasswordResetToken(
        resetId,
        user.id,
        tokenHash,
        expiresAt
      );

      const resetUrl = `${config.appUrl}/reset-password?token=${rawToken}`;
      await emailService.sendPasswordResetEmail(trimmedEmail, rawToken, resetUrl);
    }

    return 'If an account exists with that email, a password reset link has been sent.';
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
    if (!newPassword || newPassword.length < 10) {
      throw new Error('Password must be at least 10 characters long.');
    }

    const tokenHash = hashToken(rawToken);
    const record = await authDal.findPasswordResetToken(tokenHash);

    if (!record) {
      return false;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await authDal.updateUserPassword(record.user_id, passwordHash);
    await authDal.markPasswordResetTokenUsed(record.id);
    await authDal.deleteUserSessions(record.user_id);

    return true;
  }
}

export const authService = new AuthService();
