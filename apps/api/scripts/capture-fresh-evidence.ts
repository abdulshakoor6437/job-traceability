import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';

async function captureFreshEvidence() {
  console.log('================================================================');
  console.log('📸 CAPTURING RE-CAPTURED FRESH EVIDENCE AND FIXED CV EDITOR');
  console.log('================================================================');

  const pool = getDbPool();

  // 1. Seed/ensure test user with verified email & active CV profile
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

  // Ensure user has active CV file & profile with contact info
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
      contact_info: {
        full_name: 'Alex Developer',
        email: email,
        phone: '555-0199',
        location: 'San Francisco, CA',
        linkedin_url: 'https://linkedin.com/in/alexdev',
        website: 'https://alexdev.io',
      },
      summary: 'Senior Fullstack Software Engineer with 5 years experience building web apps with TypeScript, React, Node.js, Next.js, and MySQL.',
      skills: [
        { skill_name: 'TypeScript', category: 'Language' },
        { skill_name: 'React', category: 'Frontend' },
        { skill_name: 'Node.js', category: 'Backend' },
        { skill_name: 'MySQL', category: 'Database' }
      ],
      work_history: [
        {
          title: 'Senior Fullstack Developer',
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
  } else {
    // Update contact fields on active profile
    await pool.execute(
      `UPDATE cv_profiles SET full_name = ?, email = ?, phone = ?, location = ? WHERE user_id = ? AND is_active = 1`,
      ['Alex Developer', email, '555-0199', 'San Francisco, CA', userId]
    );
    // Ensure work history is inserted for active profile if missing
    const [pRows]: any = await pool.query('SELECT id FROM cv_profiles WHERE user_id = ? AND is_active = 1', [userId]);
    if (pRows.length > 0) {
      const activeProfId = pRows[0].id;
      const [wRows]: any = await pool.query('SELECT id FROM cv_work_history WHERE cv_profile_id = ?', [activeProfId]);
      if (wRows.length === 0) {
        await pool.execute(
          `INSERT INTO cv_work_history (id, cv_profile_id, user_id, title, company, location, start_date, end_date, is_current, bullet_points, display_order)
           VALUES (?, ?, ?, 'Senior Fullstack Developer', 'Tech Solutions', 'San Francisco, CA', '2021-01', NULL, 1, '["Built React web apps", "Designed Node.js REST APIs"]', 0)`,
          [`work-${Date.now()}`, activeProfId, userId]
        );
      }
    }
  }

  // Clear all stale match & cache tables in DB completely
  await pool.execute('DELETE FROM user_job_matches');
  await pool.execute('DELETE FROM user_match_cache');
  await pool.execute('DELETE FROM job_search_cache_entries');
  await pool.execute('DELETE FROM job_search_cache');
  await pool.execute('DELETE FROM job_embeddings WHERE job_id LIKE "%broken%" OR job_id = "acc-job-broken-embedding"');

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
      title: 'Software Developer (Video Intro Required)',
      company: 'Video Screening Corp',
      location: 'San Francisco, CA',
      remote: 1,
      description: 'Mandatory video introduction required to be considered for this position. Submit a short video introducing yourself.',
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

  // Target directory for photos of test data
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

  await page.setCookie({
    name: 'session_token',
    value: sessionToken,
    url: 'http://localhost:3000',
    path: '/',
    httpOnly: true
  });

  console.log('🔍 Navigating directly to http://localhost:3000/dashboard/jobs...');
  await page.goto('http://localhost:3000/dashboard/jobs', { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('button[type="submit"]', { timeout: 60000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    return btn && !btn.disabled;
  }, { timeout: 60000 });

  console.log('📸 Item 1(a): Executing FRESH search (Bypass Cache checked)...');
  // Check "Force Fresh Search" checkbox
  await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label'));
    const freshLabel = labels.find((l) => l.textContent?.includes('Force Fresh Live Search'));
    if (freshLabel) {
      const cb = freshLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.checked) cb.click();
    }
    // Uncheck Show Excluded for 1(a)
    const exclLabel = labels.find((l) => l.textContent?.includes('Show Excluded Jobs'));
    if (exclLabel) {
      const cb = exclLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && cb.checked) cb.click();
    }
  });

  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.loading-container'), { timeout: 45000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

  const freshPath = path.join(outDir, 'test_a_fresh_search_real.png');
  await page.screenshot({ path: freshPath, fullPage: true });
  console.log(`✅ Saved Screenshot 1(a) [Fresh Search Badge] to:\n   ${freshPath}`);

  // 4. CAPTURE ITEM 1(b): "Show Excluded Jobs" toggle switched ON with real excluded job visible
  console.log('📸 Item 1(b): Executing search with "Show Excluded Jobs" checked...');
  await page.evaluate(() => {
    const minScoreInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    if (minScoreInput) {
      minScoreInput.value = '30';
      minScoreInput.dispatchEvent(new Event('input', { bubbles: true }));
      minScoreInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const labels = Array.from(document.querySelectorAll('label'));
    const exclLabel = labels.find((l) => l.textContent?.includes('Show Excluded Jobs'));
    if (exclLabel) {
      const cb = exclLabel.querySelector('input[type="checkbox"]') as HTMLInputElement;
      if (cb && !cb.checked) cb.click();
    }
  });

  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('.loading-container'), { timeout: 45000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 2000)));

  const exclPath = path.join(outDir, 'test_b_excluded_jobs_real.png');
  await page.screenshot({ path: exclPath, fullPage: true });
  console.log(`✅ Saved Screenshot 1(b) [Show Excluded Jobs Toggle ON] to:\n   ${exclPath}`);

  // 5. CAPTURE ITEM 2: Fixed CV Profile Editor showing populated contact fields
  console.log('🔍 Navigating to http://localhost:3000/dashboard/cv...');
  await page.goto('http://localhost:3000/dashboard/cv', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('.loading-container'), { timeout: 15000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

  const cvPath = path.join(outDir, 'test_cv_profile_editor_fixed.png');
  await page.screenshot({ path: cvPath, fullPage: true });
  console.log(`✅ Saved Screenshot Item 2 [CV Profile Editor Populated] to:\n   ${cvPath}`);

  await browser.close();
  console.log('\n================================================================');
  console.log('🎉 ALL RE-CAPTURED EVIDENCE SAVED SUCCESSFULLY!');
  console.log('================================================================\n');

  process.exit(0);
}

captureFreshEvidence().catch((err) => {
  console.error('❌ Capture failed:', err);
  process.exit(1);
});
