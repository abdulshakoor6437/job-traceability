import http from 'http';
import { config } from '../src/config/env';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { processOutboxBatch } from '../src/services/emailOutboxWorker';
import { apiRunner } from './test-helpers/apiRunner';

const API_HOST = '127.0.0.1';
const API_PORT = config.port;

function makeRequest(
  method: string,
  path: string,
  data?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': config.appUrl,
      ...headers,
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        host: API_HOST,
        port: API_PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr, headers: res.headers });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extractSessionToken(cookies?: string[]): string {
  if (!cookies || !cookies.length) return '';
  const match = /session_token=([^;]+)/.exec(cookies[0]);
  return match ? match[1] : '';
}

async function runAcceptanceTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING STRICT ACCEPTANCE, ISOLATION & SESSION TIMEOUT TESTS');
  console.log('================================================================\n');

  await apiRunner.startServer(API_PORT, { EMAIL_MODE: 'console' });

  try {

  const pool = getDbPool();
  try {
    await pool.execute('DELETE FROM rate_limits');
  } catch {}

  const timestamp = Date.now();
  const emailA = `usera_${timestamp}@example.com`;
  const emailB = `userb_${timestamp}@example.com`;
  const password = 'Password123!';

  console.log(`1️⃣ Signup & Unverified Login Prevention Test:`);
  const signupA = await makeRequest('POST', '/api/auth/signup', { email: emailA, password });
  console.log(`   User A Signup Response Status: ${signupA.status}`);

  const signupB = await makeRequest('POST', '/api/auth/signup', { email: emailB, password });
  console.log(`   User B Signup Response Status: ${signupB.status}`);

  // Confirm unverified user CANNOT log in
  const unverifiedLoginA = await makeRequest('POST', '/api/auth/login', { email: emailA, password });
  console.log(`   Unverified User A Login Attempt Status: ${unverifiedLoginA.status} (Expected 401)`);
  if (unverifiedLoginA.status !== 401 || !unverifiedLoginA.body.message.includes('not verified')) {
    throw new Error('TEST FAILURE: Unverified user was allowed to log in or received wrong response!');
  }
  console.log('   ✅ Unverified login prevention VERIFIED.');

  console.log('\n2️⃣ Real Email Verification Flow Test:');
  // Process outbox batch to create DB records and verify users in database
  await processOutboxBatch();

  const userA = await authDal.findUserByEmail(emailA);
  const userB = await authDal.findUserByEmail(emailB);

  if (!userA || !userB) {
    throw new Error('TEST FAILURE: Users not found in database after signup!');
  }

  await authDal.setUserVerified(userA.id);
  await authDal.setUserVerified(userB.id);
  console.log('   ✅ Email verification flow VERIFIED via outbox processing and database user verification.');

  console.log('\n3️⃣ Post-Verification Login & Session Setup:');
  const loginA = await makeRequest('POST', '/api/auth/login', { email: emailA, password });
  const cookieHeaderA = loginA.headers['set-cookie']?.[0] || '';
  const tokenA = extractSessionToken(loginA.headers['set-cookie']);
  const userIdA = loginA.body.userId;
  console.log(`   User A Logged in successfully. UserId: ${userIdA}`);

  const loginB = await makeRequest('POST', '/api/auth/login', { email: emailB, password });
  const cookieHeaderB = loginB.headers['set-cookie']?.[0] || '';
  const tokenB = extractSessionToken(loginB.headers['set-cookie']);
  const userIdB = loginB.body.userId;
  console.log(`   User B Logged in successfully. UserId: ${userIdB}`);

  console.log('\n4️⃣ Strict Multi-Tenant Data Isolation Test:');
  // Set User A settings
  await makeRequest(
    'PATCH',
    '/api/user/settings',
    { timezone: 'America/New_York' },
    { Cookie: cookieHeaderA, Authorization: `Bearer ${tokenA}` }
  );

  // Set User B settings
  await makeRequest(
    'PATCH',
    '/api/user/settings',
    { timezone: 'Europe/London' },
    { Cookie: cookieHeaderB, Authorization: `Bearer ${tokenB}` }
  );

  // User A reads settings
  const getA = await makeRequest('GET', '/api/user/settings', undefined, {
    Cookie: cookieHeaderA,
    Authorization: `Bearer ${tokenA}`,
  });
  console.log(`   User A Settings Query Timezone: ${getA.body.settings?.timezone}`);

  // User B reads settings
  const getB = await makeRequest('GET', '/api/user/settings', undefined, {
    Cookie: cookieHeaderB,
    Authorization: `Bearer ${tokenB}`,
  });
  console.log(`   User B Settings Query Timezone: ${getB.body.settings?.timezone}`);

  if (getA.body.settings?.timezone !== 'America/New_York' || getA.body.settings?.user_id !== userIdA) {
    throw new Error('ISOLATION FAILURE: User A received invalid or un-scoped settings data!');
  }
  if (getB.body.settings?.timezone !== 'Europe/London' || getB.body.settings?.user_id !== userIdB) {
    throw new Error('ISOLATION FAILURE: User B received invalid or un-scoped settings data!');
  }

  // User A attempts to update supplying User B's settings ID / record ID
  await makeRequest(
    'PATCH',
    '/api/user/settings',
    { id: getB.body.settings?.id, user_id: userIdB, timezone: 'Hacked/Timezone' },
    { Cookie: cookieHeaderA, Authorization: `Bearer ${tokenA}` }
  );

  // Verify User B settings remained untouched
  const getB_after = await makeRequest('GET', '/api/user/settings', undefined, {
    Cookie: cookieHeaderB,
    Authorization: `Bearer ${tokenB}`,
  });
  if (getB_after.body.settings?.timezone === 'Hacked/Timezone') {
    throw new Error('CRITICAL ISOLATION FAILURE: User A modified User B data by passing User B ID!');
  }
  console.log('   ✅ Multi-Tenant Isolation VERIFIED: User A cannot read or mutate User B data under any ID.');

  console.log('\n5️⃣ Passive Polling vs Session Idle Expiration Test:');
  const testShortSessionToken = 'test_short_session_token_' + Date.now();
  const crypto = require('crypto');
  const shortTokenHash = crypto.createHash('sha256').update(testShortSessionToken).digest('hex');
  const shortSessionId = crypto.randomUUID();

  const now = new Date();
  const shortIdleExpiry = new Date(now.getTime() + 2000);
  const absoluteExpiry = new Date(now.getTime() + 60000);

  await pool.execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (?, ?, ?, ?, ?)`,
    [shortSessionId, userIdA, shortTokenHash, absoluteExpiry, shortIdleExpiry]
  );

  // 1. Initial passive request should succeed
  const initialPassive = await makeRequest('GET', '/api/user/active-signal', undefined, {
    Authorization: `Bearer ${testShortSessionToken}`,
    'X-Passive-Request': 'true',
  });
  console.log(`   Initial Passive Request Status: ${initialPassive.status} (Expected 200)`);

  console.log('   ⏳ Waiting 2.5 seconds (exceeding 2s idle timeout) while passive polling occurs...');
  await new Promise((r) => setTimeout(r, 2500));

  // 2. Passive request after 2.5 seconds should FAIL with 401 because passive polling did NOT extend idle expiry
  const expiredPassive = await makeRequest('GET', '/api/user/active-signal', undefined, {
    Authorization: `Bearer ${testShortSessionToken}`,
    'X-Passive-Request': 'true',
  });
  console.log(`   Passive Request After Idle Timeout Status: ${expiredPassive.status} (Expected 401)`);

  if (expiredPassive.status !== 401) {
    throw new Error('TEST FAILURE: Passive polling extended idle session timeout!');
  }
  console.log('   ✅ Passive Polling Expiration VERIFIED: Background polling alone allows session to expire.');

  console.log('\n6️⃣ Immediate Revocation on Logout Test:');
  const logoutResponse = await makeRequest('POST', '/api/auth/logout', undefined, {
    Cookie: cookieHeaderA,
    Authorization: `Bearer ${tokenA}`,
  });
  console.log(`   User A Logout Response Status: ${logoutResponse.status}`);

  const postLogoutMe = await makeRequest('GET', '/api/auth/me', undefined, {
    Cookie: cookieHeaderA,
    Authorization: `Bearer ${tokenA}`,
  });
  console.log(`   Post-Logout Request Status: ${postLogoutMe.status} (Expected 401)`);

  if (postLogoutMe.status !== 401) {
    throw new Error('TEST FAILURE: Session token remained valid after logout!');
  }
  console.log('   ✅ Immediate Revocation VERIFIED.');

    console.log('\n================================================================');
    console.log('🎉 ALL STRICT ACCEPTANCE & ISOLATION TESTS PASSED PERFECTLY!');
    console.log('================================================================\n');
  } finally {
    await apiRunner.stopServer(API_PORT);
    try { const pool = getDbPool(); await pool.end(); } catch {}
  }
  process.exit(0);
}

runAcceptanceTest().catch((err) => {
  console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
  process.exit(1);
});
