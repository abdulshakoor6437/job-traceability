import { authDal } from '../src/dal/authDal';
import { processOutboxBatch } from '../src/services/emailOutboxWorker';
import { emailSink } from './test-helpers/emailSink';
import { apiRunner } from './test-helpers/apiRunner';
import { config } from '../src/config/env';
import { getDbPool } from '../src/dal/db';
import { RowDataPacket } from 'mysql2/promise';
import http from 'http';
import crypto from 'crypto';

function makeRequest(port: number, method: string, path: string, data?: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function searchDatabaseForString(targetString: string): Promise<string[]> {
  const pool = getDbPool();
  const [tables] = await pool.query<RowDataPacket[]>('SHOW TABLES');
  const foundIn: string[] = [];

  for (const tRow of tables) {
    const tableName = Object.values(tRow)[0] as string;
    const [cols] = await pool.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);

    for (const cRow of cols) {
      const colName = cRow.Field;
      const colType = String(cRow.Type).toLowerCase();

      if (colType.includes('char') || colType.includes('text') || colType.includes('json')) {
        const [matches] = await pool.query<RowDataPacket[]>(
          `SELECT \`${colName}\` FROM \`${tableName}\` WHERE \`${colName}\` LIKE ? LIMIT 1`,
          [`%${targetString}%`]
        );
        if (matches.length > 0) {
          foundIn.push(`${tableName}.${colName}`);
        }
      }
    }
  }

  return foundIn;
}

async function runOutboxTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING EMAIL OUTBOX & RAW TOKEN SECRETS TEST SUITE (Item 4)');
  console.log('================================================================\n');

  const SMTP_PORT = 25255;
  const API_PORT = 5056;

  try {
    // Start local SMTP test sink
    await emailSink.start(SMTP_PORT);

    // Set test runner's email config to SMTP sink
    (config.email as any).mode = 'smtp';
    (config.email as any).smtpHost = '127.0.0.1';
    (config.email as any).smtpPort = SMTP_PORT;
    (config.email as any).smtpSecure = false;
    (config.email as any).from = 'noreply@testdomain.com';

    const cleanPool = getDbPool();
    await cleanPool.execute('DELETE FROM email_outbox');

    // 1️⃣ Suppressed Recipient Test
    console.log('[1] Testing Suppressed Recipient Handling & Payload Blanking...');
    const suppressedEmail = `suppressed_${Date.now()}@example.com`;
    await authDal.suppressEmail(suppressedEmail, 'bounce');

    const suppOutboxId = crypto.randomUUID();
    const dummyUser = `dummy_user_${Date.now()}@example.com`;
    const userId = crypto.randomUUID();
    await authDal.createUser(userId, dummyUser, 'hash1234567890');

    await authDal.enqueueOutboxEmail(suppOutboxId, 'verification', suppressedEmail, { userId });
    await new Promise((r) => setTimeout(r, 500));
    await processOutboxBatch();

    const pool = getDbPool();
    const [suppRows] = await pool.query<RowDataPacket[]>('SELECT status, payload FROM email_outbox WHERE id = ?', [suppOutboxId]);
    console.log(`    Suppressed Item Status: ${suppRows[0]?.status}`);
    console.log(`    Suppressed Item Payload: ${suppRows[0]?.payload}`);
    if (suppRows[0]?.status !== 'suppressed' || suppRows[0]?.payload !== '{}') {
      throw new Error('Suppression test failed: status or payload blanking incorrect.');
    }
    console.log('    ✅ Recipient suppression & payload blanking VERIFIED.');

    // 2️⃣ Start API in SMTP mode and test Signup -> Outbox delivery -> Raw Token Search
    console.log('\n[2] Testing Signup Delivery & Raw Token Database Absence (Item 4)...');
    await apiRunner.startServer(API_PORT, {
      EMAIL_MODE: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: SMTP_PORT.toString(),
      SMTP_SECURE: 'false',
      EMAIL_FROM: 'noreply@testdomain.com',
    });

    const signupEmail = `outbox_token_test_${Date.now()}@example.com`;
    emailSink.clear();

    const signupRes = await makeRequest(API_PORT, 'POST', '/api/auth/signup', {
      email: signupEmail,
      password: 'Password123!',
    });
    console.log(`    Signup response status: ${signupRes.status}`);
    if (signupRes.status !== 201) {
      throw new Error(`Signup failed with status ${signupRes.status}`);
    }

    // Process outbox batch to deliver via SMTP
    await new Promise((r) => setTimeout(r, 500));
    await processOutboxBatch();

    const rawToken = emailSink.extractTokenForRecipient(signupEmail);
    if (!rawToken || rawToken.length !== 64) {
      throw new Error(`Could not extract valid raw token from received email body for ${signupEmail}`);
    }
    console.log(`    Extracted raw verification token length: ${rawToken.length} chars (value masked).`);

    // Search ALL database tables for rawToken
    console.log('    Searching ALL MySQL tables for raw token string...');
    const matches = await searchDatabaseForString(rawToken);
    console.log(`    Raw token occurrences in database: ${matches.length}`);

    if (matches.length > 0) {
      throw new Error(`ITEM 4 VIOLATION: Raw token was found in database at: ${matches.join(', ')}`);
    }
    console.log('    ✅ CONFIRMED: Raw token string appears NOWHERE in any database table.');

    // Verify outbox payload for sent item is blanked ('{}')
    const [sentOutboxRows] = await pool.query<RowDataPacket[]>(
      'SELECT status, payload FROM email_outbox WHERE recipient = ?',
      [signupEmail]
    );
    console.log(`    Outbox item status: ${sentOutboxRows[0]?.status}`);
    console.log(`    Outbox item payload: ${sentOutboxRows[0]?.payload}`);
    if (sentOutboxRows[0]?.status !== 'sent' || sentOutboxRows[0]?.payload !== '{}') {
      throw new Error('Outbox item payload was not blanked to {} after delivery!');
    }
    console.log('    ✅ CONFIRMED: Outbox item payload blanked to {} upon delivery.');

    // Stop API server and SMTP sink
    await apiRunner.stopServer();
    await emailSink.stop();
    try { const pool = getDbPool(); await pool.end(); } catch {}

    console.log('\n================================================================');
    console.log('✅ PASS: Email Outbox Secrets & Payload Blanking (Item 4)');
    console.log('================================================================\n');
    process.exit(0);
  } catch (error: any) {
    await apiRunner.stopServer();
    await emailSink.stop();
    try { const pool = getDbPool(); await pool.end(); } catch {}
    console.error('\n❌ FAIL: Outbox Secrets Test Suite Failed:', error.message);
    process.exit(1);
  }
}

runOutboxTest();
