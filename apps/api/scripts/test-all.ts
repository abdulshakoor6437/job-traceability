import { execSync } from 'child_process';

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
];

async function runAllTests() {
  console.log('\n================================================================');
  console.log('🚀 RUNNING ALL MODULE 0 TEST SUITES (npm run test:all)');
  console.log('================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

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

  console.log('================================================================');
  console.log(`🎉 ALL ${passedCount} MODULE 0 TEST SUITES PASSED PERFECTLY!`);
  console.log('================================================================\n');

  process.exit(0);
}

runAllTests();
