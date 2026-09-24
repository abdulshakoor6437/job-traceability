import crypto from 'crypto';
import { authDal } from '../dal/authDal';
import { emailService } from './emailService';
import { config } from '../config/env';

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;

export async function processOutboxBatch(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  try {
    const pendingItems = await authDal.findPendingOutboxEmails(10);

    for (const item of pendingItems) {
      const recipient = item.recipient;

      // Item 3: Check suppression table before sending
      const isSuppressed = await authDal.isEmailSuppressed(recipient);
      if (isSuppressed) {
        console.log(`🚫 [EMAIL OUTBOX] Recipient ${recipient} is suppressed. Skipping send.`);
        await authDal.markOutboxSuppressed(item.id);
        continue;
      }

      let payload: any = {};
      try {
        payload = JSON.parse(item.payload);
      } catch {
        payload = {};
      }

      let success = false;

      if (item.type === 'dummy_timing') {
        await authDal.markOutboxSent(item.id);
        continue;
      }

      if (item.type === 'verification') {
        const userId = payload.userId;
        if (!userId) {
          // Support direct token payload if passed
          success = await emailService.sendVerificationEmail(recipient, payload.token || '', payload.url || '');
        } else {
          // Item 4: Generate token at send time, invalidating any old token
          const rawToken = generateOpaqueToken();
          const tokenHash = hashToken(rawToken);
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await authDal.deleteEmailVerificationTokens(userId);
          await authDal.createEmailVerificationToken(crypto.randomUUID(), userId, tokenHash, expiresAt);

          const verifyUrl = `${config.appUrl}/verify-email?token=${rawToken}`;
          success = await emailService.sendVerificationEmail(recipient, rawToken, verifyUrl);
        }
      } else if (item.type === 'already_registered') {
        const loginUrl = `${config.appUrl}/login`;
        const resetUrl = `${config.appUrl}/reset-password`;
        success = await emailService.sendAlreadyRegisteredEmail(recipient, loginUrl, resetUrl);
      } else if (item.type === 'password_reset') {
        const userId = payload.userId;
        if (!userId) {
          success = await emailService.sendPasswordResetEmail(recipient, payload.token || '', payload.url || '');
        } else {
          // Item 4: Generate token at send time, invalidating any old reset token
          const rawToken = generateOpaqueToken();
          const tokenHash = hashToken(rawToken);
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
          await authDal.deletePasswordResetTokens(userId);
          await authDal.createPasswordResetToken(crypto.randomUUID(), userId, tokenHash, expiresAt);

          const resetUrl = `${config.appUrl}/reset-password?token=${rawToken}`;
          success = await emailService.sendPasswordResetEmail(recipient, rawToken, resetUrl);
        }
      } else {
        console.warn(`[EMAIL OUTBOX] Unknown outbox item type: ${item.type}`);
        success = true; // Mark done to prevent infinite loop
      }

      if (success) {
        await authDal.markOutboxSent(item.id);
      } else {
        // Exponential backoff: next attempt in (2^attempts * 10) seconds
        const nextDelaySeconds = Math.pow(2, item.attempts + 1) * 10;
        const nextAttemptAt = new Date(Date.now() + nextDelaySeconds * 1000);
        await authDal.markOutboxFailed(item.id, 'SMTP delivery failed', nextAttemptAt);
      }
    }

    // Item 4: Purge terminal outbox rows older than 7 days
    await authDal.purgeOldOutboxRows(7);
  } catch (error: any) {
    console.error('Error processing email outbox batch:', error.message);
  } finally {
    isRunning = false;
  }
}

export function startEmailOutboxWorker(): void {
  if (!intervalId) {
    console.log('📧 Starting Email Outbox Background Worker...');
    intervalId = setInterval(processOutboxBatch, 2000);
  }
}

export function stopEmailOutboxWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
