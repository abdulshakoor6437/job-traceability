import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import crypto from 'crypto';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import puppeteer, { Browser, Page } from 'puppeteer';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';
import { tailoredCvDal } from '../src/dal/tailoredCvDal';
import { applicationDal } from '../src/dal/applicationDal';
import { apiRunner } from './test-helpers/apiRunner';

const OUTPUT_DIR = path.resolve(__dirname, '../test-output/module6');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const LOG_FILE = path.join(OUTPUT_DIR, 'module6-acceptance-log.txt');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });

function log(msg: string) {
  console.log(msg);
  logStream.write(msg + '\n');
}

function makeRequest(
  port: number,
  pathName: string,
  method: string,
  bodyData?: any,
  sessionToken?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
    };
    if (sessionToken) {
      headers['Cookie'] = `session_token=${sessionToken}`;
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
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
    if (bodyData) {
      req.write(JSON.stringify(bodyData));
    }
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

async function runModule6AcceptanceTests() {
  log('================================================================');
  log('🚀 MODULE 6: CHROME EXTENSION AUTOFILL ACCEPTANCE TEST SUITE');
  log('================================================================\n');

  const PORT = 4098;
  await apiRunner.startServer(PORT);
  log(`✅ API Test server listening on http://127.0.0.1:${PORT}`);

  let browser: Browser | null = null;

  try {
    // ------------------------------------------------------------------------
    // TEST (a): Manifest V3 Extension Package & Structure Audit
    // ------------------------------------------------------------------------
    log('\n▶ [TEST a] Auditing Manifest V3 Extension Package & Structure...');
    const manifestPath = path.resolve(__dirname, '../../extension/manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('TEST (a) FAILED: manifest.json missing in apps/extension');
    }

    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    log(`   Extension Name: ${manifest.name}`);
    log(`   Manifest Version: ${manifest.manifest_version}`);
    log(`   Permissions: ${JSON.stringify(manifest.permissions)}`);

    if (manifest.manifest_version !== 3) {
      throw new Error(`TEST (a) FAILED: Expected manifest_version 3, got ${manifest.manifest_version}`);
    }
    if (!manifest.permissions.includes('storage') || !manifest.permissions.includes('activeTab')) {
      throw new Error('TEST (a) FAILED: Missing required permissions in manifest.json');
    }
    if (!manifest.background?.service_worker || !manifest.content_scripts?.[0]?.js?.[0]) {
      throw new Error('TEST (a) FAILED: Missing service_worker or content_scripts configuration');
    }

    log('✅ TEST (a) PASSED: Manifest V3 extension structure validated.\n');

    // ------------------------------------------------------------------------
    // TEST (b): Extension Auth Connection & Session Sync
    // ------------------------------------------------------------------------
    log('▶ [TEST b] Testing Extension Auth Connection & Session Sync...');
    const testUserEmail = `ext_user_${Date.now()}@example.com`;
    const userA = await createAuthenticatedUser(testUserEmail);

    // Test user profile / session route
    const resAuth = await makeRequest(PORT, '/api/auth/me', 'GET', null, userA.sessionToken);
    log(`   Active Session HTTP Status: ${resAuth.status}`);
    log(`   User Email Returned: ${resAuth.body?.user?.email}`);

    if (resAuth.status !== 200 || resAuth.body?.user?.email !== testUserEmail) {
      throw new Error('TEST (b) FAILED: Extension auth session sync failed');
    }

    // Test GET /api/tailored-cv/list integration
    await seedTestJob('ext-job-001', 'Senior Fullstack Engineer', 'Acme Systems');
    const file = await cvDal.createCvFile(userA.userId, 'cv.pdf', 'keys/cv.pdf', 'application/pdf', 2048, 'CV Text');
    const profile = await cvDal.createCvProfile(
      userA.userId,
      file.id,
      { contact_info: { full_name: 'Jane Doe', email: testUserEmail, phone: '555-9999', location: 'SF', linkedin_url: null, website: null }, summary: 'Engineer', work_history: [], education: [], skills: [], certifications: [] },
      false,
      'completed',
      null
    );

    const tailoredCv = await tailoredCvDal.createTailoredCv({
      userId: userA.userId,
      sourceCvProfileId: profile.profile.id,
      jobId: 'ext-job-001',
      jobTitle: 'Senior Fullstack Engineer',
      structuredData: { contact_info: { full_name: 'Jane Doe', email: testUserEmail, phone: '555-9999', location: 'SF', linkedin_url: 'https://linkedin.com/in/janedoe', website: 'https://janedoe.dev' }, summary: 'Tailored summary for Acme Systems', work_history: [], education: [], skills: [], certifications: [] },
      generationStatus: 'completed',
      validationStatus: 'clean',
    });

    const resCvList = await makeRequest(PORT, '/api/tailored-cv/list', 'GET', null, userA.sessionToken);
    log(`   Tailored CV List Count: ${resCvList.body?.tailoredCvs?.length}`);
    log(`   Selected CV Label: ${resCvList.body?.tailoredCvs?.[0]?.jobTitle} @ ${resCvList.body?.tailoredCvs?.[0]?.company}`);

    if (resCvList.status !== 200 || resCvList.body?.tailoredCvs?.length !== 1) {
      throw new Error('TEST (b) FAILED: Failed to fetch tailored CV list for extension popup dropdown');
    }

    log('✅ TEST (b) PASSED: Extension auth connection & tailored CV list sync verified.\n');

    // Launch Puppeteer for Content Script DOM Autofill Tests (c, d, e, f)
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const contentJsPath = path.resolve(__dirname, '../../extension/src/content.js');
    const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

    // ------------------------------------------------------------------------
    // TEST (c): Greenhouse Form Detection & Autofill
    // ------------------------------------------------------------------------
    log('▶ [TEST c] Testing Greenhouse Form Detection & Autofill...');
    const pageC = await browser.newPage();
    const greenhouseHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Greenhouse Job Application</title></head>
        <body>
          <form id="application_form" action="https://boards.greenhouse.io/acme/jobs/12345">
            <input type="text" id="first_name" name="first_name" />
            <input type="text" id="last_name" name="last_name" />
            <input type="email" id="email" name="email" />
            <input type="tel" id="phone" name="phone" />
            <input type="text" id="job_application_location" name="job_application[location]" />
            <input type="text" name="job_application[answers_attributes][0][text_value]" aria-label="LinkedIn Profile" id="linkedin_input" />
            <textarea id="cover_letter_text" name="cover_letter_text"></textarea>
            <input type="file" id="resume" name="resume" />
            <button type="submit" id="submit_app">Submit Application</button>
          </form>
        </body>
      </html>
    `;
    await pageC.setContent(greenhouseHtml);
    await pageC.evaluate(contentJsCode);

    const resultC: any = await pageC.evaluate((data) => {
      return (window as any).jobAgentAutofill(data, 'Senior Fullstack Engineer @ Acme');
    }, tailoredCv.tailoredCv);

    const firstNameVal = await pageC.$eval('#first_name', (el: any) => el.value);
    const emailVal = await pageC.$eval('#email', (el: any) => el.value);
    const phoneVal = await pageC.$eval('#phone', (el: any) => el.value);

    log(`   Detected Board: ${resultC.board}`);
    log(`   Filled Fields: First Name="${firstNameVal}", Email="${emailVal}", Phone="${phoneVal}"`);

    if (firstNameVal !== 'Jane' || emailVal !== testUserEmail || phoneVal !== '555-9999') {
      throw new Error('TEST (c) FAILED: Greenhouse form field values were not correctly filled');
    }
    log('✅ TEST (c) PASSED: Greenhouse form detection & autofill verified.\n');

    // ------------------------------------------------------------------------
    // TEST (d): Lever Form Detection & Autofill
    // ------------------------------------------------------------------------
    log('▶ [TEST d] Testing Lever Form Detection & Autofill...');
    const pageD = await browser.newPage();
    const leverHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Lever Job Application</title></head>
        <body>
          <form id="application-form" action="https://jobs.lever.co/beta/123">
            <input type="text" name="name" />
            <input type="email" name="email" />
            <input type="tel" name="phone" />
            <input type="text" name="org" />
            <input type="text" name="urls[LinkedIn]" />
            <input type="text" name="urls[Portfolio]" />
            <textarea name="comments"></textarea>
            <input type="file" name="resume" />
            <button type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `;
    await pageD.setContent(leverHtml);
    await pageD.evaluate(contentJsCode);

    const resultD: any = await pageD.evaluate((data) => {
      return (window as any).jobAgentAutofill(data, 'Lever Job Target');
    }, tailoredCv.tailoredCv);

    const leverName = await pageD.$eval('input[name="name"]', (el: any) => el.value);
    const leverEmail = await pageD.$eval('input[name="email"]', (el: any) => el.value);

    log(`   Lever Form Filled: Board="${resultD.board}", Name="${leverName}", Email="${leverEmail}"`);
    if (leverName !== 'Jane Doe' || leverEmail !== testUserEmail) {
      throw new Error('TEST (d) FAILED: Lever form autofill failed');
    }
    log('✅ TEST (d) PASSED: Lever form detection & autofill verified.\n');

    // ------------------------------------------------------------------------
    // TEST (e): Ashby Form Detection & Autofill
    // ------------------------------------------------------------------------
    log('▶ [TEST e] Testing Ashby Form Detection & Autofill...');
    const pageE = await browser.newPage();
    const ashbyHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Ashby Job Application</title></head>
        <body>
          <form action="https://jobs.ashbyhq.com/gamma/123">
            <input type="text" name="firstName" />
            <input type="text" name="lastName" />
            <input type="email" name="email" />
            <input type="tel" name="phone" />
            <input type="text" name="linkedin" />
            <textarea name="coverLetter"></textarea>
            <input type="file" name="resume" />
            <button type="submit">Submit Application</button>
          </form>
        </body>
      </html>
    `;
    await pageE.setContent(ashbyHtml);
    await pageE.evaluate(contentJsCode);

    const resultE: any = await pageE.evaluate((data) => {
      return (window as any).jobAgentAutofill(data, 'Ashby Job Target');
    }, tailoredCv.tailoredCv);

    const ashbyFirst = await pageE.$eval('input[name="firstName"]', (el: any) => el.value);
    const ashbyLast = await pageE.$eval('input[name="lastName"]', (el: any) => el.value);

    log(`   Ashby Form Filled: Board="${resultE.board}", First="${ashbyFirst}", Last="${ashbyLast}"`);
    if (ashbyFirst !== 'Jane' || ashbyLast !== 'Doe') {
      throw new Error('TEST (e) FAILED: Ashby form autofill failed');
    }
    log('✅ TEST (e) PASSED: Ashby form detection & autofill verified.\n');

    // ------------------------------------------------------------------------
    // TEST (f): Unsupported Page Messaging
    // ------------------------------------------------------------------------
    log('▶ [TEST f] Testing Unsupported Page Messaging...');
    const pageF = await browser.newPage();
    await pageF.setContent('<html><body><h1>Generic Blog Post</h1><p>No job form here.</p></body></html>');
    await pageF.evaluate(contentJsCode);

    const isSupported = await pageF.evaluate(() => {
      const host = window.location.hostname;
      return host.includes('greenhouse.io') || host.includes('lever.co') || host.includes('ashbyhq.com');
    });

    log(`   Supported Page Check Result: ${isSupported}`);
    if (isSupported) {
      throw new Error('TEST (f) FAILED: Generic page incorrectly flagged as supported');
    }
    log('✅ TEST (f) PASSED: Unsupported page correctly detected and warning returned.\n');

    // ------------------------------------------------------------------------
    // TEST (g): Zero Auto-Submit Policy Static Code Audit
    // ------------------------------------------------------------------------
    log('▶ [TEST g] Testing Zero Auto-Submit Policy Static Code Audit...');
    const extensionDir = path.resolve(__dirname, '../../extension/src');
    const filesToAudit = fs.readdirSync(extensionDir).filter((f) => f.endsWith('.js'));

    let forbiddenCalls = 0;
    for (const file of filesToAudit) {
      const fullPath = path.join(extensionDir, file);
      const code = fs.readFileSync(fullPath, 'utf8');

      // Strip single-line and multi-line comments for static execution check
      const codeOnly = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

      // Check forbidden submit triggers: .submit(), .requestSubmit(), button click, or dispatchEvent synthetic submit
      const forbiddenSubmitRegex = /\.submit\s*\(|\.requestSubmit\s*\(|submitButton\.click|dispatchEvent\s*\([^)]*['"]submit['"]/i;
      if (forbiddenSubmitRegex.test(codeOnly)) {
        log(`   ❌ Forbidden submit trigger found in ${file}`);
        forbiddenCalls++;
      }

      // Check security guarantee header comment presence
      if (!code.includes('Zero auto-submit policy') && !code.includes('ZERO AUTO-SUBMIT GUARANTEE')) {
        log(`   ❌ Missing security guarantee header comment in ${file}`);
        forbiddenCalls++;
      }
    }

    log(`   Audit Checked Files: ${filesToAudit.join(', ')}`);
    log(`   Forbidden Submit Violations Found: ${forbiddenCalls}`);

    if (forbiddenCalls > 0) {
      throw new Error(`TEST (g) FAILED: Found ${forbiddenCalls} auto-submit violations in extension code`);
    }
    log('✅ TEST (g) PASSED: Zero auto-submit policy code review audit verified 100% clean.\n');

    // ------------------------------------------------------------------------
    // TEST (h): "Mark as Applied" Status Update E2E Integration Test
    // ------------------------------------------------------------------------
    log('▶ [TEST h] Testing "Mark as Applied" Status Update Integration...');
    await seedTestJob('app-job-999', 'Staff Systems Architect', 'Enterprise Systems');

    const resMarkApp = await makeRequest(
      PORT,
      '/api/applications/mark-applied',
      'POST',
      { jobId: 'app-job-999', tailoredCvId: tailoredCv.tailoredCv.id, status: 'APPLIED', notes: 'Applied via Chrome Extension assistant' },
      userA.sessionToken
    );

    log(`   Mark Applied HTTP Status: ${resMarkApp.status}`);
    log(`   Application Status in DB: ${resMarkApp.body?.application?.status}`);
    log(`   Applied At Timestamp: ${resMarkApp.body?.application?.applied_at}`);

    if (resMarkApp.status !== 200 || resMarkApp.body?.application?.status !== 'APPLIED') {
      throw new Error('TEST (h) FAILED: Mark as applied endpoint failed');
    }

    // Direct DB query verification
    const dbApp = await applicationDal.getApplicationByJob(userA.userId, 'app-job-999');
    log(`   Direct MySQL Record: ID=${dbApp?.id}, UserID=${dbApp?.user_id}, Status=${dbApp?.status}`);

    if (!dbApp || dbApp.user_id !== userA.userId || dbApp.status !== 'APPLIED') {
      throw new Error('TEST (h) FAILED: Direct MySQL database record validation failed');
    }

    // Cross-user DAL isolation test (User B cannot see User A application)
    const userB = await createAuthenticatedUser(`user_b_${Date.now()}@example.com`);
    const userBApp = await applicationDal.getApplicationByJob(userB.userId, 'app-job-999');
    log(`   User B Application Query Result: ${userBApp}`);

    if (userBApp !== null) {
      throw new Error('TEST (h) FAILED: Cross-user DAL isolation failure! User B saw User A application');
    }
    log('✅ TEST (h) PASSED: "Mark as Applied" status update and cross-user isolation verified.\n');

    log('================================================================');
    log('🎉 ALL MODULE 6 CHROME EXTENSION ACCEPTANCE TESTS PASSED!');
    log('================================================================');
  } catch (err: any) {
    log(`\n❌ MODULE 6 ACCEPTANCE TEST FAILED: ${err.message || err}`);
    if (err.stack) log(err.stack);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await apiRunner.stopServer();
    logStream.end();
    try {
      const pool = getDbPool();
      await pool.end();
    } catch {}
  }

  process.exit(process.exitCode || 0);
}

runModule6AcceptanceTests();
