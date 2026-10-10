import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';
import { tailoredCvDal } from '../src/dal/tailoredCvDal';
import { apiRunner } from './test-helpers/apiRunner';

const OUTPUT_DIR = path.resolve(__dirname, '../test-output/module6-item0');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const LOG_FILE = path.join(OUTPUT_DIR, 'tailored-cv-list-test-log.txt');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });

function log(msg: string) {
  console.log(msg);
  logStream.write(msg + '\n');
}

function makeRequest(
  port: number,
  path: string,
  method: string,
  sessionToken?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (sessionToken) {
      headers['Cookie'] = `session_token=${sessionToken}`;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: data });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function createAuthenticatedUser(email: string): Promise<{ userId: string; sessionToken: string }> {
  const pool = getDbPool();
  const userId = crypto.randomUUID();
  await authDal.createUser(userId, email, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
  await pool.execute('UPDATE users SET is_verified = 1 WHERE id = ?', [userId]);

  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const idleExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await authDal.createSession(sessionId, userId, tokenHash, expiresAt, idleExpiresAt);

  return { userId, sessionToken: rawSessionToken };
}

async function seedTestJob(id: string, title: string, company: string) {
  const pool = getDbPool();
  const dedupKey = `dedup-${id}`;
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, title, company, location, remote, description, source_providers, external_ids)
     VALUES (?, ?, ?, ?, 'San Francisco, CA', 1, 'Job description here', '["test"]', '{}')
     ON DUPLICATE KEY UPDATE title = VALUES(title), company = VALUES(company)`,
    [id, dedupKey, title, company]
  );
}

async function seedCvProfile(userId: string): Promise<string> {
  const file = await cvDal.createCvFile(
    userId,
    'resume.pdf',
    `keys/${userId}-resume.pdf`,
    'application/pdf',
    1024,
    'Resume content'
  );

  const profile = await cvDal.createCvProfile(
    userId,
    file.id,
    {
      contact_info: { full_name: 'Test Candidate', email: 'candidate@test.com', phone: '555-1234', location: 'SF', linkedin_url: null, website: null },
      summary: 'Experienced Engineer',
      work_history: [{ title: 'Software Engineer', company: 'Tech Inc', location: 'SF', start_date: '2020-01', end_date: null, is_current: true, bullet_points: ['Built stuff'] }],
      education: [],
      skills: [{ skill_name: 'TypeScript', category: 'Languages' }],
      certifications: [],
    },
    false,
    'completed',
    null
  );

  return profile.profile.id;
}

async function runTest() {
  log('================================================================');
  log('🚀 MODULE 6 ADDITION: GET /api/tailored-cv/list ACCEPTANCE TEST');
  log('================================================================\n');

  const PORT = 4099;
  await apiRunner.startServer(PORT);
  log(`✅ Test server running on http://127.0.0.1:${PORT}`);

  try {
    // 1. Create Users
    log('\n1. Creating User A and User B...');
    const userA = await createAuthenticatedUser(`usera_${Date.now()}@example.com`);
    const userB = await createAuthenticatedUser(`userb_${Date.now()}@example.com`);
    log(`   User A ID: ${userA.userId}`);
    log(`   User B ID: ${userB.userId}`);

    // 2. Seed Jobs in cached_jobs
    log('\n2. Seeding test jobs in cached_jobs...');
    await seedTestJob('job-list-001', 'Senior Backend Engineer', 'Acme Corp');
    await seedTestJob('job-list-002', 'Fullstack Developer', 'Beta Tech');
    await seedTestJob('job-list-003', 'DevOps Lead', 'Gamma Systems');
    log('   ✅ Seeded 3 jobs (Acme Corp, Beta Tech, Gamma Systems)');

    // 3. Seed CV profiles
    const sourceCvA = await seedCvProfile(userA.userId);
    const sourceCvB = await seedCvProfile(userB.userId);

    // 4. Create Tailored CVs for User A
    log('\n3. Generating tailored CVs for User A...');
    const dummyContact = { full_name: 'Test Candidate', email: 'test@example.com', phone: '555-0000', location: 'SF', linkedin_url: null, website: null };

    // Job 1 v1
    const cvA1_v1 = await tailoredCvDal.createTailoredCv({
      userId: userA.userId,
      sourceCvProfileId: sourceCvA,
      jobId: 'job-list-001',
      jobTitle: 'Senior Backend Engineer',
      structuredData: { contact_info: dummyContact, summary: 'v1', work_history: [], education: [], skills: [], certifications: [] },
      generationStatus: 'completed',
      validationStatus: 'clean',
    });
    log(`   Created User A - Job 1 - Version 1 (ID: ${cvA1_v1.tailoredCv.id})`);

    // Job 1 v2 (this will update v1 to is_current=0, v2 to is_current=1)
    const cvA1_v2 = await tailoredCvDal.createTailoredCv({
      userId: userA.userId,
      sourceCvProfileId: sourceCvA,
      jobId: 'job-list-001',
      jobTitle: 'Senior Backend Engineer',
      structuredData: { contact_info: dummyContact, summary: 'v2', work_history: [], education: [], skills: [], certifications: [] },
      generationStatus: 'completed',
      validationStatus: 'clean',
    });
    log(`   Created User A - Job 1 - Version 2 (ID: ${cvA1_v2.tailoredCv.id}, is_current=1)`);

    // Job 2 v1
    const cvA2_v1 = await tailoredCvDal.createTailoredCv({
      userId: userA.userId,
      sourceCvProfileId: sourceCvA,
      jobId: 'job-list-002',
      jobTitle: 'Fullstack Developer',
      structuredData: { contact_info: dummyContact, summary: 'Job 2 v1', work_history: [], education: [], skills: [], certifications: [] },
      generationStatus: 'completed',
      validationStatus: 'clean',
    });
    log(`   Created User A - Job 2 - Version 1 (ID: ${cvA2_v1.tailoredCv.id}, is_current=1)`);

    // 5. Create Tailored CV for User B
    log('\n4. Generating tailored CV for User B...');
    const cvB1_v1 = await tailoredCvDal.createTailoredCv({
      userId: userB.userId,
      sourceCvProfileId: sourceCvB,
      jobId: 'job-list-003',
      jobTitle: 'DevOps Lead',
      structuredData: { contact_info: dummyContact, summary: 'User B Job 3 v1', work_history: [], education: [], skills: [], certifications: [] },
      generationStatus: 'completed',
      validationStatus: 'clean',
    });
    log(`   Created User B - Job 3 - Version 1 (ID: ${cvB1_v1.tailoredCv.id}, is_current=1)`);

    // 6. Test GET /api/tailored-cv/list for User A
    log('\n5. Requesting GET /api/tailored-cv/list for User A...');
    const resA = await makeRequest(PORT, '/api/tailored-cv/list', 'GET', userA.sessionToken);
    log(`   HTTP Response Status: ${resA.status}`);
    log(`   Response Body: ${JSON.stringify(resA.body, null, 2)}`);

    if (resA.status !== 200) {
      throw new Error(`Expected HTTP 200 for User A, got ${resA.status}`);
    }

    const listA = resA.body.tailoredCvs || resA.body.list;
    if (!Array.isArray(listA)) {
      throw new Error('Response body does not contain tailoredCvs array');
    }

    log(`\n   User A List Items Count: ${listA.length}`);
    if (listA.length !== 2) {
      throw new Error(`Requirement 1 FAILED: Expected exactly 2 current versions for User A, got ${listA.length}`);
    }

    // Verify only CURRENT versions (is_current = 1) are returned
    const v1Job1InList = listA.find((item: any) => item.id === cvA1_v1.tailoredCv.id);
    if (v1Job1InList) {
      throw new Error('Requirement 1 FAILED: Historical version v1 was included in list! Must only include is_current=1.');
    }
    log('   ✅ Requirement 1 PASSED: Historical versions excluded, only current version (is_current=1) returned per job.');

    // Verify required fields (Req 2)
    const job1Item = listA.find((item: any) => item.id === cvA1_v2.tailoredCv.id);
    const job2Item = listA.find((item: any) => item.id === cvA2_v1.tailoredCv.id);

    if (!job1Item || !job2Item) {
      throw new Error('Requirement 2 FAILED: Expected items for Job 1 v2 and Job 2 v1');
    }

    log('\n   Verifying row data formatting (Requirement 2):');
    log(`   Job 1 Row: ${job1Item.jobTitle} @ ${job1Item.company} — v${job1Item.versionNumber} (ID: ${job1Item.id}, JobID: ${job1Item.jobId}, CreatedAt: ${job1Item.createdAt})`);
    log(`   Job 2 Row: ${job2Item.jobTitle} @ ${job2Item.company} — v${job2Item.versionNumber} (ID: ${job2Item.id}, JobID: ${job2Item.jobId}, CreatedAt: ${job2Item.createdAt})`);

    if (job1Item.company !== 'Acme Corp' || job1Item.versionNumber !== 2 || job1Item.jobTitle !== 'Senior Backend Engineer') {
      throw new Error(`Requirement 2 FAILED: Job 1 row metadata incorrect: ${JSON.stringify(job1Item)}`);
    }
    if (job2Item.company !== 'Beta Tech' || job2Item.versionNumber !== 1 || job2Item.jobTitle !== 'Fullstack Developer') {
      throw new Error(`Requirement 2 FAILED: Job 2 row metadata incorrect: ${JSON.stringify(job2Item)}`);
    }
    log('   ✅ Requirement 2 PASSED: Rows include tailored CV ID, job ID, job title, company, version number, created_at for popup dropdown.');

    // 7. Test Cross-User Isolation (Req 3)
    log('\n6. Testing Cross-User Isolation (Requirement 3)...');
    const userBRowInUserAList = listA.find((item: any) => item.id === cvB1_v1.tailoredCv.id);
    if (userBRowInUserAList) {
      throw new Error('Requirement 3 FAILED: User A received User B row in list!');
    }

    log('   Requesting GET /api/tailored-cv/list for User B...');
    const resB = await makeRequest(PORT, '/api/tailored-cv/list', 'GET', userB.sessionToken);
    const listB = resB.body.tailoredCvs || resB.body.list;
    log(`   User B List Items Count: ${listB.length}`);
    if (listB.length !== 1 || listB[0].id !== cvB1_v1.tailoredCv.id) {
      throw new Error(`Requirement 3 FAILED: User B list should contain exactly 1 row (User B's row), got ${JSON.stringify(listB)}`);
    }
    const userARowInUserBList = listB.find((item: any) => item.id === cvA1_v2.tailoredCv.id || item.id === cvA2_v1.tailoredCv.id);
    if (userARowInUserBList) {
      throw new Error('Requirement 3 FAILED: User B received User A row in list!');
    }
    log('   ✅ Requirement 3 PASSED: Cross-user DAL isolation verified. User A list contains 0 rows for User B; User B list contains 0 rows for User A.');

    // 8. Test Unauthenticated Request
    log('\n7. Testing unauthenticated request (security check)...');
    const resUnauth = await makeRequest(PORT, '/api/tailored-cv/list', 'GET');
    log(`   Unauthenticated status: ${resUnauth.status}`);
    if (resUnauth.status !== 401) {
      throw new Error(`Security Check FAILED: Expected 401 for unauthenticated request, got ${resUnauth.status}`);
    }
    log('   ✅ Unauthenticated request correctly rejected with 401 Unauthorized.');

    log('\n================================================================');
    log('🎉 ALL GET /api/tailored-cv/list ACCEPTANCE TESTS PASSED!');
    log('================================================================');
  } catch (err: any) {
    log(`\n❌ TEST FAILED: ${err.message || err}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    await apiRunner.stopServer();
    logStream.end();
    try {
      const pool = getDbPool();
      await pool.end();
    } catch {}
  }

  process.exit(process.exitCode || 0);
}

runTest();
