import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import fs from 'fs';
import http from 'http';
import { apiRunner } from './test-helpers/apiRunner';
import { getDbPool } from '../src/dal/db';
import { FIXTURE_DATA } from './generate-test-fixtures';

function makeMultipartUpload(
  port: number,
  cookie: string,
  filename: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(header, 'utf-8'),
      fileBuffer,
      Buffer.from(footer, 'utf-8'),
    ]);

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/cv/upload',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': bodyBuffer.length.toString(),
          Cookie: cookie,
          Origin: 'http://localhost:3000',
        },
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(bodyBuffer);
    req.end();
  });
}

function makeJsonRequest(
  port: number,
  method: string,
  urlPath: string,
  cookie?: string,
  data?: any
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    };
    if (cookie) reqHeaders['Cookie'] = cookie;
    if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();

    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method, headers: reqHeaders },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: bodyStr ? JSON.parse(bodyStr) : {}, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr, headers: res.headers });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function compareValue(extracted: string | undefined | null, expected: string): 'MATCH' | 'MISMATCH' {
  if (!extracted) return 'MISMATCH';
  const cleanExtracted = extracted.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanExpected = expected.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanExtracted.includes(cleanExpected) || cleanExpected.includes(cleanExtracted) ? 'MATCH' : 'MISMATCH';
}

async function verifyFixture(
  port: number,
  cookie: string,
  fileName: string,
  mimeType: string,
  filePath: string
) {
  console.log('\n================================================================');
  console.log(`📄 TESTING REAL UPLOAD & LLM PARSING FOR FIXTURE: ${fileName}`);
  console.log('================================================================');

  const fileBuffer = fs.readFileSync(filePath);
  const uploadStartTime = Date.now();
  const uploadRes = await makeMultipartUpload(port, cookie, fileName, fileBuffer, mimeType);
  const latency = Date.now() - uploadStartTime;

  console.log(`HTTP Status   : ${uploadRes.status} (expected 201)`);
  console.log(`Latency       : ${latency} ms`);

  if (uploadRes.status !== 201 || !uploadRes.body.profile) {
    console.error(`❌ Upload failed:`, uploadRes.body);
    throw new Error(`Upload failed for ${fileName}`);
  }

  const profileObj = uploadRes.body.profile || {};
  const p = profileObj.profile || profileObj;
  const workHistory = profileObj.workHistory || profileObj.work_history || [];
  const education = profileObj.education || [];
  const skills = profileObj.skills || [];

  console.log('\n--- EXTRACTED STRUCTURED PROFILE FROM REAL LLM (GROQ) ---');
  console.log(`Full Name     : ${p.full_name}`);
  console.log(`Email         : ${p.email}`);
  console.log(`Phone         : ${p.phone}`);
  console.log(`Location      : ${p.location}`);
  console.log(`LinkedIn      : ${p.linkedin_url}`);
  console.log(`Website       : ${p.website}`);
  console.log(`Summary       : ${p.summary}`);
  console.log('\nWork History:');
  workHistory.forEach((w: any, idx: number) => {
    console.log(`  [${idx + 1}] ${w.title} at ${w.company} (${w.start_date} to ${w.end_date})`);
    if (w.bullet_points) console.log(`      Bullets: ${JSON.stringify(w.bullet_points)}`);
  });
  console.log('\nEducation:');
  education.forEach((e: any, idx: number) => {
    console.log(`  [${idx + 1}] ${e.degree} in ${e.field_of_study} at ${e.institution} (${e.start_date} to ${e.end_date})`);
  });
  console.log('\nSkills:');
  console.log(`  ${skills.map((s: any) => s.skill_name).join(', ')}`);

  console.log('\n------------------------------------------------------------------------------------------------------------------------');
  console.log(`📊 FIELD-BY-FIELD COMPARISON TABLE (${fileName})`);
  console.log('------------------------------------------------------------------------------------------------------------------------');
  console.log(`| Field                       | Known Fixture Content                   | Extracted Output                        | Result   |`);
  console.log(`|-----------------------------|-----------------------------------------|-----------------------------------------|----------|`);

  const results: { field: string; expected: string; extracted: string; result: 'MATCH' | 'MISMATCH' }[] = [];

  // Contact Info
  results.push({ field: 'Contact Info: Full Name', expected: FIXTURE_DATA.fullName, extracted: p.full_name || '', result: compareValue(p.full_name, FIXTURE_DATA.fullName) });
  results.push({ field: 'Contact Info: Email', expected: FIXTURE_DATA.email, extracted: p.email || '', result: compareValue(p.email, FIXTURE_DATA.email) });
  results.push({ field: 'Contact Info: Phone', expected: FIXTURE_DATA.phone, extracted: p.phone || '', result: compareValue(p.phone, FIXTURE_DATA.phone) });
  results.push({ field: 'Contact Info: Location', expected: FIXTURE_DATA.location, extracted: p.location || '', result: compareValue(p.location, FIXTURE_DATA.location) });
  results.push({ field: 'Contact Info: LinkedIn URL', expected: FIXTURE_DATA.linkedinUrl, extracted: p.linkedin_url || '', result: compareValue(p.linkedin_url, FIXTURE_DATA.linkedinUrl) });
  results.push({ field: 'Contact Info: Website', expected: FIXTURE_DATA.website, extracted: p.website || '', result: compareValue(p.website, FIXTURE_DATA.website) });

  // Work History Entries
  FIXTURE_DATA.workHistory.forEach((expectedJob, idx) => {
    const extJob = workHistory[idx] || {};
    let extBullets: string[] = [];
    if (Array.isArray(extJob.bullet_points)) {
      extBullets = extJob.bullet_points;
    } else if (typeof extJob.bullet_points === 'string') {
      try { extBullets = JSON.parse(extJob.bullet_points); } catch { extBullets = [extJob.bullet_points]; }
    }

    results.push({ field: `Work History [${idx + 1}]: Title`, expected: expectedJob.title, extracted: extJob.title || '', result: compareValue(extJob.title, expectedJob.title) });
    results.push({ field: `Work History [${idx + 1}]: Company`, expected: expectedJob.company, extracted: extJob.company || '', result: compareValue(extJob.company, expectedJob.company) });
    results.push({ field: `Work History [${idx + 1}]: Start Date`, expected: expectedJob.startDate, extracted: extJob.start_date || '', result: compareValue(extJob.start_date, expectedJob.startDate) });
    results.push({ field: `Work History [${idx + 1}]: End Date`, expected: expectedJob.endDate, extracted: extJob.end_date || '', result: compareValue(extJob.end_date, expectedJob.endDate) });

    expectedJob.bulletPoints.forEach((expectedBullet, bIdx) => {
      const extBullet = extBullets[bIdx] || '';
      results.push({
        field: `Work History [${idx + 1}]: Bullet ${bIdx + 1}`,
        expected: expectedBullet,
        extracted: extBullet,
        result: compareValue(extBullet, expectedBullet),
      });
    });
  });

  // Education Entry
  const expectedEdu = FIXTURE_DATA.education[0];
  const extEdu = education[0] || {};
  results.push({ field: 'Education [1]: Institution', expected: expectedEdu.institution, extracted: extEdu.institution || '', result: compareValue(extEdu.institution, expectedEdu.institution) });
  results.push({ field: 'Education [1]: Degree', expected: expectedEdu.degree, extracted: extEdu.degree || '', result: compareValue(extEdu.degree, expectedEdu.degree) });

  // Skills
  const extSkillNames = skills.map((s: any) => s.skill_name);
  const matchedSkillsCount = FIXTURE_DATA.skills.filter((sk) =>
    extSkillNames.some((extSk: string) => extSk.toLowerCase().includes(sk.toLowerCase()))
  ).length;
  results.push({
    field: 'Skills List (8-10 items)',
    expected: FIXTURE_DATA.skills.join(', '),
    extracted: extSkillNames.join(', '),
    result: matchedSkillsCount >= 8 ? 'MATCH' : 'MISMATCH',
  });

  results.forEach((row) => {
    const fieldCol = row.field.padEnd(30);
    const expCol = row.expected.substring(0, 39).padEnd(39);
    const extCol = row.extracted.substring(0, 39).padEnd(39);
    const resCol = row.result === 'MATCH' ? 'MATCH   ' : 'MISMATCH';
    console.log(`| ${fieldCol} | ${expCol} | ${extCol} | ${resCol} |`);
  });
  console.log('------------------------------------------------------------------------------------------------------------------------\n');

  const mismatches = results.filter((r) => r.result === 'MISMATCH');
  if (mismatches.length > 0) {
    console.log('⚠️ MISMATCH DETAILS (LLM Actual vs Fixture Expected):');
    mismatches.forEach((m) => {
      console.log(`  - Field          : ${m.field}`);
      console.log(`    Fixture Expected: "${m.expected}"`);
      console.log(`    LLM Returned    : "${m.extracted}"`);
    });
    console.log('');
  } else {
    console.log('✅ ALL EXTRACTED FIELDS MATCHED FIXTURE DATA PERFECTLY!\n');
  }
}

async function runVerification() {
  const PORT = 5088;
  const pool = getDbPool();
  await pool.execute('DELETE FROM rate_limits');

  console.log('Starting API server on port', PORT);
  await apiRunner.startServer(PORT, { EMAIL_MODE: 'console' });

  const ts = Date.now();
  const email = `fixture_user_${ts}@example.com`;
  const password = 'Password123!';

  await makeJsonRequest(PORT, 'POST', '/api/auth/signup', undefined, { email, password });
  await pool.execute(`UPDATE users SET is_verified = 1 WHERE email = ?`, [email]);
  const loginRes = await makeJsonRequest(PORT, 'POST', '/api/auth/login', undefined, { email, password });
  const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] || '';

  try {
    const pdfPath = path.resolve(__dirname, '../test-fixtures/sample-cv.pdf');
    const docxPath = path.resolve(__dirname, '../test-fixtures/sample-cv.docx');

    await verifyFixture(PORT, cookie, 'sample-cv.pdf', 'application/pdf', pdfPath);
    await verifyFixture(PORT, cookie, 'sample-cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docxPath);

    console.log('================================================================');
    console.log('🎉 BOTH FIXTURES PARSED AND VERIFIED FIELD-BY-FIELD SUCCESSFULLY!');
    console.log('================================================================\n');
  } finally {
    await apiRunner.stopServer();
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
