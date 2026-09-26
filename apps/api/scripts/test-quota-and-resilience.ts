import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { jobDal } from '../src/dal/jobDal';
import { JobSearchService } from '../src/services/job/jobSearchService';
import { IJobSource, NormalizedJob } from '../src/services/job/types';
import { JOB_SOURCING_CONFIG } from '../src/services/job/config';

async function runQuotaAndResilienceTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 5 & ACCEPTANCE TESTS (c & e): Quotas & Failure Resilience');
  console.log('================================================================\n');

  // Clean test database
  await jobDal.resetAllForTesting();
  console.log('🧹 Cleaned job cache database tables.');

  let realCallsJSearch = 0;
  let realCallsSerpApi = 0;
  let realCallsRemotive = 0;

  const workingSerpApi: IJobSource = {
    name: 'serpapi',
    searchJobs: async (q, loc): Promise<NormalizedJob[]> => {
      realCallsSerpApi++;
      return [
        {
          externalId: 'serp-job-1',
          sourceProvider: 'serpapi',
          title: 'Full Stack Engineer',
          company: 'Acme Cloud',
          location: loc || 'Remote',
          remote: true,
          salaryMin: 130000,
          salaryMax: 160000,
          salaryCurrency: 'USD',
          description: 'Great role at Acme Cloud',
          applyUrl: 'https://acme.test/serp-1',
          postedDate: '2026-09-24T12:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const workingRemotive: IJobSource = {
    name: 'remotive',
    searchJobs: async (q, loc): Promise<NormalizedJob[]> => {
      realCallsRemotive++;
      return [
        {
          externalId: 'remotive-job-1',
          sourceProvider: 'remotive',
          title: 'Senior TypeScript Engineer',
          company: 'Remote Global',
          location: 'Worldwide',
          remote: true,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          description: 'Global remote role',
          applyUrl: 'https://remotive.test/1',
          postedDate: '2026-09-25T12:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const failingJSearch: IJobSource = {
    name: 'jsearch',
    searchJobs: async (): Promise<NormalizedJob[]> => {
      realCallsJSearch++;
      const err: any = new Error('Invalid API Key: unauthorized access (HTTP 401)');
      err.statusCode = 401;
      throw err;
    },
  };

  console.log('▶ Test 5.1 (Acceptance Test c): One provider fails (401 invalid key); other two succeed...');
  const resilientService = new JobSearchService([failingJSearch, workingSerpApi, workingRemotive]);

  const searchResult = await resilientService.searchJobs({
    query: 'Engineer',
    location: 'Remote',
    forceRefresh: true, // Force live provider execution
  });

  // The search must NOT fail! It must return jobs from SerpAPI and Remotive
  assert.ok(searchResult.jobs.length >= 2, 'Search must return results from non-failing providers');
  const foundSerp = searchResult.jobs.some((j) => j.sourceProvider === 'serpapi');
  const foundRemotive = searchResult.jobs.some((j) => j.sourceProvider === 'remotive');
  assert.ok(foundSerp, 'Must include SerpAPI job');
  assert.ok(foundRemotive, 'Must include Remotive job');

  // Verify the failure was recorded in skippedProviders
  assert.strictEqual(searchResult.skippedProviders.length, 1);
  assert.strictEqual(searchResult.skippedProviders[0].provider, 'jsearch');
  assert.ok(searchResult.skippedProviders[0].reason.includes('401'));
  console.log('  ✅ Search succeeded despite JSearch 401 failure.');
  console.log(`  ✅ Returned ${searchResult.jobs.length} jobs from working providers.`);
  console.log('  ✅ Skipped/failed provider gracefully logged:', searchResult.skippedProviders);

  console.log('\n▶ Test 5.2 (Acceptance Test c part 2): Inspect database failure log in provider_api_logs...');
  const logs = await jobDal.getProviderApiLogs('jsearch', 5);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].provider, 'jsearch');
  assert.strictEqual(logs[0].is_success, 0, 'is_success must be 0 for failed call');
  assert.strictEqual(logs[0].status_code, 401, 'status_code must be 401');
  assert.ok(logs[0].error_message?.includes('unauthorized access'));
  console.log('  ✅ Failure accurately logged in provider_api_logs table:', {
    provider: logs[0].provider,
    status_code: logs[0].status_code,
    is_success: logs[0].is_success,
    error_message: logs[0].error_message,
  });

  console.log('\n▶ Test 5.3: Simulating monthly quota exhaustion on JSearch...');
  // Configure monthlyLimit for jsearch to 5 for this test
  const originalLimit = JOB_SOURCING_CONFIG.providerQuotas['jsearch'].monthlyLimit;
  JOB_SOURCING_CONFIG.providerQuotas['jsearch'].monthlyLimit = 5;

  // Insert 5 calls for jsearch in provider_api_logs to hit the quota
  for (let i = 0; i < 4; i++) {
    await jobDal.logProviderCall({
      provider: 'jsearch',
      query: 'test query',
      responseCount: 10,
      latencyMs: 120,
      statusCode: 200,
      isSuccess: true,
    });
  }

  const usageBefore = await jobDal.getProviderUsageThisMonth('jsearch');
  assert.strictEqual(usageBefore, 5, 'JSearch should now have 5 calls logged this month');

  let jsearchCalledAfterQuota = false;
  const quotaJSearch: IJobSource = {
    name: 'jsearch',
    searchJobs: async () => {
      jsearchCalledAfterQuota = true;
      return [];
    },
  };

  const quotaService = new JobSearchService([quotaJSearch, workingSerpApi, workingRemotive]);
  const quotaResult = await quotaService.searchJobs({
    query: 'Architect',
    location: 'Remote',
    forceRefresh: true,
  });

  assert.strictEqual(jsearchCalledAfterQuota, false, 'JSearch MUST NOT be called when over quota');
  assert.ok(quotaResult.skippedProviders.some((s) => s.provider === 'jsearch' && s.reason.includes('quota exceeded')));
  assert.ok(quotaResult.jobs.length >= 2, 'Search still returned results from SerpAPI and Remotive');
  console.log('  ✅ JSearch was skipped gracefully due to monthly quota exhaustion without calling the API.');
  console.log('  ✅ Other providers continued and fulfilled the search.');

  // Restore original quota
  JOB_SOURCING_CONFIG.providerQuotas['jsearch'].monthlyLimit = originalLimit;

  console.log('\n▶ Test 5.4 (Acceptance Test e): Verify quota tracker logged call count matches real calls...');
  // Total real calls made:
  // JSearch: 1 call (in Test 5.1)
  // SerpApi: 1 in 5.1 + 1 in 5.3 = 2 calls
  // Remotive: 1 in 5.1 + 1 in 5.3 = 2 calls
  // Additionally, we manually inserted 4 dummy logs for the quota test.
  // Let's count total rows in provider_api_logs and compare to expected:
  const allLogs = await jobDal.getProviderApiLogs(undefined, 100);
  const serpLogs = allLogs.filter((l) => l.provider === 'serpapi');
  const remotiveLogs = allLogs.filter((l) => l.provider === 'remotive');
  const jsearchLogs = allLogs.filter((l) => l.provider === 'jsearch');

  assert.strictEqual(serpLogs.length, realCallsSerpApi, `SerpAPI logged calls (${serpLogs.length}) must match real calls (${realCallsSerpApi})`);
  assert.strictEqual(remotiveLogs.length, realCallsRemotive, `Remotive logged calls (${remotiveLogs.length}) must match real calls (${realCallsRemotive})`);
  assert.strictEqual(jsearchLogs.length, 5, 'JSearch logged calls must match 1 test call + 4 inserted quota logs');

  console.log('  ✅ Acceptance Test (e) PROVEN: Database logged calls match actual real calls:');
  console.log(`     SerpAPI real calls: ${realCallsSerpApi} | DB logged: ${serpLogs.length}`);
  console.log(`     Remotive real calls: ${realCallsRemotive} | DB logged: ${remotiveLogs.length}`);
  console.log(`     JSearch real calls: ${realCallsJSearch} | Total DB logs: ${jsearchLogs.length}`);

  console.log('\n================================================================');
  console.log('🎉 SCOPE ITEM 5 & TESTS (c & e) PASSED: Quotas and resilience verified');
  console.log('================================================================\n');
  process.exit(0);
}

runQuotaAndResilienceTests().catch((err) => {
  console.error('❌ Quota Test Failed:', err);
  process.exit(1);
});
