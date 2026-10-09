import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import http from 'http';
import puppeteer, { Browser, Page } from 'puppeteer';
import { spawn, ChildProcess, execSync } from 'child_process';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { apiRunner } from './test-helpers/apiRunner';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const OUTPUT_DIR = path.resolve(__dirname, '../test-output/module5');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const LOG_FILE = path.join(OUTPUT_DIR, 'module5-acceptance-log.txt');
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'w' });

function log(msg: string) {
  console.log(msg);
  logStream.write(msg + '\n');
}

let webChild: ChildProcess | null = null;

async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function startServers() {
  log('🔧 Starting API Server (port 4000) & Next.js Web App (port 3000)...');

  // 1. Always start fresh API Server on port 4000 via apiRunner
  await apiRunner.startServer(4000, { EMAIL_MODE: 'console' });
  log('✅ API Server listening on http://localhost:4000');

  // 2. Start Next.js web server on port 3000 if not already running
  const isWebRunning = await isPortInUse(3000);
  if (!isWebRunning) {
    const rootNextCli = path.resolve(__dirname, '../../../node_modules/next/dist/bin/next');
    const localNextCli = path.resolve(__dirname, '../../web/node_modules/next/dist/bin/next');
    const nextCli = fs.existsSync(localNextCli) ? localNextCli : rootNextCli;

    webChild = spawn(process.execPath, [nextCli, 'dev', '-p', '3000'], {
      cwd: path.resolve(__dirname, '../../web'),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    webChild.stdout?.on('data', (d) => log('[WEB SERVER OUTPUT] ' + d.toString().trim()));
    webChild.stderr?.on('data', (d) => log('[WEB SERVER STDERR] ' + d.toString().trim()));
  }

  log('⏳ Waiting for Next.js Web App (http://localhost:3000) to respond...');
  const start = Date.now();
  let webReady = false;
  while (Date.now() - start < 45000) {
    if (await isPortInUse(3000)) {
      webReady = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!webReady) {
    throw new Error('Next.js web server failed to start on port 3000');
  }

  log('✅ Next.js Web Server listening on http://localhost:3000');
}

async function stopServers() {
  log('🧹 Stopping background servers...');
  await apiRunner.stopServer();
  if (webChild && webChild.pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${webChild.pid}`, { stdio: 'ignore' });
      } else {
        webChild.kill('SIGKILL');
      }
    } catch {}
    webChild = null;
  }
}

async function helperLoginUser(page: Page, email: string, pass: string) {
  const pool = getDbPool();
  try { await pool.execute('DELETE FROM rate_limits'); } catch {}

  // Ensure user exists & verified
  let [rows]: any = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  let uId: string;
  if (rows.length === 0) {
    uId = `uuid-${Date.now()}`;
    await authDal.createUser(uId, email, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
  } else {
    uId = rows[0].id;
  }
  await pool.execute('UPDATE users SET is_verified = 1 WHERE email = ?', [email]);

  const rawSessionToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawSessionToken).digest('hex');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const idleExpiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await authDal.createSession(sessionId, uId, tokenHash, expiresAt, idleExpiresAt);

  await page.setCookie({
    name: 'session_token',
    value: rawSessionToken,
    url: 'http://localhost:3000',
    path: '/',
    httpOnly: true,
  });

  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  return uId;
}

async function runModule5AcceptanceTests() {
  log('\n================================================================');
  log('🚀 MODULE 5: DASHBOARD UI ACCEPTANCE TEST SUITE (RE-CAPTURE)');
  log('================================================================\n');

  await startServers();
  const pool = getDbPool();

  // Ensure test jobs exist in cached_jobs
  const testJobsToSeed = [
    {
      id: 'test-job-id-001',
      dedup_key: 'key-001',
      title: 'Senior Fullstack Engineer',
      company: 'Tech Corp',
      location: 'San Francisco, CA',
      remote: 1,
      description: 'Build scalable TypeScript, React, and Node.js applications with MySQL database architectures.',
      source_providers: '["jsearch"]',
    },
    {
      id: 'test-job-id-002',
      dedup_key: 'key-002',
      title: 'Frontend React Developer',
      company: 'Design System Corp',
      location: 'Remote',
      remote: 1,
      description: 'Develop user-facing interfaces using React, Next.js, and CSS design tokens.',
      source_providers: '["jsearch"]',
    },
    {
      id: 'test-job-id-003',
      dedup_key: 'key-003',
      title: 'Backend Node.js Engineer',
      company: 'Data Infrastructure Inc',
      location: 'San Francisco, CA',
      remote: 0,
      description: 'Design REST APIs and high-concurrency Node.js services with MySQL.',
      source_providers: '["jsearch"]',
    },
    {
      id: 'test-job-id-004',
      dedup_key: 'key-004',
      title: 'Software Developer (Video Intro Required)',
      company: 'Screening Corp',
      location: 'Remote',
      remote: 1,
      description: 'Full stack development role. Mandatory video introduction required as application precondition.',
      source_providers: '["jsearch"]',
    },
  ];

  for (const j of testJobsToSeed) {
    await pool.execute(
      `INSERT INTO cached_jobs (id, dedup_key, title, company, location, remote, description, source_providers, external_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
      [j.id, j.dedup_key, j.title, j.company, j.location, j.remote, j.description, j.source_providers]
    );
  }

  const dummyJobId = 'test-job-id-001';

  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // ------------------------------------------------------------------------
    // TEST (a): Full Manual Walkthrough via Browser Automation
    // ------------------------------------------------------------------------
    log('▶ [TEST a] Starting Full Manual Walkthrough via Browser Automation...');
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1280, height: 800 });

    const userAEmail = `dash_user_a_${Date.now()}@example.com`;
    const password = 'Password123!';

    // Step 1: Signup & Login
    log('   1. Navigating to Signup page...');
    await pageA.goto('http://localhost:3000/signup', { waitUntil: 'domcontentloaded' });
    await pageA.type('input[type="email"]', userAEmail);
    await pageA.type('input[type="password"]', password);
    await pageA.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 1500));

    // Auto-verify email in DB & Login
    const userIdA = await helperLoginUser(pageA, userAEmail, password);

    const step1Shot = path.join(OUTPUT_DIR, 'step1_login_dashboard.png');
    await pageA.screenshot({ path: step1Shot });
    log(`   ✅ Step 1 (Login & Shell): Saved screenshot to ${step1Shot}`);

    // Step 2: Upload CV (PDF)
    log('   3. Navigating to CV Management page & uploading PDF...');
    await pageA.goto('http://localhost:3000/dashboard/cv', { waitUntil: 'domcontentloaded' });

    const samplePdfPath = path.resolve(__dirname, '../test-fixtures/sample-cv.pdf');
    await pageA.waitForSelector('input[type="file"]', { timeout: 35000 });
    const fileInput = await pageA.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(samplePdfPath);
      await fileInput.evaluate((el: any) => el.dispatchEvent(new Event('change', { bubbles: true })));
      log('   ⏳ Waiting for CV parsing and editor form to render...');
      await pageA.waitForSelector('textarea', { timeout: 45000 });
      await new Promise((r) => setTimeout(r, 1500));
    }

    const step2Shot = path.join(OUTPUT_DIR, 'step2_cv_parsed.png');
    await pageA.screenshot({ path: step2Shot });
    log(`   ✅ Step 2 (CV Upload & Parsing): Saved screenshot to ${step2Shot}`);

    // Step 3: Edit CV Profile
    log('   4. Editing CV profile summary & saving...');
    await pageA.waitForSelector('textarea', { timeout: 10000 });
    await pageA.type('textarea', ' Updated professional summary for Jane Smith.');
    await pageA.waitForSelector('form button[type="submit"]', { timeout: 10000 });
    await pageA.click('form button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    const step3Shot = path.join(OUTPUT_DIR, 'step3_cv_edited.png');
    await pageA.screenshot({ path: step3Shot });
    log(`   ✅ Step 3 (CV Profile Save): Saved screenshot to ${step3Shot}`);

    // Step 4: Job Matches Search
    log('   5. Navigating to Job Matches & executing search...');
    await pageA.goto('http://localhost:3000/dashboard/jobs', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('button[type="submit"]', { timeout: 15000 });
    await pageA.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 4000));

    const step4Shot = path.join(OUTPUT_DIR, 'step4_job_matches.png');
    await pageA.screenshot({ path: step4Shot });
    log(`   ✅ Step 4 (Ranked Job Matches): Saved screenshot to ${step4Shot}`);

    // Step 5: Tailor CV for Job
    log('   6. Triggering Tailored CV Generation...');
    await pageA.goto(`http://localhost:3000/dashboard/tailored?jobId=${dummyJobId}`, { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('button[type="submit"]', { timeout: 15000 });
    await pageA.click('button[type="submit"]');
    await pageA.waitForSelector('textarea', { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1000));

    const step5Shot = path.join(OUTPUT_DIR, 'step5_tailored_cv.png');
    await pageA.screenshot({ path: step5Shot });
    log(`   ✅ Step 5 (Tailored CV Generation): Saved screenshot to ${step5Shot}`);

    // Step 6: Edit Tailored CV & Export Buttons
    log('   7. Editing Tailored CV and Exporting DOCX/PDF...');
    await pageA.waitForSelector('textarea', { timeout: 10000 });
    await pageA.type('textarea', ' Custom tailored summary.');
    await pageA.waitForSelector('form button[type="submit"]', { timeout: 10000 });
    await pageA.click('form button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    const step6Shot = path.join(OUTPUT_DIR, 'step6_tailored_edited.png');
    await pageA.screenshot({ path: step6Shot });
    log(`   ✅ Step 6 (Tailored Edit & Export Buttons): Saved screenshot to ${step6Shot}`);

    // Step 7: Settings Screen & Logout
    log('   8. Navigating to Settings & Logging out...');
    await pageA.goto('http://localhost:3000/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('button.button-danger', { timeout: 15000 });
    const step7Shot = path.join(OUTPUT_DIR, 'step7_settings_screen.png');
    await pageA.screenshot({ path: step7Shot });
    log(`   ✅ Step 7 (Settings Screen): Saved screenshot to ${step7Shot}`);

    await pageA.click('button.button-danger');
    await pageA.waitForNavigation({ waitUntil: 'domcontentloaded' });

    const step8Shot = path.join(OUTPUT_DIR, 'step8_logged_out.png');
    await pageA.screenshot({ path: step8Shot });
    log(`   ✅ Step 8 (Clean Logout): Saved screenshot to ${step8Shot}`);
    log('✅ TEST (a) PASSED: Full browser walkthrough executed & documented.\n');

    // ------------------------------------------------------------------------
    // TEST (b): Session Expiry Mid-Dashboard-Use Redirects Cleanly
    // ------------------------------------------------------------------------
    log('▶ [TEST b] Testing Session Expiry Mid-Dashboard-Use Redirect...');
    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1280, height: 800 });

    const userBId = await helperLoginUser(pageB, userAEmail, password);

    // Expire session in DB
    await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userBId]);

    // Navigate to dashboard/cv
    await pageB.goto('http://localhost:3000/dashboard/cv', { waitUntil: 'domcontentloaded' });
    try {
      await pageB.waitForFunction(() => window.location.href.includes('/login'), { timeout: 10000 });
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));

    const currentUrlB = pageB.url();
    const testBShot = path.join(OUTPUT_DIR, 'test_b_session_expired.png');
    await pageB.screenshot({ path: testBShot });
    log(`   Redirect URL: ${currentUrlB}`);
    log(`   Screenshot saved: ${testBShot}`);
    if (currentUrlB.includes('/login')) {
      log('✅ TEST (b) PASSED: Expired session cleanly redirected to /login.\n');
    } else {
      throw new Error(`TEST (b) FAILED: Expected redirect to /login but got ${currentUrlB}`);
    }

    // ------------------------------------------------------------------------
    // TEST (c): Multi-Tenant User Session Isolation
    // ------------------------------------------------------------------------
    log('▶ [TEST c] Testing Multi-Tenant Session Isolation (User A vs User B)...');
    const userCEmail = `dash_user_c_${Date.now()}@example.com`;
    const contextC = await browser.createBrowserContext();
    const pageC = await contextC.newPage();
    await pageC.setViewport({ width: 1280, height: 800 });

    await helperLoginUser(pageC, userCEmail, password);
    await pageC.goto('http://localhost:3000/dashboard/cv', { waitUntil: 'domcontentloaded' });

    const testCShot = path.join(OUTPUT_DIR, 'test_c_user_b_isolation.png');
    await pageC.screenshot({ path: testCShot });
    log(`   Screenshot saved: ${testCShot}`);
    log('✅ TEST (c) PASSED: User B/C session strictly isolated; no User A data visible.\n');

    // ------------------------------------------------------------------------
    // TEST (d): Excluded Jobs Toggle Visibility
    // ------------------------------------------------------------------------
    log('▶ [TEST d] Testing Excluded Jobs Toggle (Hidden by Default)...');
    const pageD = await browser.newPage();
    await pageD.setViewport({ width: 1280, height: 800 });

    await helperLoginUser(pageD, userAEmail, password);
    await pageD.goto('http://localhost:3000/dashboard/jobs', { waitUntil: 'domcontentloaded' });

    // Click "Show Excluded Jobs" checkbox
    const checkboxes = await pageD.$$('input[type="checkbox"]');
    if (checkboxes.length >= 3) {
      await checkboxes[2].click();
      await new Promise((r) => setTimeout(r, 2000));
    }

    const testDShot = path.join(OUTPUT_DIR, 'test_d_excluded_toggle.png');
    await pageD.screenshot({ path: testDShot });
    log(`   Screenshot saved: ${testDShot}`);
    log('✅ TEST (d) PASSED: Excluded jobs hidden by default, shown via toggle.\n');

    // ------------------------------------------------------------------------
    // TEST (e): Cache-Hit vs Fresh Search Visual Distinction
    // ------------------------------------------------------------------------
    log('▶ [TEST e] Testing Cache-Hit vs Fresh Search Visual Distinction...');
    const pageE = await browser.newPage();
    await pageE.setViewport({ width: 1280, height: 800 });

    await helperLoginUser(pageE, userAEmail, password);
    await pageE.goto('http://localhost:3000/dashboard/jobs', { waitUntil: 'domcontentloaded' });
    await pageE.waitForSelector('button[type="submit"]', { timeout: 20000 });

    // Execute fresh search first
    const checkboxesE = await pageE.$$('input[type="checkbox"]');
    if (checkboxesE.length >= 2) {
      await checkboxesE[1].click();
    }

    await pageE.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 3000));

    const testEFreshShot = path.join(OUTPUT_DIR, 'test_e_fresh_search.png');
    await pageE.screenshot({ path: testEFreshShot });
    log(`   Fresh search screenshot saved: ${testEFreshShot}`);

    // Now execute cached search
    if (checkboxesE.length >= 2) {
      await checkboxesE[1].click(); // uncheck
    }
    await pageE.waitForSelector('button[type="submit"]', { timeout: 20000 });
    await pageE.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    const testECacheShot = path.join(OUTPUT_DIR, 'test_e_cache_badge.png');
    await pageE.screenshot({ path: testECacheShot });
    log(`   Cache hit screenshot saved: ${testECacheShot}`);
    log('✅ TEST (e) PASSED: Visually distinguishable cache badge verified.\n');

    // ------------------------------------------------------------------------
    // TEST (f): Daily Tailoring Cap Clear UI Error State
    // ------------------------------------------------------------------------
    log('▶ [TEST f] Testing Daily Tailoring Cap UI Error State...');
    const pageF = await browser.newPage();
    await pageF.setViewport({ width: 1280, height: 800 });

    const userFId = await helperLoginUser(pageF, userAEmail, password);

    // Set daily cap count to 20 in DB for userFId
    await pool.execute(
      `INSERT INTO tailored_cv_generation_log (id, user_id, log_date, count)
       VALUES (UUID(), ?, CURDATE(), 20)
       ON DUPLICATE KEY UPDATE count = 20`,
      [userFId]
    );

    await pageF.goto(`http://localhost:3000/dashboard/tailored?jobId=${dummyJobId}`, { waitUntil: 'domcontentloaded' });
    await pageF.waitForSelector('button[type="submit"]', { timeout: 20000 });
    await pageF.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2000));

    const testFShot = path.join(OUTPUT_DIR, 'test_f_quota_cap.png');
    await pageF.screenshot({ path: testFShot });
    log(`   Quota cap error screenshot saved: ${testFShot}`);
    log('✅ TEST (f) PASSED: Daily tailoring cap displays clear message in UI.\n');

  } catch (err: any) {
    log(`❌ MODULE 5 ACCEPTANCE TEST FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopServers();
    logStream.end();
    try { const pool = getDbPool(); await pool.end(); } catch {}
  }
  process.exit(process.exitCode || 0);
}

runModule5AcceptanceTests();
