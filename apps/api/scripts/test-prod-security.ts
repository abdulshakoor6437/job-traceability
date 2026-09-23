import http from 'http';
import { config } from '../src/config/env';

const API_HOST = '127.0.0.1';
const API_PORT = config.port;

function makeRequest(
  method: string,
  path: string,
  data?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        host: API_HOST,
        port: API_PORT,
        path,
        method,
        headers: reqHeaders,
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
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runProdSecurityTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING PRODUCTION SECURITY & ENUMERATION PREVENTION TESTS');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const newEmail = `prod_test_${timestamp}@example.com`;
  const password = 'Password123!';

  console.log('1️⃣ Testing Signup Response for New vs Duplicate Email:');
  const signup1 = await makeRequest('POST', '/api/auth/signup', { email: newEmail, password });
  console.log(`   New Email Signup Status: ${signup1.status}`);
  console.log(`   New Email Signup Message: "${signup1.body.message}"`);

  const signup2 = await makeRequest('POST', '/api/auth/signup', { email: newEmail, password });
  console.log(`   Duplicate Email Signup Status: ${signup2.status}`);
  console.log(`   Duplicate Email Signup Message: "${signup2.body.message}"`);

  if (signup1.status !== 201 || signup2.status !== 201) {
    throw new Error('SECURITY TEST FAILED: Signup status codes differ for new vs duplicate emails!');
  }
  if (signup1.body.message !== signup2.body.message) {
    throw new Error('SECURITY TEST FAILED: Signup messages differ for new vs duplicate emails!');
  }
  console.log('   ✅ Signup email enumeration prevention VERIFIED.');

  console.log('\n2️⃣ Testing Password Reset Request for Existing vs Non-existing Email:');
  const resetExisting = await makeRequest('POST', '/api/auth/request-password-reset', { email: newEmail });
  console.log(`   Existing Email Reset Status: ${resetExisting.status}`);
  console.log(`   Existing Email Reset Message: "${resetExisting.body.message}"`);

  const resetNonExisting = await makeRequest('POST', '/api/auth/request-password-reset', { email: `nonexistent_${timestamp}@example.com` });
  console.log(`   Non-existing Email Reset Status: ${resetNonExisting.status}`);
  console.log(`   Non-existing Email Reset Message: "${resetNonExisting.body.message}"`);

  if (resetExisting.status !== 200 || resetNonExisting.status !== 200) {
    throw new Error('SECURITY TEST FAILED: Password reset status codes differ for existing vs non-existing emails!');
  }
  if (resetExisting.body.message !== resetNonExisting.body.message) {
    throw new Error('SECURITY TEST FAILED: Password reset messages differ!');
  }
  console.log('   ✅ Password reset email enumeration prevention VERIFIED.');

  console.log('\n3️⃣ Verifying Token Absence in Password Reset Response:');
  if (resetExisting.body.rawToken || resetExisting.body.token || resetExisting.body.link) {
    throw new Error('SECURITY FAILURE: Password reset response contained secret tokens or links!');
  }
  console.log('   ✅ Token absence in password reset API response VERIFIED.');

  console.log('\n================================================================');
  console.log('🎉 PRODUCTION SECURITY & ENUMERATION PREVENTION TESTS PASSED!');
  console.log('================================================================\n');

  process.exit(0);
}

runProdSecurityTest().catch((err) => {
  console.error('\n❌ SECURITY TEST FAILED:', err);
  process.exit(1);
});
