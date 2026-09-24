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

async function runConcurrencyTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING ATOMIC TOKEN CONSUMPTION CONCURRENCY TEST');
  console.log('================================================================\n');

  const pool = getDbPool();
  try {
    await pool.execute('DELETE FROM rate_limits');
  } catch {}
  const timestamp = Date.now();
  const userId = crypto.randomUUID();
  const email = `concurrency_${timestamp}@example.com`;

  await authDal.createUser(userId, email, '$2a$10$dummyhashedpasswordstring');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60000);

  await authDal.createEmailVerificationToken(tokenId, userId, tokenHash, expiresAt);
  console.log('   Verification token created in database.');

  console.log('   ⚡ Firing 2 SIMULTANEOUS concurrent HTTP requests to consume the exact same token...');

  const [req1, req2] = await Promise.all([
    makeRequest('POST', '/api/auth/verify-email', { token: rawToken }),
    makeRequest('POST', '/api/auth/verify-email', { token: rawToken }),
  ]);

  console.log(`   Request 1 Status: ${req1.status}`);
  console.log(`   Request 2 Status: ${req2.status}`);

  const statuses = [req1.status, req2.status].sort();

  if (statuses[0] !== 200 || statuses[1] !== 400) {
    throw new Error(`CONCURRENCY FAILURE: Expected one 200 and one 400, got ${req1.status} and ${req2.status}!`);
  }

  console.log('   ✅ Atomic Token Consumption CONCURRENCY VERIFIED: Exactly one request succeeded.');

  console.log('\n================================================================');
  console.log('🎉 CONCURRENCY TEST PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runConcurrencyTest().catch((err) => {
  console.error('\n❌ CONCURRENCY TEST FAILED:', err);
  process.exit(1);
});
