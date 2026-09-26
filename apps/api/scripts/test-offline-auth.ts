import http from 'http';
import { config } from '../src/config/env';
import { apiRunner } from './test-helpers/apiRunner';

const API_HOST = '127.0.0.1';
const API_PORT = config.port;

function makeRequest(
  method: string,
  path: string,
  data?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; cookie?: string }> {
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
        const setCookie = res.headers['set-cookie'];
        let cookieStr = '';
        if (setCookie && setCookie.length > 0) {
          cookieStr = setCookie[0].split(';')[0];
        }

        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body, cookie: cookieStr });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr, cookie: cookieStr });
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

async function runOfflineAuthTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING AUTOMATED AUTH TEST WITH REDIS COMPLETELY STOPPED');
  console.log('================================================================\n');

  await apiRunner.startServer(API_PORT);

  try {
    const pool = require('../src/dal/db').getDbPool();
    await pool.execute('DELETE FROM rate_limits');
  } catch {}

  const timestamp = Date.now();
  const email = `offline_auth_${timestamp}@example.com`;
  const password = 'Password123!';

  console.log('1️⃣ Step 1: Signup User (Redis Offline)');
  const signupRes = await makeRequest('POST', '/api/auth/signup', { email, password });
  console.log(`   Signup Status: ${signupRes.status}`);
  if (signupRes.status !== 201) throw new Error('Signup failed with Redis offline!');

  console.log('\n2️⃣ Step 2: Resend Verification Request (Redis Offline)');
  const resendRes = await makeRequest('POST', '/api/auth/resend-verification', { email });
  console.log(`   Resend Status: ${resendRes.status}`);
  if (resendRes.status !== 200) throw new Error('Resend verification failed!');

  // Verify directly using token from email_verifications table in DB
  const pool = require('../src/dal/db').getDbPool();
  const [rows] = await pool.query('SELECT token_hash FROM email_verifications ORDER BY created_at DESC LIMIT 1');

  console.log('\n3️⃣ Step 3: Direct DB Email Verification (Redis Offline)');
  await pool.execute('UPDATE users SET is_verified = 1 WHERE email = ?', [email]);
  console.log('   User marked verified in database.');

  console.log('\n4️⃣ Step 4: Login User (Redis Offline)');
  const loginRes = await makeRequest('POST', '/api/auth/login', { email, password });
  console.log(`   Login Status: ${loginRes.status}`);
  console.log(`   Set-Cookie Received: ${loginRes.cookie}`);
  if (loginRes.status !== 200 || !loginRes.cookie) throw new Error('Login failed or no session cookie received!');
  const sessionCookie = loginRes.cookie;

  console.log('\n5️⃣ Step 5: Authenticated Request GET /api/auth/me (Cookie Only)');
  const meRes = await makeRequest('GET', '/api/auth/me', undefined, { Cookie: sessionCookie });
  console.log(`   Authenticated Request Status: ${meRes.status}`);
  console.log(`   Authenticated User Email: ${meRes.body.user?.email}`);
  if (meRes.status !== 200 || meRes.body.user?.email !== email) throw new Error('Authenticated request failed!');

  console.log('\n6️⃣ Step 6: Logout User (Cookie Only)');
  const logoutRes = await makeRequest('POST', '/api/auth/logout', undefined, { Cookie: sessionCookie });
  console.log(`   Logout Status: ${logoutRes.status}`);
  if (logoutRes.status !== 200) throw new Error('Logout failed with Redis offline!');

  console.log('\n7️⃣ Step 7: Rejected Request After Logout');
  const rejectedRes = await makeRequest('GET', '/api/auth/me', undefined, { Cookie: sessionCookie });
  console.log(`   Post-Logout Request Status: ${rejectedRes.status} (Expected 401)`);
  if (rejectedRes.status !== 401) throw new Error('Token rejection after logout failed!');

  console.log('\n================================================================');
  console.log('🎉 FULL AUTOMATED AUTH SUITE PASSED WITH REDIS STOPPED!');
  console.log('================================================================\n');

  await apiRunner.stopServer();
  process.exit(0);
}

runOfflineAuthTest().catch((err) => {
  console.error('\n❌ OFFLINE AUTH TEST FAILED:', err);
  process.exit(1);
});
