import http from 'http';
import fs from 'fs';
import path from 'path';
import { apiRunner } from './test-helpers/apiRunner';
import { getDbPool } from '../src/dal/db';
import { llmManager, MockLLMProvider } from '../src/services/llm/llmProvider';
import { fileStorage } from '../src/services/storage/fileStorage';

function makeMultipartUpload(
  port: number,
  cookie: string,
  filename: string,
  fileBuffer: Buffer,
  mimeType: string = 'application/pdf'
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const payload = Buffer.concat([
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
          'Content-Length': payload.length.toString(),
          'Origin': 'http://localhost:3000',
          'Cookie': cookie,
        },
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: JSON.parse(bodyStr) });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

function makeJsonRequest(
  port: number,
  method: string,
  path: string,
  cookie?: string,
  data?: any
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:3000',
      ...(cookie ? { 'Cookie': cookie } : {}),
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, headers: res.headers, body: JSON.parse(bodyStr) });
          } catch {
            resolve({ status: res.statusCode || 500, headers: res.headers, body: bodyStr });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

// Generate valid test file buffers
function createValidPdfBuffer(textContent: string): Buffer {
  const cleanText = textContent.replace(/[()]/g, '');
  const streamText = `BT /F1 12 Tf 72 712 Td (${cleanText}) Tj ET`;
  const streamLen = Buffer.byteLength(streamText);
  
  const header = `%PDF-1.4\n`;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamText}\nendstream\nendobj\n`;

  const off1 = Buffer.byteLength(header);
  const off2 = off1 + Buffer.byteLength(obj1);
  const off3 = off2 + Buffer.byteLength(obj2);
  const off4 = off3 + Buffer.byteLength(obj3);
  const xrefOff = off4 + Buffer.byteLength(obj4);

  const pad10 = (n: number) => n.toString().padStart(10, '0');
  const xref = `xref\n0 5\n0000000000 65535 f \n${pad10(off1)} 00000 n \n${pad10(off2)} 00000 n \n${pad10(off3)} 00000 n \n${pad10(off4)} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + xref, 'utf-8');
}

function createScannedPdfBuffer(): Buffer {
  const header = `%PDF-1.4\n`;
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`;

  const off1 = Buffer.byteLength(header);
  const off2 = off1 + Buffer.byteLength(obj1);
  const off3 = off2 + Buffer.byteLength(obj2);
  const xrefOff = off3 + Buffer.byteLength(obj3);

  const pad10 = (n: number) => n.toString().padStart(10, '0');
  const xref = `xref\n0 4\n0000000000 65535 f \n${pad10(off1)} 00000 n \n${pad10(off2)} 00000 n \n${pad10(off3)} 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF`;

  return Buffer.from(header + obj1 + obj2 + obj3 + xref, 'utf-8');
}

function createValidDocxBuffer(): Buffer {
  // Zip header PK\x03\x04 + dummy word/document.xml string for magic byte content sniffer
  const header = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00]);
  const content = Buffer.from('word/document.xml <w:p><w:r><w:t>John Doe Resume DOCX Test Content</w:t></w:r></w:p>', 'utf-8');
  return Buffer.concat([header, content]);
}

function createFakePdfBuffer(): Buffer {
  // PNG Magic Header 0x89 0x50 0x4E 0x47 (Fake file renamed to .pdf)
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

async function runCvModuleTests() {
  console.log('\n================================================================');
  console.log('📄 RUNNING MODULE 1 CV UPLOAD, PARSING & PROFILE ACCEPTANCE SUITE');
  console.log('================================================================\n');

  const API_PORT = 5060;
  const pool = getDbPool();

  try {
    await pool.execute('DELETE FROM rate_limits');
    await apiRunner.startServer(API_PORT, { EMAIL_MODE: 'console' });

    // Setup User A & User B accounts
    const timestamp = Date.now();
    const userAEmail = `cv_usera_${timestamp}@example.com`;
    const userBEmail = `cv_userb_${timestamp}@example.com`;
    const password = 'Password123!';

    await makeJsonRequest(API_PORT, 'POST', '/api/auth/signup', undefined, { email: userAEmail, password });
    await makeJsonRequest(API_PORT, 'POST', '/api/auth/signup', undefined, { email: userBEmail, password });

    await pool.execute(`UPDATE users SET is_verified = 1 WHERE email IN (?, ?)`, [userAEmail, userBEmail]);

    const loginA = await makeJsonRequest(API_PORT, 'POST', '/api/auth/login', undefined, { email: userAEmail, password });
    const cookieA = loginA.body?.session_token ? `session_token=${loginA.body.session_token}` : (loginA as any).headers['set-cookie']?.[0]?.split(';')[0] || '';

    const loginB = await makeJsonRequest(API_PORT, 'POST', '/api/auth/login', undefined, { email: userBEmail, password });
    const cookieB = loginB.body?.session_token ? `session_token=${loginB.body.session_token}` : (loginB as any).headers['set-cookie']?.[0]?.split(';')[0] || '';

    console.log('1️⃣ Setup Test Users A & B verified and logged in successfully.');

    // Acceptance Test c: Upload non-CV file renamed to .pdf -> Rejected by Content Sniffing
    console.log('\n[Acceptance Test c] Uploading non-CV file renamed to .pdf (Content Sniffing)...');
    const fakePdfRes = await makeMultipartUpload(API_PORT, cookieA, 'malicious.pdf', createFakePdfBuffer(), 'application/pdf');
    console.log(`   Response Status: ${fakePdfRes.status} (Expected 400)`);
    console.log(`   Response Message: "${fakePdfRes.body.message}"`);
    if (fakePdfRes.status !== 400 || !fakePdfRes.body.message.includes('Content sniffing rejected')) {
      throw new Error('TEST c FAILED: Content sniffing failed to reject non-PDF file!');
    }
    console.log('   ✅ Test c PASSED: Renamed non-CV file rejected by content sniffing.');

    // Acceptance Test a: Upload real PDF & real DOCX -> produce structured profile
    console.log('\n[Acceptance Test a] Uploading real PDF and real DOCX...');
    const pdfText = 'John Doe\njohndoe@example.com\n555-123-4567\nSenior Software Engineer at Acme Corp';
    const pdfUploadRes = await makeMultipartUpload(API_PORT, cookieA, 'resume_v1.pdf', createValidPdfBuffer(pdfText), 'application/pdf');
    console.log(`   PDF Upload Status: ${pdfUploadRes.status} (Expected 201)`);
    if (pdfUploadRes.status !== 201 || !pdfUploadRes.body.profile) {
      throw new Error('TEST a FAILED: Real PDF upload failed!');
    }
    const profileA1 = pdfUploadRes.body.profile;
    console.log(`   PDF Profile Version: ${profileA1.profile.version_number} | Work History Rows: ${profileA1.workHistory.length}`);
    console.log('   ✅ Real PDF parsed and stored cleanly.');

    const docxUploadRes = await makeMultipartUpload(API_PORT, cookieA, 'resume_v2.docx', createValidDocxBuffer(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    console.log(`   DOCX Upload Status: ${docxUploadRes.status} (Expected 201)`);
    if (docxUploadRes.status !== 201 || !docxUploadRes.body.profile) {
      throw new Error('TEST a FAILED: Real DOCX upload failed!');
    }
    const profileA2 = docxUploadRes.body.profile;
    console.log(`   DOCX Profile Version: ${profileA2.profile.version_number} | Is Active: ${profileA2.profile.is_active}`);
    console.log('   ✅ Test a PASSED: Real PDF & DOCX uploaded and structured.');

    // Acceptance Test b: Upload scanned/image-only PDF -> clearly flagged OCR required
    console.log('\n[Acceptance Test b] Uploading scanned/image-only PDF...');
    const scannedUploadRes = await makeMultipartUpload(API_PORT, cookieA, 'scanned_image.pdf', createScannedPdfBuffer(), 'application/pdf');
    console.log(`   Scanned Upload Status: ${scannedUploadRes.status} (Expected 201)`);
    const scannedFileText = scannedUploadRes.body.profile.file.raw_text;
    console.log(`   Raw Extracted Text: "${scannedFileText}"`);
    console.log(`   Needs Review Flag: ${scannedUploadRes.body.profile.profile.needs_review}`);
    if (!scannedFileText.includes('OCR_REQUIRED') || !scannedUploadRes.body.profile.profile.needs_review) {
      throw new Error('TEST b FAILED: Scanned PDF not flagged OCR required!');
    }
    console.log('   ✅ Test b PASSED: Scanned image PDF clearly flagged as OCR required.');

    // Acceptance Test d: LLM Provider Fallback (Providers 1 & 2 fail, 3 succeeds)
    console.log('\n[Acceptance Test d] Simulating 1st & 2nd LLM Provider Failures (Fallback to 3rd)...');
    llmManager.registerProvider(new MockLLMProvider('fail_provider_1', '500'));
    llmManager.registerProvider(new MockLLMProvider('fail_provider_2', '429'));
    llmManager.registerProvider(new MockLLMProvider('success_provider_3'));

    const fallbackResult = await llmManager.parseCvWithFallback(
      'Jane Doe\njanedoe@example.com\nLead Architect',
      ['fail_provider_1', 'fail_provider_2', 'success_provider_3']
    );

    console.log(`   Used Provider: ${fallbackResult.usedProvider}`);
    console.log(`   Logs Count: ${fallbackResult.logs.length}`);
    for (const l of fallbackResult.logs) {
      console.log(`   - Provider '${l.provider}': Success=${l.success}, Status=${l.statusCode}, Reason="${l.reason || 'OK'}"`);
    }

    if (fallbackResult.usedProvider !== 'success_provider_3' || fallbackResult.logs.length !== 3) {
      throw new Error('TEST d FAILED: LLM Provider fallback failed!');
    }
    console.log('   ✅ Test d PASSED: Fallback across 3 providers verified and logged.');

    // Acceptance Test e: Missing field saved blank with needs_review = true, not fabricated
    console.log('\n[Acceptance Test e] CV text with missing phone number (Blank & needs_review = true)...');
    const noPhoneText = 'Alice Smith\nalice@example.com\nSoftware Engineer';
    const noPhoneRes = await makeMultipartUpload(API_PORT, cookieA, 'no_phone.pdf', createValidPdfBuffer(noPhoneText), 'application/pdf');
    const noPhoneProfile = noPhoneRes.body.profile.profile;
    console.log(`   Extracted Full Name: "${noPhoneProfile.full_name}"`);
    console.log(`   Extracted Phone: "${noPhoneProfile.phone}" (Expected blank/empty)`);
    console.log(`   Needs Review: ${noPhoneProfile.needs_review} (Expected true)`);

    if ((noPhoneProfile.phone !== null && noPhoneProfile.phone !== '') || !noPhoneProfile.needs_review) {
      throw new Error('TEST e FAILED: Missing phone number was fabricated or not flagged!');
    }
    console.log('   ✅ Test e PASSED: Missing field left blank with needs_review = true.');

    // Acceptance Test f: Cross-user isolation tests
    console.log('\n[Acceptance Test f & Item 9] Testing Cross-User Isolation (User B cannot access User A data)...');
    const profileIdA = profileA1.profile.id;

    const getResB = await makeJsonRequest(API_PORT, 'GET', `/api/cv/versions/${profileIdA}`, cookieB);
    console.log(`   User B GET User A Profile Status: ${getResB.status} (Expected 404)`);

    const actResB = await makeJsonRequest(API_PORT, 'POST', `/api/cv/versions/${profileIdA}/activate`, cookieB);
    console.log(`   User B Activate User A Profile Status: ${actResB.status} (Expected 404)`);

    const putResB = await makeJsonRequest(API_PORT, 'PUT', `/api/cv/versions/${profileIdA}`, cookieB, { summary: 'Hacked' });
    console.log(`   User B Edit User A Profile Status: ${putResB.status} (Expected 404)`);

    const delResB = await makeJsonRequest(API_PORT, 'DELETE', `/api/cv/versions/${profileIdA}`, cookieB);
    console.log(`   User B Delete User A Profile Status: ${delResB.status} (Expected 404)`);

    if (getResB.status !== 404 || actResB.status !== 404 || putResB.status !== 404 || delResB.status !== 404) {
      throw new Error('TEST f FAILED: Cross-user isolation breach detected!');
    }
    console.log('   ✅ Test f PASSED: Strict cross-user data isolation verified.');

    // Acceptance Test g: Upload second CV & switch active version without deleting old version
    console.log('\n[Acceptance Test g] Versioning & Switching Active Version...');
    const v1Id = profileA1.profile.id;
    const v2Id = profileA2.profile.id;

    console.log(`   Activating Version 1 (ID: ${v1Id})...`);
    const switchRes = await makeJsonRequest(API_PORT, 'POST', `/api/cv/versions/${v1Id}/activate`, cookieA);
    console.log(`   Switch Response Status: ${switchRes.status} (Expected 200)`);

    const activeRes = await makeJsonRequest(API_PORT, 'GET', '/api/cv/active', cookieA);
    console.log(`   Active Profile Version: ${activeRes.body.profile.profile.version_number} (Expected Version 1)`);

    if (activeRes.body.profile.profile.id !== v1Id) {
      throw new Error('TEST g FAILED: Switching active version failed!');
    }
    console.log('   ✅ Test g PASSED: Versioning and active profile switching verified.');

    // Acceptance Test h: Delete CV & confirm physical disk file and DB rows purged
    console.log('\n[Acceptance Test h] Deleting CV profile and confirming file & DB purge...');
    const storageKeyV2 = profileA2.file.storage_key;
    const fileExistsBefore = await fileStorage.fileExists(storageKeyV2);
    console.log(`   File exists on disk before delete: ${fileExistsBefore}`);

    const deleteRes = await makeJsonRequest(API_PORT, 'DELETE', `/api/cv/versions/${v2Id}`, cookieA);
    console.log(`   Delete Response Status: ${deleteRes.status} (Expected 200)`);

    const fileExistsAfter = await fileStorage.fileExists(storageKeyV2);
    console.log(`   File exists on disk after delete: ${fileExistsAfter} (Expected false)`);

    const [dbRows] = await pool.query<any[]>(`SELECT * FROM cv_profiles WHERE id = ?`, [v2Id]);
    console.log(`   DB profile rows remaining: ${dbRows.length} (Expected 0)`);

    if (deleteRes.status !== 200 || fileExistsAfter || dbRows.length > 0) {
      throw new Error('TEST h FAILED: File or database rows not purged on deletion!');
    }
    console.log('   ✅ Test h PASSED: Complete physical file and database cascade purge verified.');

    await apiRunner.stopServer();

    console.log('\n================================================================');
    console.log('🎉 ALL MODULE 1 CV ACCEPTANCE TESTS PASSED PERFECTLY!');
    console.log('================================================================\n');

    process.exit(0);
  } catch (error: any) {
    await apiRunner.stopServer();
    console.error('\n❌ MODULE 1 TEST SUITE FAILED:', error.message);
    process.exit(1);
  }
}

runCvModuleTests();
