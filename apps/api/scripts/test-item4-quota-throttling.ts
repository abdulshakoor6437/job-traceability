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
import { createUserScopedDal } from '../src/dal/userScopedDal';
import { agentSessionService } from '../src/services/agentSessionService';
import { jobSearchService } from '../src/services/job/jobSearchService';
import { matchingService } from '../src/services/matching/matchingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { FitExplanationService, MockFitExplanationProvider } from '../src/services/matching/fitExplanationService';
import { getDbPool } from '../src/dal/db';
import { JOB_SOURCING_CONFIG } from '../src/services/job/config';

const PORT = 3994;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

let redisServer: RedisMemoryServer | null = null;

async function ensureRedisRunning() {
  try {
    const client = new Redis({ host: '127.0.0.1', port: 6379, maxRetriesPerRequest: 1, retryStrategy: () => null });
    client.on('error', () => {});
    await client.ping();
    await client.quit();
  } catch {
    redisServer = new RedisMemoryServer({ instance: { port: 6379 } });
    await redisServer.getHost();
  }
}

async function testItem4() {
  const outputDir = path.resolve(__dirname, '../test-output/module5_agent_control');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const logFile = path.join(outputDir, 'item4_quota_throttling.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 4 VERIFICATION: Quota-Aware Throttling & Priority');
  print('================================================================\n');

  try {
    matchingService.setProviders({
      embeddingProvider: new MockEmbeddingProvider(),
      fitExplanationService: new FitExplanationService([new MockFitExplanationProvider()]),
    });

    await ensureRedisRunning();
    await apiRunner.startServer(PORT);

    const email = `quota_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    print(`1. Registering & logging in user ${email}...`);
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });

    const user = await authDal.findUserByEmail(email);
    if (!user) throw new Error(`User creation failed.`);
    await authDal.setUserVerified(user.id);
    const userId = user.id;

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie') || '';

    const userDal = createUserScopedDal(userId);
    await userDal.updateSearchPreferences('Site Reliability Engineer', 'Remote', { remoteOnly: true });

    // 2. Simulate Low / Exhausted Quota for provider 'jsearch'
    const limit = JOB_SOURCING_CONFIG.providerQuotas['jsearch']?.monthlyLimit || 200;
    print(`\n2. Simulating provider 'jsearch' monthly quota limit reached (${limit}/${limit} calls)...`);

    const pool = getDbPool();
    // Insert mock provider API log entries to simulate limit reached
    for (let i = 0; i < limit; i++) {
      await pool.execute(
        `INSERT INTO provider_api_logs (id, provider, query, response_count, latency_ms, status_code, is_success, called_at)
         VALUES (?, 'jsearch', 'test query', 5, 120, 200, 1, NOW())`,
        [crypto.randomUUID()]
      );
    }

    print(`\n3. Executing background job with low quota...`);
    jobSearchService.resetCallCounter();
    const bgResult = await agentSessionService.executeRecurringUserSearch(userId);
    print(`   Background Job Executed: ${bgResult.executed}`);
    print(`   Background Job Skipped: ${bgResult.skipped}`);
    print(`   Skip Reason: ${bgResult.reason}`);
    print(`   Calls Made by Background Job: ${bgResult.callsMade}`);

    if (!bgResult.skipped || bgResult.reason !== 'low_quota' || bgResult.callsMade !== 0) {
      throw new Error('Assertion failed: Background job must skip and make 0 calls when quota is low.');
    }

    print(`\n4. Triggering manual, user-initiated search (verifying priority)...`);
    const t0 = Date.now();
    const manualRes = await fetch(`${BASE_URL}/api/jobs/search`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieHeader },
      body: JSON.stringify({
        role: 'Site Reliability Engineer',
        location: 'Remote',
        filters: { remoteOnly: true },
      }),
    });
    const manualDuration = Date.now() - t0;
    const manualData = await manualRes.json();

    print(`   Manual Search Status: ${manualRes.status}`);
    print(`   Manual Search Duration: ${manualDuration} ms`);
    print(`   Manual Search Returned Success: ${manualData.success}`);

    if (manualRes.status !== 200 || !manualData.success) {
      throw new Error('Assertion failed: Manual user search must proceed immediately.');
    }

    print('\n✅ ITEM 4 VERIFICATION PASSED PERFECTLY!\n');
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log output to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 4 VERIFICATION FAILED: ${err.message}`);
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

testItem4();
