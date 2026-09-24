import http from 'http';
import { apiRunner } from './test-helpers/apiRunner';

function makeTimedRequest(port: number, method: string, path: string, data?: any): Promise<{ status: number; body: any; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const start = process.hrtime.bigint();
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
        },
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          const end = process.hrtime.bigint();
          const durationMs = Number(end - start) / 1e6;
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body, durationMs });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr, durationMs });
          }
        });
      }
    );
    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

function calculatePercentiles(samples: number[]): { median: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95 = sorted[p95Index];
  return { median, p95 };
}

async function runTimingProof() {
  console.log('\n================================================================');
  console.log('⏱️ RUNNING TIMING PARITY & ANTI-ENUMERATION BENCHMARK (Item 6)');
  console.log('================================================================\n');

  const API_PORT = 5058;
  const SAMPLES = 200;

  try {
    await apiRunner.startServer(API_PORT, { EMAIL_MODE: 'console' });

    const password = 'Password123!';
    const timestamp = Date.now();
    const existingEmail = `existing_timing_${timestamp}@example.com`;

    // Create existing account baseline
    console.log('1️⃣ Creating baseline user account...');
    await makeTimedRequest(API_PORT, 'POST', '/api/auth/signup', { email: existingEmail, password });

    // Warmup requests
    await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: existingEmail });
    await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: `unknown_warmup_${timestamp}@example.com` });

    console.log(`\n2️⃣ Gathering 200 samples for Signup (New vs Existing) in alternating order...`);
    const newSignupTimings: number[] = [];
    const existingSignupTimings: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const freshEmail = `new_signup_${timestamp}_${i}@example.com`;
      if (i % 2 === 0) {
        const resNew = await makeTimedRequest(API_PORT, 'POST', '/api/auth/signup', { email: freshEmail, password });
        const resExist = await makeTimedRequest(API_PORT, 'POST', '/api/auth/signup', { email: existingEmail, password });
        newSignupTimings.push(resNew.durationMs);
        existingSignupTimings.push(resExist.durationMs);
      } else {
        const resExist = await makeTimedRequest(API_PORT, 'POST', '/api/auth/signup', { email: existingEmail, password });
        const resNew = await makeTimedRequest(API_PORT, 'POST', '/api/auth/signup', { email: freshEmail, password });
        existingSignupTimings.push(resExist.durationMs);
        newSignupTimings.push(resNew.durationMs);
      }
    }

    const newSignupStats = calculatePercentiles(newSignupTimings);
    const existSignupStats = calculatePercentiles(existingSignupTimings);

    console.log(`\n📊 SIGNUP TIMING RESULTS (${SAMPLES} samples per case):`);
    console.log(`   New Account Signup:      Median = ${newSignupStats.median.toFixed(2)} ms | p95 = ${newSignupStats.p95.toFixed(2)} ms`);
    console.log(`   Existing Account Signup: Median = ${existSignupStats.median.toFixed(2)} ms | p95 = ${existSignupStats.p95.toFixed(2)} ms`);

    const signupMedianDiff = Math.abs(newSignupStats.median - existSignupStats.median);
    const signupMaxAllowedDiff = Math.max(1.0, Math.min(newSignupStats.median, existSignupStats.median) * 0.10);
    console.log(`   Median Difference:       ${signupMedianDiff.toFixed(2)} ms (Allowed: <= ${signupMaxAllowedDiff.toFixed(2)} ms)`);

    if (signupMedianDiff > signupMaxAllowedDiff) {
      throw new Error(`Signup timing parity check failed: difference ${signupMedianDiff.toFixed(2)}ms exceeds threshold.`);
    }
    console.log('   ✅ SIGNUP TIMING PARITY VERIFIED.');

    console.log(`\n3️⃣ Gathering 200 samples for Password Reset Request (Known vs Unknown) in alternating order...`);
    const knownResetTimings: number[] = [];
    const unknownResetTimings: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const unknownEmail = `unknown_reset_${timestamp}_${i}@example.com`;
      if (i % 2 === 0) {
        const resKnown = await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: existingEmail });
        const resUnknown = await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: unknownEmail });
        knownResetTimings.push(resKnown.durationMs);
        unknownResetTimings.push(resUnknown.durationMs);
      } else {
        const resUnknown = await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: unknownEmail });
        const resKnown = await makeTimedRequest(API_PORT, 'POST', '/api/auth/request-password-reset', { email: existingEmail });
        unknownResetTimings.push(resUnknown.durationMs);
        knownResetTimings.push(resKnown.durationMs);
      }
    }

    const knownResetStats = calculatePercentiles(knownResetTimings);
    const unknownResetStats = calculatePercentiles(unknownResetTimings);

    console.log(`\n📊 PASSWORD RESET REQUEST TIMING RESULTS (${SAMPLES} samples per case):`);
    console.log(`   Known Email Reset:   Median = ${knownResetStats.median.toFixed(2)} ms | p95 = ${knownResetStats.p95.toFixed(2)} ms`);
    console.log(`   Unknown Email Reset: Median = ${unknownResetStats.median.toFixed(2)} ms | p95 = ${unknownResetStats.p95.toFixed(2)} ms`);

    const resetMedianDiff = Math.abs(knownResetStats.median - unknownResetStats.median);
    const resetMaxAllowedDiff = Math.max(1.0, Math.min(knownResetStats.median, unknownResetStats.median) * 0.10);
    console.log(`   Median Difference:   ${resetMedianDiff.toFixed(2)} ms (Allowed: <= ${resetMaxAllowedDiff.toFixed(2)} ms)`);

    if (resetMedianDiff > resetMaxAllowedDiff) {
      throw new Error(`Password reset timing parity check failed: difference ${resetMedianDiff.toFixed(2)}ms exceeds threshold.`);
    }
    console.log('   ✅ PASSWORD RESET TIMING PARITY VERIFIED.');

    await apiRunner.stopServer();

    console.log('\n================================================================');
    console.log('✅ PASS: Timing & Anti-Enumeration Proof (Item 6)');
    console.log('================================================================\n');
    process.exit(0);
  } catch (error: any) {
    await apiRunner.stopServer();
    console.error('\n❌ FAIL: Timing Benchmark Suite Failed:', error.message);
    process.exit(1);
  }
}

runTimingProof();
