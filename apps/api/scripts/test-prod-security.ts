import http from 'http';
import { apiRunner } from './test-helpers/apiRunner';

function makeRequest(
  port: number,
  method: string,
  path: string,
  data?: any,
  appUrl: string = 'http://localhost:3000'
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': appUrl,
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

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
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr, headers: res.headers });
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

function assertNoSecretsInResponse(res: { status: number; body: any; headers: any }, contextLabel: string) {
  const jsonStr = JSON.stringify(res.body);
  const headerStr = JSON.stringify(res.headers);

  if (res.body.rawToken || res.body.token || res.body.link || res.body.verificationUrl || res.body.resetUrl) {
    throw new Error(`SECURITY FAILURE [${contextLabel}]: Response body contained token/link keys! Body: ${jsonStr}`);
  }

  // 64-char hex token regex check
  const hex64Regex = /\b[a-f0-9]{64}\b/i;
  if (hex64Regex.test(jsonStr) || hex64Regex.test(headerStr)) {
    throw new Error(`SECURITY FAILURE [${contextLabel}]: Response body or header contained a 64-character raw token hex string!`);
  }

  if (jsonStr.includes('http://') || jsonStr.includes('https://') || jsonStr.includes('/verify-email') || jsonStr.includes('/reset-password')) {
    throw new Error(`SECURITY FAILURE [${contextLabel}]: Response body contained a verification/reset link!`);
  }
}

async function runProdSecurityTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING PRODUCTION SECURITY & TOKEN ABSENCE PROOF');
  console.log('================================================================\n');

  const timestamp = Date.now();
  const password = 'Password123!';

  const environments = [
    {
      name: 'Development + Console Mode',
      port: 4101,
      env: {
        NODE_ENV: 'development',
        EMAIL_MODE: 'console',
        APP_URL: 'http://localhost:3000',
        API_URL: 'http://localhost:4101',
      },
    },
    {
      name: 'Development + SMTP Mode',
      port: 4102,
      env: {
        NODE_ENV: 'development',
        EMAIL_MODE: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        APP_URL: 'http://localhost:3000',
        API_URL: 'http://localhost:4102',
      },
    },
    {
      name: 'Production + SMTP Mode',
      port: 4103,
      env: {
        NODE_ENV: 'production',
        EMAIL_MODE: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_SECURE: 'false',
        SMTP_USER: 'prod_test_smtp_user',
        SMTP_PASSWORD: 'prod_test_smtp_password',
        DB_PASSWORD: process.env.DB_PASSWORD || 'DevJobAgentSecPass2026x99',
        APP_URL: 'https://staging.jobassistant.com',
        API_URL: 'https://staging-api.jobassistant.com',
        EMAIL_FROM: 'Job Agent <no-reply@staging.jobassistant.com>',
      },
    },
  ];

  for (const targetEnv of environments) {
    console.log(`▶ Testing Environment: ${targetEnv.name}...`);
    await apiRunner.startServer(targetEnv.port, targetEnv.env);

    const email = `token_absence_${targetEnv.port}_${timestamp}@example.com`;

    // 1. Signup
    const resSignup = await makeRequest(targetEnv.port, 'POST', '/api/auth/signup', { email, password }, targetEnv.env.APP_URL);
    assertNoSecretsInResponse(resSignup, `${targetEnv.name} - Signup`);
    console.log(`   [Signup]              Status: ${resSignup.status} | Token/Link Absent: YES`);

    // 2. Resend Verification
    const resResend = await makeRequest(targetEnv.port, 'POST', '/api/auth/resend-verification', { email }, targetEnv.env.APP_URL);
    assertNoSecretsInResponse(resResend, `${targetEnv.name} - Resend Verification`);
    console.log(`   [Resend Verification] Status: ${resResend.status} | Token/Link Absent: YES`);

    // 3. Request Password Reset
    const resReset = await makeRequest(targetEnv.port, 'POST', '/api/auth/request-password-reset', { email }, targetEnv.env.APP_URL);
    assertNoSecretsInResponse(resReset, `${targetEnv.name} - Request Password Reset`);
    console.log(`   [Request Reset]       Status: ${resReset.status} | Token/Link Absent: YES`);

    await apiRunner.stopServer();
    console.log(`   ✅ ${targetEnv.name} VERIFIED CLEAN: No tokens or links returned in any response.\n`);
  }

  console.log('================================================================');
  console.log('🎉 ALL PRODUCTION SECURITY & TOKEN ABSENCE TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runProdSecurityTest().catch(async (err) => {
  console.error('\n❌ SECURITY TEST FAILED:', err);
  await apiRunner.stopServer();
  process.exit(1);
});
