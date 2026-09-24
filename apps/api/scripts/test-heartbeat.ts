import http from 'http';
import { authDal } from '../src/dal/authDal';
import { config } from '../src/config/env';
import { getDbPool } from '../src/dal/db';
import crypto from 'crypto';

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

async function runHeartbeatTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING SESSION HEARTBEAT & IDLE EXPIRATION SUITE');
  console.log('================================================================\n');

  const pool = getDbPool();
  const timestamp = Date.now();
  const userId = crypto.randomUUID();
  const email = `heartbeat_${timestamp}@example.com`;

  await authDal.createUser(userId, email, '$2a$10$dummyhashedpasswordstring');

  const now = new Date();
  const absoluteExp = new Date(now.getTime() + 60000);

  // Test 0: Polling alone does NOT extend idle timeout (polling alone expires)
  console.log('0️⃣ Testing Polling Alone Does NOT Extend Idle Expiration:');
  const pollingToken = 'polling_test_token_' + timestamp;
  const pollingHash = crypto.createHash('sha256').update(pollingToken).digest('hex');
  const pollingSessionId = crypto.randomUUID();
  const pollingIdle = new Date(Math.floor(Date.now() / 1000) * 1000 + 300000);

  await pool.execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (?, ?, ?, ?, ?)`,
    [pollingSessionId, userId, pollingHash, absoluteExp, pollingIdle]
  );

  console.log('   Sending GET /api/user/active-signal (polling route)...');
  await makeRequest('GET', '/api/user/active-signal', undefined, {
    Authorization: `Bearer ${pollingToken}`,
  });

  const [pollRows] = await pool.query<any[]>(`SELECT idle_expires_at FROM user_sessions WHERE id = ?`, [pollingSessionId]);
  const pollIdleAfter = new Date(pollRows[0].idle_expires_at);
  if (pollIdleAfter.getTime() !== pollingIdle.getTime()) {
    throw new Error(`HEARTBEAT TEST FAILED: Polling route modified idle_expires_at! Expected ${pollingIdle.toISOString()}, got ${pollIdleAfter.toISOString()}`);
  }
  console.log('   ✅ Polling alone expires VERIFIED (idle_expires_at strictly unchanged by polling).');

  // Test 1: Heartbeat extends session
  console.log('\n1️⃣ Testing Session Heartbeat Extension:');
  const sessionToken = 'heartbeat_test_token_' + timestamp;
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const sessionId = crypto.randomUUID();

  const shortIdle = new Date(now.getTime() + 3000); // 3 seconds idle

  await pool.execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, userId, tokenHash, absoluteExp, shortIdle]
  );

  console.log('   Sending POST /api/session/heartbeat to extend idle timeout...');
  const hbRes = await makeRequest('POST', '/api/session/heartbeat', undefined, {
    Authorization: `Bearer ${sessionToken}`,
  });
  console.log(`   Heartbeat Response Status: ${hbRes.status}`);
  if (hbRes.status !== 200) {
    throw new Error('HEARTBEAT TEST FAILED: Heartbeat request failed!');
  }

  // Verify idle_expires_at was extended in DB
  const [rows] = await pool.query<any[]>(`SELECT idle_expires_at FROM user_sessions WHERE id = ?`, [sessionId]);
  const newIdle = new Date(rows[0].idle_expires_at);
  if (newIdle.getTime() <= shortIdle.getTime()) {
    throw new Error('HEARTBEAT TEST FAILED: Heartbeat did not extend session idle_expires_at!');
  }
  console.log('   ✅ Heartbeat extension VERIFIED.');

  // Test 2: Heartbeat after idle timeout is rejected
  console.log('\n2️⃣ Testing Heartbeat After Idle Expiration:');
  const expiredToken = 'expired_heartbeat_token_' + timestamp;
  const expiredHash = crypto.createHash('sha256').update(expiredToken).digest('hex');
  const expiredSessionId = crypto.randomUUID();

  const pastIdle = new Date(Date.now() - 1000); // Expired 1 second ago

  await pool.execute(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, idle_expires_at) VALUES (?, ?, ?, ?, ?)`,
    [expiredSessionId, userId, expiredHash, absoluteExp, pastIdle]
  );

  const lateHbRes = await makeRequest('POST', '/api/session/heartbeat', undefined, {
    Authorization: `Bearer ${expiredToken}`,
  });
  console.log(`   Late Heartbeat Response Status: ${lateHbRes.status} (Expected 401)`);
  if (lateHbRes.status !== 401) {
    throw new Error('HEARTBEAT TEST FAILED: Heartbeat sent after idle expiration was accepted!');
  }
  console.log('   ✅ Late heartbeat rejection VERIFIED.');

  console.log('\n================================================================');
  console.log('🎉 SESSION HEARTBEAT & IDLE EXPIRATION TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runHeartbeatTest().catch((err) => {
  console.error('\n❌ HEARTBEAT TEST FAILED:', err);
  process.exit(1);
});
