import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';

async function captureRealDashboardEvidence() {
  console.log('================================================================');
  console.log('📸 CAPTURING REAL DASHBOARD EVIDENCE WITH LIVE GEMINI EMBEDDINGS');
  console.log('================================================================');

  const pool = getDbPool();

  // 1. Seed/ensure a test user in DB with verified email & active CV profile
  const email = 'real_dashboard_user@example.com';
  const password = 'Password123!';
  const bcryptHash = '$2a$10$HC5J4hpHPYOQ1EAQ20Q72e5xVMf37NV1ThQ/sA.lYYQzng1xLw9lS';

  let [rows]: any = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  let userId: string;
  if (rows.length === 0) {
    userId = `user-dash-real-${Date.now()}`;
    await authDal.createUser(userId, email, bcryptHash);
    await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [userId]);
  } else {
    userId = rows[0].id;
    await pool.query('UPDATE users SET password_hash = ?, is_verified = 1 WHERE id = ?', [bcryptHash, userId]);
  }

  // Ensure user has active CV file & profile
  const [cvRows]: any = await pool.query('SELECT id FROM cv_profiles WHERE user_id = ? AND is_active = 1', [userId]);
  if (cvRows.length === 0) {
    const cvFile = await cvDal.createCvFile(
      userId,
      'alex_developer_resume.pdf',
      `uploads/${userId}/alex_developer_resume.pdf`,
      'application/pdf',
      2048,
      'Alex Developer - Senior Fullstack Software Engineer with 5 years experience in TypeScript, React, Node.js, Next.js, and MySQL.'
    );

    await cvDal.createCvProfile(userId, cvFile.id, {
      full_name: 'Alex Developer',
      email: email,
      phone: '555-0199',
      location: 'San Francisco, CA',
      linkedin_url: 'https://linkedin.com/in/alexdev',
      website: 'https://alexdev.io',
      summary: 'Senior Fullstack Software Engineer with 5 years experience building web apps with TypeScript, React, Node.js, Next.js, and MySQL.',
      skills: [
        { skill_name: 'TypeScript', category: 'Language' },
        { skill_name: 'React', category: 'Frontend' },
        { skill_name: 'Node.js', category: 'Backend' },
        { skill_name: 'MySQL', category: 'Database' }
      ],
      work_experience: [
        {
          job_title: 'Senior Fullstack Developer',
          company: 'Tech Solutions',
          start_date: '2021-01',
          end_date: null,
          is_current: 1,
          location: 'San Francisco, CA',
          description: 'Building TypeScript web apps with React and Node.js microservices.',
          bullet_points: ['Built React web apps', 'Designed Node.js REST APIs']
        }
      ],
      education: [],
      projects: [],
      certifications: []
    } as any, false);
  }

  // Ensure test jobs exist in cached_jobs
  const testJobs = [
    {
      id: 'job-real-dash-001',
      dedup_key: 'dedup-real-dash-001',
      title: 'Senior TypeScript & React Fullstack Engineer',
      company: 'Acme Software',
      location: 'San Francisco, CA',
      remote: 1,
      description: 'We are looking for a Senior Fullstack Engineer skilled in TypeScript, React, Node.js, and MySQL to join our engineering team.',
      source_providers: '["jsearch"]'
    },
    {
      id: 'job-real-dash-002',
      dedup_key: 'dedup-real-dash-002',
      title: 'Frontend Developer (React & Next.js)',
      company: 'Design System Corp',
      location: 'Remote',
      remote: 1,
      description: 'Join our team as a Frontend Developer building sleek interfaces in React, Next.js, and CSS design tokens.',
      source_providers: '["jsearch"]'
    },
    {
      id: 'job-real-dash-excl',
      dedup_key: 'dedup-real-dash-excl',
      title: 'Senior Staff Principal Systems Architect',
      company: 'Enterprise Infrastructure Inc',
      location: 'San Francisco, CA',
      remote: 1,
      description: 'Principal Senior Staff Architect role requiring mandatory video introduction submitted before application review.',
      source_providers: '["jsearch"]'
    }
  ];

  for (const j of testJobs) {
    await pool.execute(
      `INSERT INTO cached_jobs (id, dedup_key, title, company, location, remote, description, source_providers, external_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
      [j.id, j.dedup_key, j.title, j.company, j.location, j.remote, j.description, j.source_providers]
    );
  }

  // 2. Perform direct API login to get session cookie
  console.log('🔑 Performing direct API login...');
  const loginRes = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000'
    },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Direct API login failed: ${loginRes.status} ${errText}`);
  }

  const setCookieHeader = loginRes.headers.get('set-cookie');
  let sessionToken = '';
  if (setCookieHeader) {
    const match = setCookieHeader.match(/session_token=([^;]+)/);
    if (match) sessionToken = match[1];
  }

  if (!sessionToken) {
    throw new Error('Could not extract session_token cookie from login response');
  }

  // Setup output directory
  const outDir = path.resolve(__dirname, '../test-output/module5/real_screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('🌐 Launching headless browser with Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1280, height: 960 }
  });

  const page = await browser.newPage();

  // Set session_token cookie on localhost
  await page.setCookie({
    name: 'session_token',
    value: sessionToken,
    domain: 'localhost',
    path: '/',
    httpOnly: true
  });

  // 3. Navigate directly to http://localhost:3000/dashboard/jobs
  console.log('🔍 Navigating to http://localhost:3000/dashboard/jobs...');
  await page.goto('http://localhost:3000/dashboard/jobs', { waitUntil: 'domcontentloaded' });

  // Wait for initial search loading spinner to finish
  await page.waitForFunction(() => !document.querySelector('.loading-container'), { timeout: 45000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

  // 4. Test (d): Toggle "Show Excluded Jobs" with real excluded job in results
  console.log('📸 Test (d): Performing search with "Show Excluded Jobs" checked...');

  // Set minScore to 30 via range input
  await page.evaluate(() => {
    const minScoreInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    if (minScoreInput) {
      minScoreInput.value = '30';
      minScoreInput.dispatchEvent(new Event('input', { bubbles: true }));
      minScoreInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Check "Show Excluded Jobs" checkbox
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const exclLabel = labels.find((l) => l.textContent?.includes('Show Excluded Jobs'));
    if (exclLabel) {
      const cb = exclLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.checked) {
        cb.click();
      }
    }
  });

  // Ensure "Force Fresh Search" is checked for initial fresh search
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const freshLabel = labels.find((l) => l.textContent?.includes('Force Fresh Live Search'));
    if (freshLabel) {
      const cb = freshLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.checked) {
        cb.click();
      }
    }
  });

  // Click Execute Job Match Search button
  console.log('Clicking "Execute Job Match Search" (Fresh Search + Show Excluded Jobs)...');
  await page.click('button[type="submit"]');

  // Wait for loading to finish
  await page.waitForFunction(() => !document.querySelector('.loading-container'), { timeout: 45000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

  const screenshotDPath = path.join(outDir, 'test_d_excluded_jobs_toggle_real.png');
  await page.screenshot({ path: screenshotDPath, fullPage: true });
  console.log(`✅ Saved Test (d) screenshot to:\n   ${screenshotDPath}`);

  // 5. Test (e): Capture Cache Hit vs Fresh Search distinction with real matches in both states
  // Fresh Search screenshot
  const screenshotEFreshPath = path.join(outDir, 'test_e_fresh_search_real.png');
  await page.screenshot({ path: screenshotEFreshPath, fullPage: true });
  console.log(`✅ Saved Test (e) Fresh Search screenshot to:\n   ${screenshotEFreshPath}`);

  // Now uncheck Force Fresh Search and click Search Job Matches again to get Cache Hit
  console.log('Clicking "Execute Job Match Search" again with Force Fresh Search UNCHECKED for Cache Hit...');
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const freshLabel = labels.find((l) => l.textContent?.includes('Force Fresh Live Search'));
    if (freshLabel) {
      const cb = freshLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && cb.checked) {
        cb.click();
      }
    }
  });

  await page.click('button[type="submit"]');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2500)));

  const screenshotECachePath = path.join(outDir, 'test_e_cache_hit_real.png');
  await page.screenshot({ path: screenshotECachePath, fullPage: true });
  console.log(`✅ Saved Test (e) Cache Hit screenshot to:\n   ${screenshotECachePath}`);

  await browser.close();
  console.log('\n================================================================');
  console.log('🎉 REAL EVIDENCE CAPTURE COMPLETE!');
  console.log('================================================================\n');

  process.exit(0);
}

captureRealDashboardEvidence().catch((err) => {
  console.error('❌ Evidence capture failed:', err);
  process.exit(1);
});
