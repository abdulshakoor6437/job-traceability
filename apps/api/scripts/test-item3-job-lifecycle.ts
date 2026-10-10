import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import fs from 'fs';
import Redis from 'ioredis';
import { RedisMemoryServer } from 'redis-memory-server';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { agentSessionService } from '../src/services/agentSessionService';
import { getDbPool } from '../src/dal/db';

const PORT = 3993;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

let redisServer: RedisMemoryServer | null = null;

async function ensureRedisRunning() {
  try {
    const client = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1, retryStrategy: () => null });
    await client.ping();
    await client.quit();
  } catch {
    console.log('⚡ Starting in-memory Redis server on port 6379 for test execution...');
    redisServer = new RedisMemoryServer({ instance: { port: 6379 } });
    await redisServer.getHost();
  }
}

async function testItem3() {
  const outputDir = path.resolve(__dirname, '../test-output/module5_agent_control');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const logFile = path.join(outputDir, 'item3_job_lifecycle.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 3 VERIFICATION: Job Lifecycle Tied to Session State');
  print('================================================================\n');

  try {
    await ensureRedisRunning();
    await apiRunner.startServer(PORT);

    const email = `lifecycle_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    print(`1. Registering user ${email}...`);
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });

    const user = await authDal.findUserByEmail(email);
    if (!user) throw new Error(`User creation failed.`);
    await authDal.setUserVerified(user.id);
    const userId = user.id;

    print(`2. Logging in...`);
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie') || '';
    print(`   Login Status: ${loginRes.status}`);

    print(`3. Inspecting Redis directly: verifying background job is scheduled on login...`);
    const isScheduledAfterLogin = await agentSessionService.isJobScheduled(userId);
    const metaAfterLogin = await agentSessionService.getJobMetadata(userId);
    print(`   isJobScheduled in Redis: ${isScheduledAfterLogin}`);
    print(`   Redis Metadata: ${JSON.stringify(metaAfterLogin)}`);

    if (!isScheduledAfterLogin) {
      throw new Error('Assertion failed: Job must be scheduled in Redis on user login.');
    }

    print(`\n4. User logs out...`);
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    print(`   Logout Status: ${logoutRes.status}`);

    print(`5. Inspecting Redis directly: verifying scheduled job is actively removed on logout...`);
    const isScheduledAfterLogout = await agentSessionService.isJobScheduled(userId);
    print(`   isJobScheduled in Redis: ${isScheduledAfterLogout}`);

    if (isScheduledAfterLogout) {
      throw new Error('Assertion failed: Scheduled job must be actively deleted from Redis on logout.');
    }

    print(`\n6. Logging back in to test 30-minute idle expiration...`);
    const loginRes2 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookieHeader2 = loginRes2.headers.get('set-cookie') || '';
    print(`   isJobScheduled in Redis after re-login: ${await agentSessionService.isJobScheduled(userId)}`);

    print(`7. Simulating 31-minute session idle timeout in DB...`);
    const pool = getDbPool();
    await pool.execute(
      `UPDATE user_sessions SET idle_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?`,
      [userId]
    );

    print(`8. Attempting authenticated request with idle session...`);
    const idleCheckRes = await fetch(`${BASE_URL}/api/user/active-signal`, {
      headers: { ...HEADERS, Cookie: cookieHeader2 },
    });
    print(`   Request Status (expect 401 Session Expired): ${idleCheckRes.status}`);

    print(`9. Inspecting Redis directly: verifying job is actively removed when session expires idle...`);
    const isScheduledAfterIdle = await agentSessionService.isJobScheduled(userId);
    print(`   isJobScheduled in Redis: ${isScheduledAfterIdle}`);

    if (isScheduledAfterIdle) {
      throw new Error('Assertion failed: Job must be actively deleted from Redis on idle timeout.');
    }

    print('\n✅ ITEM 3 VERIFICATION PASSED PERFECTLY!\n');
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log output to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 3 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
    if (redisServer) {
      await redisServer.stop();
    }
    process.exit(0);
  }
}

testItem3();
