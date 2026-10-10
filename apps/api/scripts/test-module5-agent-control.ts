import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.USE_MOCK_EMBEDDINGS = 'true';

import fs from 'fs';
import Redis from 'ioredis';
import { RedisMemoryServer } from 'redis-memory-server';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';
import { createUserScopedDal } from '../src/dal/userScopedDal';
import { agentSessionService } from '../src/services/agentSessionService';
import { jobSearchService } from '../src/services/job/jobSearchService';
import { matchingService } from '../src/services/matching/matchingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { FitExplanationService, MockFitExplanationProvider } from '../src/services/matching/fitExplanationService';
import { getDbPool } from '../src/dal/db';
import { JOB_SOURCING_CONFIG } from '../src/services/job/config';

const PORT = 3995;
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
    console.log('⚡ Starting in-memory Redis server on port 6379 for test execution...');
    redisServer = new RedisMemoryServer({ instance: { port: 6379 } });
    await redisServer.getHost();
  }
}

async function runAcceptanceSuite() {
  const outputDir = path.resolve(__dirname, '../test-output/module5_agent_control');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const logFile = path.join(outputDir, 'acceptance_suite_log.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('========================================================================');
  print('🎯 MODULE 5: AGENT SESSION CONTROL ACCEPTANCE TEST SUITE (Tests a - f)');
  print('========================================================================\n');

  try {
    matchingService.setProviders({
      embeddingProvider: new MockEmbeddingProvider(),
      fitExplanationService: new FitExplanationService([new MockFitExplanationProvider()]),
    });

    await ensureRedisRunning();
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    // Clean quota and cache logs for predictable test execution
    const pool = getDbPool();
    await pool.execute('DELETE FROM provider_api_logs');
    await pool.execute('DELETE FROM job_search_cache');

    // ------------------------------------------------------------------------
    // Test a: User logs in; prove a background job is scheduled in Redis
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (a): Background Job Scheduling on User Login');
    print('------------------------------------------------------------------------');
    const emailA = `test_a_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });

    const userA = await authDal.findUserByEmail(emailA);
    if (!userA) throw new Error('User creation failed for test a');
    await authDal.setUserVerified(userA.id);
    const userIdA = userA.id;

    const loginResA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieHeaderA = loginResA.headers.get('set-cookie') || '';

    const isScheduledA = await agentSessionService.isJobScheduled(userIdA);
    const metaA = await agentSessionService.getJobMetadata(userIdA);

    print(`  - User ID: ${userIdA}`);
    print(`  - Login HTTP Status: ${loginResA.status}`);
    print(`  - Job Scheduled in Redis: ${isScheduledA}`);
    print(`  - Redis Key Metadata: ${JSON.stringify(metaA)}`);

    if (!isScheduledA || !metaA) {
      throw new Error('Test (a) FAILED: Job was not scheduled in Redis upon user login.');
    }
    print('✅ Test (a) PASSED.\n');

    // ------------------------------------------------------------------------
    // Test b: Simulate time passing; prove job runs & checks cache staleness
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (b): Recurring Search Cache Staleness & API Call Throttling');
    print('------------------------------------------------------------------------');
    const roleB = `DevOps Specialist ${Date.now()}`;
    const userDalA = createUserScopedDal(userIdA);
    await userDalA.updateSearchPreferences(roleB, 'New York', { remoteOnly: true });

    const cvFileA = await cvDal.createCvFile(
      userIdA,
      'devops.pdf',
      'key_devops',
      'application/pdf',
      1024,
      'DevOps Engineer with Kubernetes, Docker, CI/CD, TypeScript and Terraform skills.'
    );
    await cvDal.createCvProfile(
      userIdA,
      cvFileA.id,
      {
        contact_info: {
          full_name: 'DevOps User',
          email: emailA,
          phone: '555-0100',
          location: 'New York',
          linkedin_url: null,
          website: null,
        },
        summary: 'DevOps Specialist skilled in Kubernetes and Cloud deployment.',
        skills: [
          { skill_name: 'Kubernetes', category: 'DevOps' },
          { skill_name: 'Docker', category: 'DevOps' },
          { skill_name: 'CI/CD', category: 'DevOps' },
          { skill_name: 'TypeScript', category: 'Languages' },
          { skill_name: 'Terraform', category: 'DevOps' },
        ],
        work_history: [
          {
            title: 'DevOps Lead',
            company: 'CloudCorp',
            location: 'New York',
            start_date: '2020-01-01',
            end_date: null,
            is_current: true,
            bullet_points: ['Automated CI/CD'],
          },
        ],
        education: [
          {
            institution: 'State Tech',
            degree: 'B.S.',
            field_of_study: 'IT',
            start_date: '2016-09-01',
            end_date: '2020-05-01',
          },
        ],
        certifications: [],
      },
      false
    );

    jobSearchService.resetCallCounter();
    const run1 = await agentSessionService.executeRecurringUserSearch(userIdA);
    print(`  - 1st Run (Stale Cache): Executed = ${run1.executed}, Calls Made = ${run1.callsMade}, Matches = ${run1.totalMatches}`);

    if (run1.callsMade === 0) {
      throw new Error('Test (b) FAILED: First run on stale cache must spend external API calls.');
    }

    const run2 = await agentSessionService.executeRecurringUserSearch(userIdA);
    print(`  - 2nd Run (Fresh Cache): Executed = ${run2.executed}, Skipped = ${run2.skipped}, Reason = ${run2.reason}, Calls Made = ${run2.callsMade}`);

    if (run2.callsMade !== 0 || run2.reason !== 'cache_fresh') {
      throw new Error('Test (b) FAILED: Second run on fresh cache must spend 0 API calls.');
    }
    print('✅ Test (b) PASSED.\n');

    // ------------------------------------------------------------------------
    // Test c: User logs out; prove scheduled job is actively removed from Redis
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (c): Active Removal of Job from Redis on User Logout');
    print('------------------------------------------------------------------------');
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieHeaderA },
    });

    const isScheduledAfterLogout = await agentSessionService.isJobScheduled(userIdA);
    print(`  - Logout HTTP Status: ${logoutRes.status}`);
    print(`  - Job Scheduled in Redis after Logout: ${isScheduledAfterLogout}`);

    if (isScheduledAfterLogout) {
      throw new Error('Test (c) FAILED: Scheduled job was not deleted from Redis on logout.');
    }
    print('✅ Test (c) PASSED.\n');

    // ------------------------------------------------------------------------
    // Test d: User goes idle past 30 minutes; prove same removal happens
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (d): Active Removal of Job on 30-Minute Idle Timeout');
    print('------------------------------------------------------------------------');
    const loginResA2 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieHeaderA2 = loginResA2.headers.get('set-cookie') || '';
    print(`  - Re-login HTTP Status: ${loginResA2.status}`);
    print(`  - Job Scheduled in Redis after Re-login: ${await agentSessionService.isJobScheduled(userIdA)}`);

    // Simulate 31-minute session idle timeout in database
    await pool.execute(
      `UPDATE user_sessions SET idle_expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE user_id = ?`,
      [userIdA]
    );

    const idleReq = await fetch(`${BASE_URL}/api/user/active-signal`, {
      headers: { ...HEADERS, Cookie: cookieHeaderA2 },
    });
    print(`  - Authenticated Request with Idle Session Status: ${idleReq.status} (expect 401)`);

    const isScheduledAfterIdle = await agentSessionService.isJobScheduled(userIdA);
    print(`  - Job Scheduled in Redis after Idle Expiration: ${isScheduledAfterIdle}`);

    if (isScheduledAfterIdle) {
      throw new Error('Test (d) FAILED: Scheduled job was not deleted from Redis on 30-min idle timeout.');
    }
    print('✅ Test (d) PASSED.\n');

    // ------------------------------------------------------------------------
    // Test e: Manual search always proceeds immediately even with background job
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (e): Immediate Manual User Search Priority');
    print('------------------------------------------------------------------------');
    // Login user again
    const loginResA3 = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieHeaderA3 = loginResA3.headers.get('set-cookie') || '';

    const tStart = Date.now();
    const manualRes = await fetch(`${BASE_URL}/api/jobs/search`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieHeaderA3 },
      body: JSON.stringify({
        role: 'DevOps Specialist',
        location: 'New York',
      }),
    });
    const durationMs = Date.now() - tStart;
    const manualBody = await manualRes.json();

    print(`  - Manual Search HTTP Status: ${manualRes.status}`);
    print(`  - Manual Search Response Time: ${durationMs} ms`);
    print(`  - Manual Search Success: ${manualBody.success}`);

    if (manualRes.status !== 200 || !manualBody.success) {
      throw new Error('Test (e) FAILED: Manual user search did not proceed immediately.');
    }
    print('✅ Test (e) PASSED.\n');

    // ------------------------------------------------------------------------
    // Test f: Low quota simulation; prove background job skips and logs
    // ------------------------------------------------------------------------
    print('------------------------------------------------------------------------');
    print('▶ Acceptance Test (f): Quota-Aware Throttling & Zero Quota Drain');
    print('------------------------------------------------------------------------');
    const limitJSearch = JOB_SOURCING_CONFIG.providerQuotas['jsearch']?.monthlyLimit || 200;

    for (let i = 0; i < limitJSearch; i++) {
      await pool.execute(
        `INSERT INTO provider_api_logs (id, provider, query, response_count, latency_ms, status_code, is_success, called_at)
         VALUES (?, 'jsearch', 'quota test', 5, 100, 200, 1, NOW())`,
        [crypto.randomUUID()]
      );
    }

    jobSearchService.resetCallCounter();
    const lowQuotaRun = await agentSessionService.executeRecurringUserSearch(userIdA);
    print(`  - Low Quota Background Run Skipped: ${lowQuotaRun.skipped}`);
    print(`  - Skip Reason: ${lowQuotaRun.reason}`);
    print(`  - API Calls Made by Background Job: ${lowQuotaRun.callsMade}`);

    if (!lowQuotaRun.skipped || lowQuotaRun.reason !== 'low_quota' || lowQuotaRun.callsMade !== 0) {
      throw new Error('Test (f) FAILED: Background job did not skip when low quota was detected.');
    }
    print('✅ Test (f) PASSED.\n');

    print('========================================================================');
    print('🎉 MODULE 5 ACCEPTANCE TESTS (a - f) PASSED 100% PERFECTLY!');
    print('========================================================================\n');
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log evidence to ${logFile}`);
  } catch (err: any) {
    print(`❌ MODULE 5 ACCEPTANCE SUITE FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
    if (redisServer) {
      await redisServer.stop();
    }
  }
}

if (require.main === module) {
  runAcceptanceSuite().then(() => process.exit(0));
}
