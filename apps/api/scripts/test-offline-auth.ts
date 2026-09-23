import http from 'http';
import { config } from '../src/config/env';

const API_HOST = '127.0.0.1';
const API_PORT = config.port;

function makeRequest(
  method: string,
  path: string,
  data?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
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
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr });
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

  const timestamp = Date.now();
  const email = `offline_auth_${timestamp}@example.com`;
  const password = 'Password123!';

  console.log('1️⃣ Step 1: Signup User (Redis Offline)');
  const signupRes = await makeRequest('POST', '/api/auth/signup', { email, password });
  console.log(`   Signup Status: ${signupRes.status}`);
  if (signupRes.status !== 201) throw new Error('Signup failed with Redis offline!');
  const rawVerificationToken = signupRes.body.rawToken;

  console.log('\n2️⃣ Step 2: Email Verification (Redis Offline)');
  const verifyRes = await makeRequest('POST', '/api/auth/verify-email', { token: rawVerificationToken });
  console.log(`   Verification Status: ${verifyRes.status}`);
  if (verifyRes.status !== 200) throw new Error('Verification failed with Redis offline!');

  console.log('\n3️⃣ Step 3: Login User (Redis Offline)');
  const loginRes = await makeRequest('POST', '/api/auth/login', { email, password });
  console.log(`   Login Status: ${loginRes.status}`);
  if (loginRes.status !== 200 || !loginRes.body.token) throw new Error('Login failed with Redis offline!');
  const token = loginRes.body.token;

  console.log('\n4️⃣ Step 4: Authenticated Request GET /api/auth/me (Redis Offline)');
  const meRes = await makeRequest('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` });
  console.log(`   Authenticated Request Status: ${meRes.status}`);
  console.log(`   Authenticated User Email: ${meRes.body.user?.email}`);
  if (meRes.status !== 200 || meRes.body.user?.email !== email) throw new Error('Authenticated request failed!');

  console.log('\n5️⃣ Step 5: Logout User (Redis Offline)');
  const logoutRes = await makeRequest('POST', '/api/auth/logout', undefined, { Authorization: `Bearer ${token}` });
  console.log(`   Logout Status: ${logoutRes.status}`);
  if (logoutRes.status !== 200) throw new Error('Logout failed with Redis offline!');

  console.log('\n6️⃣ Step 6: Rejected Request After Logout (Redis Offline)');
  const rejectedRes = await makeRequest('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token}` });
  console.log(`   Post-Logout Request Status: ${rejectedRes.status} (Expected 401)`);
  if (rejectedRes.status !== 401) throw new Error('Token rejection after logout failed!');

  console.log('\n================================================================');
  console.log('🎉 FULL AUTOMATED AUTH SUITE PASSED WITH REDIS STOPPED!');
  console.log('================================================================\n');

  process.exit(0);
}

runOfflineAuthTest().catch((err) => {
  console.error('\n❌ OFFLINE AUTH TEST FAILED:', err);
  process.exit(1);
});
