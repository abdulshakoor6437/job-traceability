import crypto from 'crypto';
import { authDal } from '../dal/authDal';
import { createUserScopedDal } from '../dal/userScopedDal';

export class DigestService {
  /**
   * Run daily email digest job for all users.
   * Scans verified users who have email_digest_opt_out = 0.
   * If unread high-match notifications exist since last digest, queues EXACTLY ONE digest email per user.
   */
  async processDailyEmailDigests(): Promise<{ usersProcessed: number; emailsQueued: number }> {
    const users = await authDal.getAllVerifiedUsers();

    let usersProcessed = 0;
    let emailsQueued = 0;

    for (const u of users) {
      const userId = u.id;
      const userEmail = u.email;
      const userDal = createUserScopedDal(userId);

      const settings = await userDal.getSettings();

      // Check opt-out preference (Scope 3 requirement)
      if (settings && settings.email_digest_opt_out === 1) {
        console.log(`[DIGEST SERVICE] User ${userId} (${userEmail}) opted out of daily email digest. Skipping.`);
        continue;
      }

      usersProcessed++;
      const unreadNotifs = await userDal.getUnreadDigestNotifications();

      if (unreadNotifs.length > 0) {
        // Enqueue EXACTLY ONE digest email summarizing all unread notifications
        const outboxId = crypto.randomUUID();
        const digestPayload = {
          userId,
          email: userEmail,
          count: unreadNotifs.length,
          notifications: unreadNotifs.map((n) => ({
            id: n.id,
            message: n.message,
            related_job_id: n.related_job_id,
            created_at: n.created_at,
          })),
        };

        await authDal.enqueueOutboxEmail(
          outboxId,
          'daily_digest',
          userEmail,
          digestPayload
        );

        await userDal.markDigestSent();
        emailsQueued++;
        console.log(`[DIGEST SERVICE] Queued 1 daily digest email for user ${userId} (${userEmail}) containing ${unreadNotifs.length} high-match notifications.`);
      }
    }

    console.log(`[DIGEST SERVICE] Daily digest run completed: ${usersProcessed} users checked, ${emailsQueued} digest emails queued.`);
    return { usersProcessed, emailsQueued };
  }
}

export const digestService = new DigestService();
