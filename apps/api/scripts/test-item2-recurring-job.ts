import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import fs from 'fs';
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

const PORT = 3992;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem2() {
  const outputDir = path.resolve(__dirname, '../test-output/module5_agent_control');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const logFile = path.join(outputDir, 'item2_recurring_job.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 2 VERIFICATION: Redis-Backed Recurring Background Job');
  print('================================================================\n');

  try {
    // Configure fast mock providers to avoid external LLM rate limits and delays
    matchingService.setProviders({
      embeddingProvider: new MockEmbeddingProvider(),
      fitExplanationService: new FitExplanationService([new MockFitExplanationProvider()]),
    });

    await apiRunner.startServer(PORT);

    const email = `recurring_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';
    const testRole = `Cloud Systems Architect ${Date.now()}`;

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

    // Clear search cache for clean test isolation
    await getDbPool().execute('DELETE FROM job_search_cache');

    const userDal = createUserScopedDal(userId);
    await userDal.updateSearchPreferences(testRole, 'San Francisco', { remoteOnly: true });
    print(`   Saved search preferences for role '${testRole}'.`);

    // Create CV file and profile for matching
    const cvFile = await cvDal.createCvFile(
      userId,
      'test_cv.pdf',
      'storage_key_123',
      'application/pdf',
      1024,
      'Experienced Cloud Engineer skilled in AWS, Kubernetes, TypeScript, Node.js, and SQL.'
    );

    await cvDal.createCvProfile(
      userId,
      cvFile.id,
      {
        contact_info: {
          full_name: 'John Developer',
          email,
          phone: '555-0100',
          location: 'San Francisco',
          linkedin_url: null,
          website: null,
        },
        summary: 'Experienced Cloud Systems Architect specializing in cloud infrastructure.',
        skills: [
          { skill_name: 'AWS', category: 'Cloud' },
          { skill_name: 'Kubernetes', category: 'Cloud' },
          { skill_name: 'TypeScript', category: 'Languages' },
          { skill_name: 'Node.js', category: 'Backend' },
          { skill_name: 'SQL', category: 'Databases' },
        ],
        work_history: [
          {
            title: 'Cloud Systems Architect',
            company: 'Tech Inc',
            location: 'San Francisco',
            start_date: '2020-01-01',
            end_date: null,
            is_current: true,
            bullet_points: ['Built cloud infrastructure'],
          },
        ],
        education: [
          {
            institution: 'University',
            degree: 'B.S.',
            field_of_study: 'Computer Science',
            start_date: '2016-09-01',
            end_date: '2020-05-01',
          },
        ],
        certifications: [],
      },
      false
    );
    print(`   Uploaded and activated CV profile for user.`);

    print(`\n2. First Run: Cache is missing / STALE.`);
    jobSearchService.resetCallCounter();
    const firstResult = await agentSessionService.executeRecurringUserSearch(userId);
    print(`   Executed: ${firstResult.executed}`);
    print(`   Skipped: ${firstResult.skipped}`);
    print(`   Calls Made: ${firstResult.callsMade}`);
    print(`   Total Matches: ${firstResult.totalMatches}`);

    if (firstResult.callsMade === 0) {
      throw new Error('Assertion failed: First run on stale cache must make external provider calls.');
    }

    print(`\n3. Second Run: Cache is now FRESH (reusing Module 2 cache/TTL).`);
    const secondResult = await agentSessionService.executeRecurringUserSearch(userId);
    print(`   Executed: ${secondResult.executed}`);
    print(`   Skipped: ${secondResult.skipped}`);
    print(`   Reason: ${secondResult.reason}`);
    print(`   Calls Made: ${secondResult.callsMade}`);

    if (secondResult.callsMade !== 0 || secondResult.reason !== 'cache_fresh') {
      throw new Error('Assertion failed: Second run on fresh cache must spend 0 API calls.');
    }

    print('\n✅ ITEM 2 VERIFICATION PASSED PERFECTLY!\n');
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log output to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 2 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
    process.exit(0);
  }
}

testItem2();
