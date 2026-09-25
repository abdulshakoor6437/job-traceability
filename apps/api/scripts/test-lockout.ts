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

    // 3️⃣ Testing Account Lockout per sha256(email + IP) in MySQL with Immediate 429 & No Sleep Delay (Item 2)
    console.log('\n[3] Testing Account Lockout per sha256(email + IP) with Immediate 429 & No Sleep Delay...');
    
    // Clear rate limits table for clean section 3 test environment
    const { getDbPool } = require('../src/dal/db');
    await getDbPool().execute('DELETE FROM rate_limits');
    
    // Create a known user first
    const knownEmail = `lockout_known_${Date.now()}@example.com`;
    const unknownEmail = `lockout_unknown_${Date.now()}@example.com`;
    const testPassword = 'Password123!';

    await makeRequest(API_PORT, 'POST', '/api/auth/signup', { email: knownEmail, password: testPassword });

    // Fail 7 times on known email and measure latency
    for (let i = 1; i <= 7; i++) {
      const start = Date.now();
      const res = await makeRequest(API_PORT, 'POST', '/api/auth/login', { email: knownEmail, password: 'WrongPassword!' });
      const durationMs = Date.now() - start;

      if (durationMs > 500) {
        throw new Error(`Request ${i} took ${durationMs}ms which indicates an artificial sleep/delay!`);
      }
      if (res.status !== 401) {
        throw new Error(`Expected status 401 for failed attempt ${i}, got ${res.status}`);
      }
    }

    // 8th attempt on known email must return 429 immediately
    const start8 = Date.now();
    const res8Known = await makeRequest(API_PORT, 'POST', '/api/auth/login', { email: knownEmail, password: 'WrongPassword!' });
    const dur8Known = Date.now() - start8;

    console.log(`    Known Email 8th Request -> Status: ${res8Known.status} | Latency: ${dur8Known}ms | Retry-After: ${res8Known.headers['retry-after']}`);

    if (res8Known.status !== 429) {
      throw new Error(`Expected 429 on 8th attempt for known email, got ${res8Known.status}`);
    }
    if (!res8Known.headers['retry-after']) {
      throw new Error('Missing Retry-After header on 429 response for known email!');
    }
    if (dur8Known > 100) {
      throw new Error(`Blocked request took ${dur8Known}ms which indicates unexpected delay!`);
    }

    // Reset rate_limits table so IP-level rate limit does not block unknown email test
    await getDbPool().execute('DELETE FROM rate_limits');

    // Fail 7 times on unknown email and measure latency
    for (let i = 1; i <= 7; i++) {
      const start = Date.now();
      const res = await makeRequest(API_PORT, 'POST', '/api/auth/login', { email: unknownEmail, password: 'WrongPassword!' });
      const durationMs = Date.now() - start;

      if (durationMs > 500) {
        throw new Error(`Request ${i} took ${durationMs}ms which indicates an artificial sleep/delay!`);
      }
      if (res.status !== 401) {
        throw new Error(`Expected status 401 for failed attempt ${i}, got ${res.status}`);
      }
    }

    // 8th attempt on unknown email must return 429 immediately with identical response
    const start8Un = Date.now();
    const res8Unknown = await makeRequest(API_PORT, 'POST', '/api/auth/login', { email: unknownEmail, password: 'WrongPassword!' });
    const dur8Unknown = Date.now() - start8Un;

    console.log(`    Unknown Email 8th Request -> Status: ${res8Unknown.status} | Latency: ${dur8Unknown}ms | Retry-After: ${res8Unknown.headers['retry-after']}`);

    if (res8Unknown.status !== 429) {
      throw new Error(`Expected 429 on 8th attempt for unknown email, got ${res8Unknown.status}`);
    }
    if (JSON.stringify(res8Known.body) !== JSON.stringify(res8Unknown.body)) {
      throw new Error('Response body mismatch between known and unknown email 429 responses!');
    }
    console.log('    ✅ MySQL-backed login lockout & non-blocking immediate 429 VERIFIED.');

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
