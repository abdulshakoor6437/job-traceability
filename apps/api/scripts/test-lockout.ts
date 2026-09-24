import { checkAndIncrementRateLimit, checkRecipientEmailCap } from '../src/middleware/rateLimiter';
import { apiRunner } from './test-helpers/apiRunner';
import http from 'http';

function makeRequest(port: number, method: string, path: string, data?: any): Promise<{ status: number; headers: any; body: any }> {
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
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, headers: res.headers, body });
          } catch {
            resolve({ status: res.statusCode || 500, headers: res.headers, body: bodyStr });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function runLockoutTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING THROTTLING, RATE LIMITING & IP ISOLATION TESTS (Item 5)');
  console.log('================================================================\n');

  try {
    const bucket = 'login_unit_test';
    const ipA = '192.168.1.100';
    const ipB = '10.0.0.5';

    // 1️⃣ Direct Unit Test of Throttle Function with Two IP Strings (Item 5a)
    console.log('[1] Unit testing throttle function directly with two IP strings...');

    // Simulate 5 requests from IP_A
    for (let i = 1; i <= 5; i++) {
      const resA = await checkAndIncrementRateLimit(bucket, ipA, 5, 900);
      if (!resA.allowed && i <= 5) {
        throw new Error(`IP_A request ${i} was blocked prematurely.`);
      }
    }

    // 6th request from IP_A must be rate-limited (429)
    const resA6 = await checkAndIncrementRateLimit(bucket, ipA, 5, 900);
    console.log(`    IP_A 6th request allowed: ${resA6.allowed}, retryAfter: ${resA6.retryAfterSeconds}s`);
    if (resA6.allowed) {
      throw new Error('IP_A failed to be rate-limited on 6th attempt.');
    }
    console.log('    ✅ IP_A rate limiting triggered correctly.');

    // IP_B request must be completely unaffected by IP_A's rate limit
    const resB = await checkAndIncrementRateLimit(bucket, ipB, 5, 900);
    console.log(`    IP_B request allowed: ${resB.allowed}, hits: ${resB.currentHits}`);
    if (!resB.allowed || resB.currentHits !== 1) {
      throw new Error('IP_B was incorrectly affected by IP_A rate limit!');
    }
    console.log('    ✅ IP_B isolation verified: IP_B is allowed and has 1 hit.');

    // 2️⃣ Testing HTTP 429 Response & Retry-After Header (Item 5b & 5c)
    console.log('\n[2] Testing HTTP API 429 Response & Retry-After Header...');
    const API_PORT = 5057;
    await apiRunner.startServer(API_PORT, { TRUST_PROXY: 'false' });

    // Exceed rate limit on endpoint (e.g. resend-verification limit is 5)
    const testEmail = `ratelimit_${Date.now()}@example.com`;
    let lastRes: any = null;

    for (let i = 0; i < 6; i++) {
      lastRes = await makeRequest(API_PORT, 'POST', '/api/auth/resend-verification', { email: testEmail });
    }

    console.log(`    6th Request HTTP Status Code: ${lastRes.status}`);
    console.log(`    Retry-After Header: ${lastRes.headers['retry-after']}`);
    console.log(`    Response Body: ${JSON.stringify(lastRes.body)}`);

    if (lastRes.status !== 429) {
      throw new Error(`Expected HTTP 429 on rate limit exceed, got ${lastRes.status}`);
    }
    if (!lastRes.headers['retry-after']) {
      throw new Error('Missing Retry-After header on 429 response!');
    }
    if (lastRes.body.message !== 'Too many requests. Please try again later.') {
      throw new Error('Unexpected 429 message body format.');
    }
    console.log('    ✅ HTTP 429 & Retry-After header VERIFIED.');

    await apiRunner.stopServer();

    console.log('\n================================================================');
    console.log('✅ PASS: Throttling, Rate Limiting & IP Isolation (Item 5)');
    console.log('================================================================\n');
    process.exit(0);
  } catch (error: any) {
    await apiRunner.stopServer();
    console.error('\n❌ FAIL: Throttling & Rate Limiting Test Suite Failed:', error.message);
    process.exit(1);
  }
}

runLockoutTest();
