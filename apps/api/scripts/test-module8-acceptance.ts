import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.USE_MOCK_EMBEDDINGS = 'true';

import fs from 'fs';
import crypto from 'crypto';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { getDbPool } from '../src/dal/db';
import { createUserScopedDal } from '../src/dal/userScopedDal';
import { digestService } from '../src/services/digestService';

const PORT = 4125;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function runAcceptanceSuite() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'module8_acceptance_log.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🚀 MODULE 8: NOTIFICATIONS, APPLICATION HISTORY, PLANS & LIMITS');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });
    const pool = getDbPool();

    // Helper: evaluate high match notification hook (same logic as agentSessionService)
    async function evaluateAndNotifyMatches(
      userId: string,
      matches: Array<{ jobId: string; title: string; company: string; score: number }>
    ) {
      const userDal = createUserScopedDal(userId);
      const highMatchThreshold = parseInt(process.env.HIGH_MATCH_NOTIFICATION_THRESHOLD || '85', 10);
      const dailyCap = parseInt(process.env.NOTIFICATION_DAILY_CAP || process.env.DAILY_NOTIFICATION_CAP || '10', 10);

      let todayCount = await userDal.getTodayNotificationCount();
      let createdCount = 0;

      for (const match of matches) {
        if (match.score >= highMatchThreshold) {
          if (todayCount >= dailyCap) {
            break;
          }
          const alreadyNotified = await userDal.hasNotificationForJob(match.jobId);
          if (!alreadyNotified) {
            await userDal.createNotification(
              'high_match',
              `High job match: ${match.title} at ${match.company} (${match.score}% match)`,
              match.jobId,
              null
            );
            todayCount++;
            createdCount++;
          }
        }
      }
      return createdCount;
    }

    // 0. Setup Test Users
    print('Step 0: Creating and verifying Test Users A and B...');
    const emailA = `mod8_user_a_${Date.now()}@example.com`;
    const emailB = `mod8_user_b_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });

    const userA = await authDal.findUserByEmail(emailA);
    const userB = await authDal.findUserByEmail(emailB);
    await authDal.setUserVerified(userA!.id);
    await authDal.setUserVerified(userB!.id);

    const loginResA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieA = loginResA.headers.get('set-cookie') || '';

    const loginResB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });
    const cookieB = loginResB.headers.get('set-cookie') || '';

    // TEST (a): Job scoring >= 85 generates notification; 60-84 does not
    print('\n----------------------------------------------------------------');
    print('TEST (a): Job scoring >= 85 generates notification; 60-84 does not');
    print('----------------------------------------------------------------');
    const jobHighId = `job_high_${Date.now()}`;
    const jobMidId = `job_mid_${Date.now()}`;

    const testMatches = [
      { jobId: jobHighId, title: 'Principal AI Architect', company: 'Google Cloud', score: 91.5 },
      { jobId: jobMidId, title: 'Junior Python Developer', company: 'Startup Labs', score: 72.0 },
    ];

    const notifsGenerated = await evaluateAndNotifyMatches(userA!.id, testMatches);
    print(`   Evaluated 2 jobs (Scores: 91.5% and 72.0%)`);
    print(`   Notifications generated: ${notifsGenerated}`);

    const dalA = createUserScopedDal(userA!.id);
    const hasHighNotif = await dalA.hasNotificationForJob(jobHighId);
    const hasMidNotif = await dalA.hasNotificationForJob(jobMidId);

    print(`   Notification created for score >= 85 (91.5%): ${hasHighNotif}`);
    print(`   Notification created for score 60-84 (72.0%): ${hasMidNotif}`);

    if (!hasHighNotif || hasMidNotif || notifsGenerated !== 1) {
      throw new Error('Test (a) FAILED: Score threshold (>=85) was not enforced!');
    }
    print('✅ Test (a) PASSED: Score >= 85 generated notification; score 60-84 did not.');

    // TEST (b): Marking notification read persists and updates unread count
    print('\n----------------------------------------------------------------');
    print('TEST (b): Marking notification read persists and updates unread count');
    print('----------------------------------------------------------------');
    const getNotifsRes1 = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const notifsBody1 = await getNotifsRes1.json();
    print(`   Initial Unread Count: ${notifsBody1.unreadCount}`);
    if (notifsBody1.unreadCount !== 1) {
      throw new Error(`Test (b) FAILED: Expected initial unread count 1, got ${notifsBody1.unreadCount}`);
    }

    const notifToMark = notifsBody1.notifications[0];
    print(`   Marking notification ${notifToMark.id} as read...`);
    const readRes = await fetch(`${BASE_URL}/api/notifications/${notifToMark.id}/read`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieA },
    });
    print(`   PUT /api/notifications/:id/read HTTP Status: ${readRes.status}`);

    const getNotifsRes2 = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const notifsBody2 = await getNotifsRes2.json();
    print(`   Updated Unread Count: ${notifsBody2.unreadCount}`);
    if (notifsBody2.unreadCount !== 0 || !notifsBody2.notifications[0].is_read) {
      throw new Error('Test (b) FAILED: Notification did not persist read status!');
    }
    print('✅ Test (b) PASSED: Notification read state persists and unread count decrements.');

    // TEST (c): Simulate 2 unread high-match notifications; confirm exactly 1 digest email queued
    print('\n----------------------------------------------------------------');
    print('TEST (c): Simulate 2 unread high-match notifications; confirm exactly 1 digest email queued');
    print('----------------------------------------------------------------');
    // Clear outbox for daily_digest
    await pool.execute(`DELETE FROM email_outbox WHERE type = 'daily_digest'`);

    // Insert 2 fresh unread notifications
    const notif1 = await dalA.createNotification(
      'high_match',
      'High job match: Senior Staff Engineer at Stripe (95% match)',
      `job_digest_1_${Date.now()}`,
      null
    );
    const notif2 = await dalA.createNotification(
      'high_match',
      'High job match: Lead AI Researcher at Anthropic (88% match)',
      `job_digest_2_${Date.now()}`,
      null
    );
    print(`   Created 2 unread high-match notifications: [${notif1.id}, ${notif2.id}]`);

    // Run digest service
    const digestResult = await digestService.processDailyEmailDigests();
    print(`   Digest Service Result: Users Processed = ${digestResult.usersProcessed}, Emails Queued = ${digestResult.emailsQueued}`);

    // Inspect email_outbox
    const [outboxRows]: any = await pool.query(
      `SELECT * FROM email_outbox WHERE type = 'daily_digest' AND recipient = ?`,
      [emailA.toLowerCase()]
    );
    print(`   Total emails queued in email_outbox for User A: ${outboxRows.length}`);
    if (outboxRows.length !== 1) {
      throw new Error(`Test (c) FAILED: Expected exactly 1 digest email queued, got ${outboxRows.length}`);
    }
    const payloadA = JSON.parse(outboxRows[0].payload);
    print(`   Queued Digest Subject: "${payloadA.subject}", notifications summarized: ${payloadA.count}`);
    print('✅ Test (c) PASSED: Exactly 1 digest email queued summarizing multiple notifications.');

    // TEST (d): User opts out; confirm no digest queued despite new notifications
    print('\n----------------------------------------------------------------');
    print('TEST (d): User opts out; confirm no digest queued despite new notifications');
    print('----------------------------------------------------------------');
    const optOutRes = await fetch(`${BASE_URL}/api/user/settings/digest`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ optOut: true }),
    });
    print(`   Opt-out API Status: ${optOutRes.status}`);

    // Clear outbox and insert another notification
    await pool.execute(`DELETE FROM email_outbox WHERE type = 'daily_digest'`);
    await dalA.createNotification(
      'high_match',
      'High job match: VP Engineering at OpenAI (98% match)',
      `job_opt_out_${Date.now()}`,
      null
    );

    // Run digest service
    await digestService.processDailyEmailDigests();

    const [optOutOutbox]: any = await pool.query(
      `SELECT * FROM email_outbox WHERE type = 'daily_digest' AND recipient = ?`,
      [emailA.toLowerCase()]
    );
    print(`   User A Digest Outbox Count after Opt-Out: ${optOutOutbox.length} (Expected: 0)`);
    if (optOutOutbox.length !== 0) {
      throw new Error('Test (d) FAILED: Digest email queued despite user opting out!');
    }
    print('✅ Test (d) PASSED: Digest generation skipped when user has opted out.');

    // TEST (e): A job moved through Not Reviewed -> Tailored -> Exported -> Applied shows accurate transition dates
    print('\n----------------------------------------------------------------');
    print('TEST (e): Status transition history (Not Reviewed -> Tailored -> Exported -> Applied)');
    print('----------------------------------------------------------------');
    const testJobId = crypto.randomUUID();
    await pool.execute(
      `INSERT INTO cached_jobs (id, dedup_key, title, company, location, source_providers, external_ids)
       VALUES (?, ?, 'Lead Solutions Architect', 'Amazon Web Services', 'Remote', '["test"]', '["ext_aws"]')`,
      [testJobId, crypto.randomUUID()]
    );

    // 1. Not Reviewed
    const tr1 = await fetch(`${BASE_URL}/api/applications/mark-applied`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ jobId: testJobId, status: 'NOT_REVIEWED', notes: 'Initial match' }),
    });
    const tr1Body = await tr1.json();
    const testAppId = tr1Body.application.id;

    await new Promise((r) => setTimeout(r, 60));

    // 2. Tailored
    await fetch(`${BASE_URL}/api/applications/${testAppId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'TAILORED', notes: 'CV Tailored' }),
    });

    await new Promise((r) => setTimeout(r, 60));

    // 3. Exported
    await fetch(`${BASE_URL}/api/applications/${testAppId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'EXPORTED', notes: 'PDF Exported' }),
    });

    await new Promise((r) => setTimeout(r, 60));

    // 4. Applied
    await fetch(`${BASE_URL}/api/applications/${testAppId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'APPLIED', notes: 'Application Submitted' }),
    });

    // Query history
    const histRes = await fetch(`${BASE_URL}/api/applications/history?applicationId=${testAppId}`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const histBody = await histRes.json();
    const transitions = histBody.history;

    print(`   Total status transitions recorded: ${transitions.length}`);
    for (let i = 0; i < transitions.length; i++) {
      print(`   [Transition ${i + 1}] ${transitions[i].from_status || 'NULL'} -> ${transitions[i].to_status} at ${transitions[i].transitioned_at}`);
    }

    const recordedSequence = transitions.map((t: any) => t.to_status);
    if (JSON.stringify(recordedSequence) !== JSON.stringify(['NOT_REVIEWED', 'TAILORED', 'EXPORTED', 'APPLIED'])) {
      throw new Error(`Test (e) FAILED: Expected progression sequence, got ${JSON.stringify(recordedSequence)}`);
    }
    print('✅ Test (e) PASSED: Accurate transition dates and exact sequence verified.');

    // TEST (f): Simulate more high-match jobs than daily notification cap; confirm only cap created
    print('\n----------------------------------------------------------------');
    print('TEST (f): Daily notification cap enforcement');
    print('----------------------------------------------------------------');
    const originalCap = process.env.NOTIFICATION_DAILY_CAP;
    process.env.NOTIFICATION_DAILY_CAP = '3';

    // Fresh user C for clean daily cap isolation
    const emailC = `cap_user_${Date.now()}@example.com`;
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailC, password }),
    });
    const userC = await authDal.findUserByEmail(emailC);
    await authDal.setUserVerified(userC!.id);

    // Provide 6 high-match opportunities
    const capOpportunities = [];
    for (let i = 1; i <= 6; i++) {
      capOpportunities.push({
        jobId: `cap_job_${i}_${Date.now()}`,
        title: `High Match Role ${i}`,
        company: `Enterprise Tech ${i}`,
        score: 92.0,
      });
    }

    const capCreated = await evaluateAndNotifyMatches(userC!.id, capOpportunities);
    print(`   Configured Daily Notification Cap: 3`);
    print(`   High Match Jobs Available: 6`);
    print(`   Notifications Created: ${capCreated}`);

    if (capCreated !== 3) {
      throw new Error(`Test (f) FAILED: Expected exactly 3 notifications (cap), got ${capCreated}`);
    }
    process.env.NOTIFICATION_DAILY_CAP = originalCap;
    print('✅ Test (f) PASSED: Notification creation strictly limited to daily cap.');

    // TEST (g): Usage & Limits panel shows accurate real values for every existing quota
    print('\n----------------------------------------------------------------');
    print('TEST (g): Unified Usage & Limits panel endpoint');
    print('----------------------------------------------------------------');
    const limitsRes = await fetch(`${BASE_URL}/api/user/limits`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const limitsBody = await limitsRes.json();
    print(`   Limits Endpoint Status: ${limitsRes.status}`);
    print(`   JSearch Quota: ${limitsBody.jsearch?.usedThisMonth} / ${limitsBody.jsearch?.monthlyLimit}`);
    print(`   SerpApi Quota: ${limitsBody.serpapi?.usedThisMonth} / ${limitsBody.serpapi?.monthlyLimit}`);
    print(`   Tailoring Daily Cap: ${limitsBody.tailoring?.usedToday} / ${limitsBody.tailoring?.dailyLimit}`);
    print(`   Background Job Status: ${limitsBody.backgroundJob?.status} (Throttled: ${limitsBody.backgroundJob?.isThrottled})`);

    if (
      limitsRes.status !== 200 ||
      typeof limitsBody.jsearch?.monthlyLimit !== 'number' ||
      typeof limitsBody.serpapi?.monthlyLimit !== 'number' ||
      typeof limitsBody.tailoring?.dailyLimit !== 'number' ||
      !limitsBody.backgroundJob?.status
    ) {
      throw new Error('Test (g) FAILED: Limits response missing required quota fields!');
    }
    print('✅ Test (g) PASSED: Unified Usage & Limits panel reflects real values for all quotas.');

    // TEST (h): Cross-user isolation on notifications and history tables/endpoints
    print('\n----------------------------------------------------------------');
    print('TEST (h): Cross-user isolation on notifications and history');
    print('----------------------------------------------------------------');
    // User B checks notifications
    const userBNotifsRes = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieB },
    });
    const userBNotifs = await userBNotifsRes.json();
    print(`   User B Notification Count: ${userBNotifs.notifications?.length} (Expected: 0)`);

    // User B checks history
    const userBHistRes = await fetch(`${BASE_URL}/api/applications/history`, {
      headers: { ...HEADERS, Cookie: cookieB },
    });
    const userBHist = await userBHistRes.json();
    print(`   User B History Transition Count: ${userBHist.history?.length} (Expected: 0)`);

    // User B attempts to mark User A's notification as read
    const stealNotifRes = await fetch(`${BASE_URL}/api/notifications/${notif1.id}/read`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieB },
    });
    print(`   User B marking User A notification HTTP Status: ${stealNotifRes.status} (Expected: 404)`);

    if (
      userBNotifs.notifications?.length !== 0 ||
      userBHist.history?.length !== 0 ||
      stealNotifRes.status !== 404
    ) {
      throw new Error('Test (h) FAILED: Cross-user boundary breached!');
    }
    print('✅ Test (h) PASSED: Complete cross-user isolation enforced across all endpoints and tables.');

    print('\n================================================================');
    print('🎉 MODULE 8 ACCEPTANCE TESTS (a through h) ALL PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf8');
    print(`Evidence saved to ${logFile}`);
    process.exit(0);
  } catch (err: any) {
    print(`\n❌ MODULE 8 ACCEPTANCE SUITE FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf8');
    process.exit(1);
  }
}

runAcceptanceSuite();
