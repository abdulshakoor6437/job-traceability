import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.USE_MOCK_EMBEDDINGS = 'true';

import fs from 'fs';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { createUserScopedDal } from '../src/dal/userScopedDal';
import { digestService } from '../src/services/digestService';
import { getDbPool } from '../src/dal/db';

const PORT = 4122;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem3() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'item3_daily_digest.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 3 VERIFICATION: Daily Email Digest & Opt-Out Handling');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    const emailA = `digest_user_a_${Date.now()}@example.com`;
    const emailB = `digest_user_b_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    // Create User A & User B
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

    const dalA = createUserScopedDal(userA!.id);
    const dalB = createUserScopedDal(userB!.id);

    // 1. Simulate 2 unread high-match notifications for User A
    print('1. Creating 2 unread high-match notifications for User A...');
    await dalA.createNotification('high_match', 'High Match 1 (94%)', 'job-a1', null);
    await dalA.createNotification('high_match', 'High Match 2 (91%)', 'job-a2', null);

    // 2. Simulate 2 unread high-match notifications for User B (User B will opt out)
    print('2. Creating 2 unread high-match notifications for User B...');
    await dalB.createNotification('high_match', 'High Match B1 (89%)', 'job-b1', null);
    await dalB.createNotification('high_match', 'High Match B2 (86%)', 'job-b2', null);

    // 3. User B opts out of email digest via API
    print('3. User B opts out of email digest via PUT /api/user/settings/digest...');
    const loginResB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });
    const cookieB = loginResB.headers.get('set-cookie') || '';

    const optOutResB = await fetch(`${BASE_URL}/api/user/settings/digest`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieB },
      body: JSON.stringify({ optOut: true }),
    });
    const optOutBodyB = await optOutResB.json();
    print(`   User B Opt-Out Status: ${optOutResB.status}`);
    print(`   User B Settings: email_digest_opt_out = ${optOutBodyB.settings?.email_digest_opt_out}`);

    // Clean outbox to ensure baseline
    const pool = getDbPool();
    await pool.execute(`DELETE FROM email_outbox WHERE type = 'daily_digest'`);

    // 4. Run Daily Email Digest Job
    print('\n4. Executing Daily Email Digest Job via digestService...');
    const result = await digestService.processDailyEmailDigests();
    print(`   Users Processed: ${result.usersProcessed}`);
    print(`   Digest Emails Queued: ${result.emailsQueued}`);

    // 5. Inspect email_outbox table directly
    const [outboxRows] = await pool.query<any[]>(
      `SELECT * FROM email_outbox WHERE type = 'daily_digest'`
    );
    print(`   Total 'daily_digest' Outbox Rows: ${outboxRows.length}`);
    for (const r of outboxRows) {
      print(`   Outbox Row ID: ${r.id}, Recipient: ${r.recipient}, Payload: ${r.payload}`);
    }

    // Validation 1: EXACTLY 1 digest email queued for User A despite having 2 notifications
    const userARows = outboxRows.filter((r) => r.recipient === emailA.toLowerCase());
    if (userARows.length !== 1) {
      throw new Error(`Test (c) FAILED: Expected exactly 1 digest email for User A, found ${userARows.length}`);
    }
    const payloadA = JSON.parse(userARows[0].payload);
    print(`   User A Digest Payload count: ${payloadA.count} (Expected: 2 notifications in 1 email)`);

    if (payloadA.count !== 2) {
      throw new Error(`Test (c) FAILED: Digest payload does not summarize all 2 notifications!`);
    }

    // Validation 2: ZERO digest emails queued for User B who opted out
    const userBRows = outboxRows.filter((r) => r.recipient === emailB.toLowerCase());
    print(`   User B Digest Outbox Rows Count: ${userBRows.length} (Expected: 0)`);
    if (userBRows.length !== 0) {
      throw new Error(`Test (d) FAILED: User B opted out but still received a digest email!`);
    }

    print('\n================================================================');
    print('✅ ITEM 3 VERIFICATION PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log evidence to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 3 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
  }
}

if (require.main === module) {
  testItem3().then(() => process.exit(0));
}
