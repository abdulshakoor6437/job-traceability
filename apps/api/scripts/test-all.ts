import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { execSync } from 'child_process';
import { apiRunner } from './test-helpers/apiRunner';

const testScripts = [
  { name: 'DAL Scope Check (check:dal)', command: 'tsx scripts/check-dal-imports.ts' },
  { name: 'DAL Isolation & ID Injection', command: 'tsx scripts/test-dal-isolation.ts' },
  { name: 'Production Security & Anti-Enumeration', command: 'tsx scripts/test-prod-security.ts' },
  { name: 'Offline Auth (Redis Stopped)', command: 'tsx scripts/test-offline-auth.ts' },
  { name: 'Atomic Token Concurrency', command: 'tsx scripts/test-concurrency.ts' },
  { name: 'Session Heartbeat & Idle Expiration', command: 'tsx scripts/test-heartbeat.ts' },
  { name: 'Email Outbox & Suppression', command: 'tsx scripts/test-outbox.ts' },
  { name: 'Progressive Lockout & IP Protection', command: 'tsx scripts/test-lockout.ts' },
  { name: 'Timing & Response Parity Proof', command: 'tsx scripts/test-timing-proof.ts' },
  { name: 'Real SMTP Delivery & Outage Recovery', command: 'tsx scripts/test-email-delivery-mailpit.ts' },
  { name: 'Git History Secret Scanner', command: 'tsx scripts/scan-secrets.ts' },
  { name: 'System Acceptance & Multi-Tenant Isolation', command: 'tsx scripts/test-acceptance.ts' },
  { name: 'Module 1: CV Upload, Parsing & Profile', command: 'tsx scripts/test-cv-module.ts' },
  { name: 'Module 1: Comprehensive E2E CV Suite', command: 'tsx scripts/test-cv-e2e.ts' },
  { name: 'Module 1: Real Fixtures Field-by-Field Verification', command: 'tsx scripts/verify-real-fixtures.ts' },
  { name: 'Module 2: Job Sourcing Acceptance Suite', command: 'tsx scripts/test-module2-acceptance.ts' },
];

async function runAllTests() {
  console.log('\n================================================================');
  console.log('🚀 RUNNING ALL MODULE 0, MODULE 1 & MODULE 2 TEST SUITES (npm run test:all)');
  console.log('================================================================\n');

  console.log('🔧 Starting background API server for test suite...');
  await apiRunner.startServer(4000, { EMAIL_MODE: 'console' });

  let passedCount = 0;
  let failedCount = 0;

  try {
    for (const { name, command } of testScripts) {
      console.log(`▶ Executing Module: ${name} (${command})...`);
      try {
        execSync(`npx ${command}`, { stdio: 'inherit', cwd: __dirname + '/..' });
        console.log(`✅ MODULE PASSED: ${name}\n`);
        passedCount++;
      } catch (error) {
        console.error(`❌ MODULE FAILED: ${name}\n`);
        failedCount++;
        process.exit(1);
      }
    }
  } finally {
    await apiRunner.stopServer();
  }

  console.log('================================================================');
  console.log(`🎉 ALL ${passedCount} MODULE 0 & MODULE 1 TEST SUITES PASSED PERFECTLY!`);
  console.log('================================================================\n');

  process.exit(0);
}

runAllTests();
