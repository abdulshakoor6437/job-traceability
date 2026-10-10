import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.USE_MOCK_EMBEDDINGS = 'true';

import fs from 'fs';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { applicationDal } from '../src/dal/applicationDal';
import { getDbPool } from '../src/dal/db';

const PORT = 4123;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem4() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'item4_app_history.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 4 VERIFICATION: Application Status History & Transitions');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    const emailA = `hist_user_a_${Date.now()}@example.com`;
    const emailB = `hist_user_b_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });

    const userA = await authDal.findUserByEmail(emailA);
    const userB = await authDal.findUserByEmail(emailB);
    await authDal.setUserVerified(userA!.id);
    await authDal.setUserVerified(userB!.id);

    // Seed test job directly into cached_jobs table
    const jobId = `hist-job-${Date.now()}`;
    const pool = getDbPool();
    await pool.execute(
      `INSERT INTO cached_jobs (id, dedup_key, title, company, location, remote, salary_currency, description, apply_url, fetched_at, source_providers, external_ids)
       VALUES (?, ?, 'Lead Software Architect', 'Apex Systems', 'San Francisco, CA', 0, 'USD', 'Cloud infrastructure', 'https://example.com', NOW(), '["test"]', '{}')`,
      [jobId, `dedup-${jobId}`]
    );

    print('1. Logging in User A & User B...');
    const loginResA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieA = loginResA.headers.get('set-cookie') || '';

    const loginResB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });
    const cookieB = loginResB.headers.get('set-cookie') || '';

    print('\n2. Simulating User A job status transitions: NOT_REVIEWED -> TAILORED -> EXPORTED -> APPLIED...');

    // Step 1: Initial creation (NOT_REVIEWED)
    const step1Res = await fetch(`${BASE_URL}/api/applications/mark-applied`, {
      method: 'POST',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ jobId, status: 'NOT_REVIEWED', notes: 'Initial match found' }),
    });
    const step1Body = await step1Res.json();
    const appId = step1Body.application.id;
    print(`   Transition 1 (Creation): Status = ${step1Body.application.status}, AppID = ${appId}`);

    await new Promise((r) => setTimeout(r, 50));

    // Step 2: Update status to TAILORED
    const step2Res = await fetch(`${BASE_URL}/api/applications/${appId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'TAILORED', notes: 'Generated tailored CV' }),
    });
    print(`   Transition 2 (Tailored): Status = ${step2Res.status}`);

    await new Promise((r) => setTimeout(r, 50));

    // Step 3: Update status to EXPORTED
    const step3Res = await fetch(`${BASE_URL}/api/applications/${appId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'EXPORTED', notes: 'Exported PDF/DOCX' }),
    });
    print(`   Transition 3 (Exported): Status = ${step3Res.status}`);

    await new Promise((r) => setTimeout(r, 50));

    // Step 4: Update status to APPLIED
    const step4Res = await fetch(`${BASE_URL}/api/applications/${appId}/status`, {
      method: 'PATCH',
      headers: { ...HEADERS, Cookie: cookieA },
      body: JSON.stringify({ status: 'APPLIED', notes: 'Submitted via Extension' }),
    });
    print(`   Transition 4 (Applied): Status = ${step4Res.status}`);

    print('\n3. Querying GET /api/applications/history for User A...');
    const histResA = await fetch(`${BASE_URL}/api/applications/history`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const histBodyA = await histResA.json();

    print(`   History HTTP Status: ${histResA.status}`);
    print(`   Total Transition Records: ${histBodyA.history?.length}`);

    if (histBodyA.history?.length !== 4) {
      throw new Error(`Test (e) FAILED: Expected 4 transition history records, got ${histBodyA.history?.length}`);
    }

    for (let i = 0; i < histBodyA.history.length; i++) {
      const h = histBodyA.history[i];
      print(`   [Record ${i + 1}] From: ${h.from_status || 'NULL'} -> To: ${h.to_status} | Timestamp: ${h.transitioned_at} | Job: ${h.job_title} @ ${h.company}`);
    }

    // Verify status sequence
    const sequence = histBodyA.history.map((h: any) => h.to_status);
    print(`   Recorded Status Sequence: ${JSON.stringify(sequence)}`);

    if (JSON.stringify(sequence) !== JSON.stringify(['NOT_REVIEWED', 'TAILORED', 'EXPORTED', 'APPLIED'])) {
      throw new Error('Test (e) FAILED: Status transition sequence does not match exact progression!');
    }

    print('\n4. Testing Cross-User Isolation (User B queries GET /api/applications/history)...');
    const histResB = await fetch(`${BASE_URL}/api/applications/history`, {
      headers: { ...HEADERS, Cookie: cookieB },
    });
    const histBodyB = await histResB.json();
    print(`   User B History Count: ${histBodyB.history?.length} (Expected: 0)`);

    if (histBodyB.history?.length !== 0) {
      throw new Error('Cross-user DAL isolation failed on application status history endpoint!');
    }

    print('\n================================================================');
    print('✅ ITEM 4 VERIFICATION PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log evidence to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 4 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
  }
}

if (require.main === module) {
  testItem4().then(() => process.exit(0));
}
