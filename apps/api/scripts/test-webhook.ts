import http from 'http';
import { apiRunner } from './test-helpers/apiRunner';

async function makeRequest(port: number, headers: Record<string, string>, bodyObj: any): Promise<{ statusCode: number; data: any }> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(bodyObj);
    const req = http.request(
      `http://127.0.0.1:${port}/api/webhooks/email-suppression`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = body ? JSON.parse(body) : {};
            resolve({ statusCode: res.statusCode || 500, data: parsed });
          } catch {
            resolve({ statusCode: res.statusCode || 500, data: body });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

async function runWebhookTests() {
  console.log('================================================================');
  console.log('🔒 RUNNING WEBHOOK SECURITY TEST SUITE (Item 3)');
  console.log('================================================================');

  const PORT = 5055;

  try {
    // 1. Test unconfigured WEBHOOK_SECRET -> expect 404
    console.log('\n[1] Testing unconfigured WEBHOOK_SECRET...');
    await apiRunner.startServer(PORT, { WEBHOOK_SECRET: '' });

    const resUnconfigured = await makeRequest(PORT, {}, { email: 'test@example.com' });
    console.log(`    Status Code: ${resUnconfigured.statusCode}`);
    if (resUnconfigured.statusCode !== 404) {
      throw new Error(`Expected 404 when WEBHOOK_SECRET is unconfigured, got ${resUnconfigured.statusCode}`);
    }
    console.log('    ✅ Correctly returned 404 for unconfigured webhook secret.');

    await apiRunner.stopServer();

    // 2. Test configured WEBHOOK_SECRET
    console.log('\n[2] Testing configured WEBHOOK_SECRET...');
    const SECRET = 'test-secret-webhook-key-999';
    await apiRunner.startServer(PORT, { WEBHOOK_SECRET: SECRET });

    // 2a. Missing secret header -> expect 401
    console.log('  [2a] Sending request with missing secret header...');
    const resMissing = await makeRequest(PORT, {}, { email: 'test@example.com' });
    console.log(`      Status Code: ${resMissing.statusCode}`);
    if (resMissing.statusCode !== 401) {
      throw new Error(`Expected 401 when secret is missing, got ${resMissing.statusCode}`);
    }
    console.log('      ✅ Correctly rejected missing secret with 401.');

    // 2b. Wrong secret header -> expect 401
    console.log('  [2b] Sending request with wrong secret header...');
    const resWrong = await makeRequest(PORT, { 'x-webhook-secret': 'invalid-secret-key' }, { email: 'test@example.com' });
    console.log(`      Status Code: ${resWrong.statusCode}`);
    if (resWrong.statusCode !== 401) {
      throw new Error(`Expected 401 when secret is invalid, got ${resWrong.statusCode}`);
    }
    console.log('      ✅ Correctly rejected invalid secret with 401.');

    // 2c. Correct secret header -> expect 200
    console.log('  [2c] Sending request with correct secret header...');
    const resCorrect = await makeRequest(PORT, { 'x-webhook-secret': SECRET }, { email: 'test@example.com', reason: 'bounce' });
    console.log(`      Status Code: ${resCorrect.statusCode}`);
    if (resCorrect.statusCode !== 200) {
      throw new Error(`Expected 200 when secret is correct, got ${resCorrect.statusCode}`);
    }
    console.log('      ✅ Correctly accepted valid secret with 200.');

    await apiRunner.stopServer();

    console.log('\n================================================================');
    console.log('✅ PASS: Webhook Endpoint Security & Verification');
    console.log('================================================================\n');
  } catch (error: any) {
    await apiRunner.stopServer();
    console.error('\n❌ FAIL: Webhook Security Test Suite Failed:', error.message);
    process.exit(1);
  }
}

runWebhookTests();
