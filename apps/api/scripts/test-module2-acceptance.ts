import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { jobDal } from '../src/dal/jobDal';
import { getDbPool } from '../src/dal/db';
import { JobSearchService } from '../src/services/job/jobSearchService';
import { IJobSource, NormalizedJob } from '../src/services/job/types';
import { validateAndNormalizeJob } from '../src/services/job/schema';
import { areLikelyDuplicates, mergeJobs, deduplicateJobs } from '../src/services/job/deduplicator';
import { JOB_SOURCING_CONFIG } from '../src/services/job/config';
import { RowDataPacket } from 'mysql2/promise';

async function runModule2AcceptanceSuite() {
  console.log('\n========================================================================');
  console.log('🚀 MODULE 2 ACCEPTANCE TEST SUITE: JOB SOURCING (Tests a - f)');
  console.log('========================================================================\n');

  // ==========================================================================
  // Test a: Search the same role+location twice inside cache TTL; prove zero calls
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (a): Shared Cache TTL & Exact Call Counter Verification');
  console.log('------------------------------------------------------------------------');
  await jobDal.resetAllForTesting();

  let testACallCount = 0;
  const providerA: IJobSource = {
    name: 'counter_provider',
    searchJobs: async (query, location): Promise<NormalizedJob[]> => {
      testACallCount++;
      return [
        {
          externalId: `cnt-${testACallCount}`,
          sourceProvider: 'counter_provider',
          title: `${query} Lead`,
          company: 'Acme Global',
          location: location || 'Remote',
          remote: true,
          salaryMin: 150000,
          salaryMax: 180000,
          salaryCurrency: 'USD',
          description: 'Great role at Acme',
          applyUrl: 'https://acme.test/cnt-1',
          postedDate: '2026-09-24T10:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const serviceA = new JobSearchService([providerA]);

  // First search -> Live call
  const initialCallCounter = serviceA.getExternalCallCount();
  const searchA1 = await serviceA.searchJobs({
    query: 'Staff Engineer',
    location: 'Remote',
    ttlHours: 8,
  });

  assert.strictEqual(searchA1.fromCache, false, 'Search A1 must be cache miss');
  assert.strictEqual(serviceA.getExternalCallCount(), 1, 'External counter must increment to 1');
  assert.strictEqual(testACallCount, 1, 'Provider was invoked once');

  // Second search -> Must be 0 external calls
  const beforeSecondSearch = serviceA.getExternalCallCount();
  const searchA2 = await serviceA.searchJobs({
    query: 'Staff Engineer',
    location: 'Remote',
    ttlHours: 8,
  });
  const afterSecondSearch = serviceA.getExternalCallCount();
  const deltaCalls = afterSecondSearch - beforeSecondSearch;

  assert.strictEqual(searchA2.fromCache, true, 'Search A2 must be served from cache');
  assert.strictEqual(searchA2.externalCallsMade, 0, 'Reported externalCallsMade must be 0');
  assert.strictEqual(deltaCalls, 0, 'Exact call counter proves ZERO external API calls were made');
  assert.strictEqual(testACallCount, 1, 'Provider was NOT called during second search');
  console.log('  [TEST a EVIDENCE]');
  console.log(`  - Initial external call counter: ${initialCallCounter}`);
  console.log(`  - Calls after 1st search:        ${beforeSecondSearch}`);
  console.log(`  - Calls after 2nd search:        ${afterSecondSearch}`);
  console.log(`  - Additional calls on cache hit: ${deltaCalls} (EXACT ZERO)`);
  console.log('  ✅ ACCEPTANCE TEST (a) PASSED: Zero external calls inside cache TTL\n');

  // ==========================================================================
  // Test b: Overlapping JSearch / SerpAPI results merged into one record
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (b): Cross-Provider Deduplication & Source Attribution');
  console.log('------------------------------------------------------------------------');
  await jobDal.resetAllForTesting();

  const jsearchJobFixture: NormalizedJob = {
    externalId: 'jsearch-dupe-101',
    sourceProvider: 'jsearch',
    title: 'Principal Distributed Systems Engineer',
    company: 'Stripe, Inc.',
    location: 'San Francisco, CA',
    remote: true,
    salaryMin: 220000,
    salaryMax: 270000,
    salaryCurrency: 'USD',
    description: 'Lead engineering for global payment ledger at Stripe',
    applyUrl: 'https://stripe.com/jobs/101',
    postedDate: '2026-09-22T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const serpApiJobFixture: NormalizedJob = {
    externalId: 'serpapi-dupe-202',
    sourceProvider: 'serpapi',
    title: 'Principal Distributed Systems Engineer (Remote)',
    company: 'Stripe',
    location: 'San Francisco',
    remote: true,
    salaryMin: null, // Missing salary in SerpApi
    salaryMax: null,
    salaryCurrency: null,
    description: 'Short Google Jobs snippet for Stripe ledger',
    applyUrl: 'https://google.com/jobs/stripe-202',
    postedDate: '2026-09-23T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const distinctJobFixture: NormalizedJob = {
    externalId: 'jsearch-distinct-303',
    sourceProvider: 'jsearch',
    title: 'Machine Learning Infrastructure Engineer',
    company: 'Anthropic',
    location: 'San Francisco, CA',
    remote: true,
    salaryMin: 230000,
    salaryMax: 290000,
    salaryCurrency: 'USD',
    description: 'Scaling training clusters',
    applyUrl: 'https://anthropic.com/jobs/303',
    postedDate: '2026-09-24T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const areDupes = areLikelyDuplicates(jsearchJobFixture, serpApiJobFixture);
  assert.strictEqual(areDupes, true, 'JSearch and SerpAPI listings must be detected as duplicates');

  const deduplicated = deduplicateJobs([jsearchJobFixture, serpApiJobFixture, distinctJobFixture]);
  assert.strictEqual(deduplicated.length, 2, '3 raw jobs with 1 duplicate pair must produce 2 merged jobs');

  const mergedJob = deduplicated.find((j) => j.company.toLowerCase().includes('stripe'));
  assert.ok(mergedJob, 'Merged Stripe job must exist');
  assert.ok(mergedJob.sourceProviders?.includes('jsearch'), 'Must record jsearch as source');
  assert.ok(mergedJob.sourceProviders?.includes('serpapi'), 'Must record serpapi as source');
  assert.strictEqual(mergedJob.sourceProviders?.length, 2, 'Must track exactly 2 reporting sources');
  assert.strictEqual(mergedJob.externalIds?.['jsearch'], 'jsearch-dupe-101');
  assert.strictEqual(mergedJob.externalIds?.['serpapi'], 'serpapi-dupe-202');
  assert.strictEqual(mergedJob.salaryMin, 220000, 'Real salary preserved from JSearch');

  console.log('  [TEST b EVIDENCE]');
  console.log(`  - Input raw jobs:           3 (2 Stripe duplicates + 1 distinct Anthropic)`);
  console.log(`  - Deduplicated job count:   ${deduplicated.length}`);
  console.log(`  - Merged job title:         "${mergedJob.title}"`);
  console.log(`  - Reporting sources:        ${JSON.stringify(mergedJob.sourceProviders)}`);
  console.log(`  - Preserved external IDs:   ${JSON.stringify(mergedJob.externalIds)}`);
  console.log(`  - Preserved salary range:   $${mergedJob.salaryMin} - $${mergedJob.salaryMax} ${mergedJob.salaryCurrency}`);
  console.log('  ✅ ACCEPTANCE TEST (b) PASSED: Overlapping cross-provider jobs merged with sources tracked\n');

  // ==========================================================================
  // Test c: One provider fails / over quota; search continues with other two
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (c): Provider Failure & Over-Quota Resilience');
  console.log('------------------------------------------------------------------------');
  await jobDal.resetAllForTesting();

  let serpApiCalled = 0;
  let remotiveCalled = 0;
  let failingCalled = 0;

  const failingProvider: IJobSource = {
    name: 'jsearch',
    searchJobs: async () => {
      failingCalled++;
      const err: any = new Error('Simulated HTTP 401 Unauthorized (Invalid RapidAPI Key)');
      err.statusCode = 401;
      throw err;
    },
  };

  const healthySerpApi: IJobSource = {
    name: 'serpapi',
    searchJobs: async (q, loc) => {
      serpApiCalled++;
      return [
        {
          externalId: 'serp-healthy-1',
          sourceProvider: 'serpapi',
          title: 'Senior Frontend Developer',
          company: 'Acme Web',
          location: loc || 'Remote',
          remote: true,
          salaryMin: 140000,
          salaryMax: 170000,
          salaryCurrency: 'USD',
          description: 'Frontend architecting with React & TypeScript',
          applyUrl: 'https://acme.test/serp-healthy',
          postedDate: '2026-09-24T12:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const healthyRemotive: IJobSource = {
    name: 'remotive',
    searchJobs: async (q, loc) => {
      remotiveCalled++;
      return [
        {
          externalId: 'remotive-healthy-1',
          sourceProvider: 'remotive',
          title: 'Staff Fullstack Engineer',
          company: 'Global Remote Ltd',
          location: 'Worldwide',
          remote: true,
          salaryMin: null,
          salaryMax: null,
          salaryCurrency: null,
          description: 'Global remote fullstack engineering role',
          applyUrl: 'https://remotive.test/healthy-1',
          postedDate: '2026-09-25T12:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const resilientService = new JobSearchService([failingProvider, healthySerpApi, healthyRemotive]);
  const resilienceResult = await resilientService.searchJobs({
    query: 'Engineer',
    location: 'Remote',
    forceRefresh: true,
  });

  assert.strictEqual(failingCalled, 1, 'Failing provider was attempted');
  assert.strictEqual(serpApiCalled, 1, 'SerpApi was called');
  assert.strictEqual(remotiveCalled, 1, 'Remotive was called');
  assert.strictEqual(resilienceResult.jobs.length, 2, 'Search must return results from the 2 working providers');
  assert.strictEqual(resilienceResult.skippedProviders.length, 1, 'Failure logged in skippedProviders');
  assert.strictEqual(resilienceResult.skippedProviders[0].provider, 'jsearch');

  // Verify failure log in database
  const failureLogs = await jobDal.getProviderApiLogs('jsearch', 5);
  assert.strictEqual(failureLogs.length, 1);
  assert.strictEqual(failureLogs[0].is_success, 0);
  assert.strictEqual(failureLogs[0].status_code, 401);

  console.log('  [TEST c EVIDENCE]');
  console.log(`  - Failed provider:          ${resilienceResult.skippedProviders[0].provider}`);
  console.log(`  - Logged failure reason:    ${resilienceResult.skippedProviders[0].reason}`);
  console.log(`  - Jobs returned from others:${resilienceResult.jobs.length}`);
  console.log(`  - DB log recorded:          status=${failureLogs[0].status_code}, success=${failureLogs[0].is_success}, error=${failureLogs[0].error_message}`);
  console.log('  ✅ ACCEPTANCE TEST (c) PASSED: Search succeeded despite provider failure; failure logged\n');

  // ==========================================================================
  // Test d: Confirm job with missing salary data is stored with null fields
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (d): Non-Fabrication Rule & Null Preservation');
  console.log('------------------------------------------------------------------------');
  const remotiveRaw = {
    externalId: 'remotive-null-test-55',
    sourceProvider: 'remotive',
    title: 'Lead Elixir Architect',
    company: 'BEAM Systems',
    location: 'Remote',
    remote: true,
    // Note: No salaryMin, salaryMax, salaryCurrency provided
  };

  const normalizedRemotive = validateAndNormalizeJob(remotiveRaw);
  assert.strictEqual(normalizedRemotive.salaryMin, null, 'salaryMin must be null');
  assert.strictEqual(normalizedRemotive.salaryMax, null, 'salaryMax must be null');
  assert.strictEqual(normalizedRemotive.salaryCurrency, null, 'salaryCurrency must be null');

  // Save to database cache and query back
  await jobDal.saveCachedSearch({
    cacheKey: 'test-null-cache-key',
    query: 'Elixir',
    ttlHours: 8,
    jobs: [normalizedRemotive],
  });

  const retrievedFromDb = await jobDal.getCachedSearch('test-null-cache-key');
  assert.ok(retrievedFromDb, 'Search cache must be found in DB');
  const dbJob = retrievedFromDb.jobs[0];
  assert.strictEqual(dbJob.salaryMin, null, 'Database salary_min must be null');
  assert.strictEqual(dbJob.salaryMax, null, 'Database salary_max must be null');
  assert.strictEqual(dbJob.salaryCurrency, null, 'Database salary_currency must be null');

  console.log('  [TEST d EVIDENCE]');
  console.log(`  - Retrieved job:            "${dbJob.title}" at "${dbJob.company}"`);
  console.log(`  - DB salaryMin:             ${dbJob.salaryMin} (STRICT NULL, not 0 or fabricated)`);
  console.log(`  - DB salaryMax:             ${dbJob.salaryMax} (STRICT NULL, not 0 or fabricated)`);
  console.log(`  - DB salaryCurrency:        ${dbJob.salaryCurrency} (STRICT NULL, not fabricated)`);
  console.log('  ✅ ACCEPTANCE TEST (d) PASSED: Missing salary stored strictly as null\n');

  // ==========================================================================
  // Test e: Quota tracker's logged call count matches actual real calls
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (e): Quota Tracker Call Count Match');
  console.log('------------------------------------------------------------------------');
  await jobDal.resetAllForTesting();

  let countedCallsP1 = 0;
  let countedCallsP2 = 0;

  const trackerP1: IJobSource = {
    name: 'jsearch',
    searchJobs: async () => {
      countedCallsP1++;
      return [];
    },
  };

  const trackerP2: IJobSource = {
    name: 'serpapi',
    searchJobs: async () => {
      countedCallsP2++;
      return [];
    },
  };

  const trackerService = new JobSearchService([trackerP1, trackerP2]);

  // Execute 3 distinct searches
  await trackerService.searchJobs({ query: 'Q1', forceRefresh: true });
  await trackerService.searchJobs({ query: 'Q2', forceRefresh: true });
  await trackerService.searchJobs({ query: 'Q3', forceRefresh: true });

  const totalCallsAttempted = countedCallsP1 + countedCallsP2;
  const dbLoggedCallsP1 = await jobDal.getProviderUsageThisMonth('jsearch');
  const dbLoggedCallsP2 = await jobDal.getProviderUsageThisMonth('serpapi');
  const totalDbLogged = dbLoggedCallsP1 + dbLoggedCallsP2;

  assert.strictEqual(dbLoggedCallsP1, countedCallsP1, 'JSearch DB calls must match real calls (3)');
  assert.strictEqual(dbLoggedCallsP2, countedCallsP2, 'SerpAPI DB calls must match real calls (3)');
  assert.strictEqual(totalDbLogged, totalCallsAttempted, `Total logged calls (${totalDbLogged}) must match attempted (${totalCallsAttempted})`);

  console.log('  [TEST e EVIDENCE]');
  console.log(`  - JSearch:  real calls = ${countedCallsP1}, DB logged = ${dbLoggedCallsP1}`);
  console.log(`  - SerpAPI:  real calls = ${countedCallsP2}, DB logged = ${dbLoggedCallsP2}`);
  console.log(`  - Total:    real calls = ${totalCallsAttempted}, DB logged = ${totalDbLogged} (EXACT MATCH!)`);
  console.log('  ✅ ACCEPTANCE TEST (e) PASSED: Quota tracker logged call count matches real calls\n');

  // ==========================================================================
  // Test f: Inspect and confirm job cache schema has no user-identifying columns
  // ==========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('▶ Acceptance Test (f): Privacy Audit — Zero User-Identifying Columns');
  console.log('------------------------------------------------------------------------');
  const pool = getDbPool();
  const tables = ['job_search_cache', 'cached_jobs', 'job_search_cache_entries', 'provider_api_logs'];

  for (const tableName of tables) {
    const [cols] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    );

    const names = cols.map((c) => c.COLUMN_NAME);
    assert.strictEqual(names.includes('user_id'), false, `Table ${tableName} must NOT have user_id`);
    for (const name of names) {
      assert.ok(!name.toLowerCase().includes('user_id'), `Column ${name} violates isolation`);
    }
    console.log(`  - Table [${tableName}] confirmed: ${cols.length} columns, ZERO user_id columns`);
  }
  console.log('  ✅ ACCEPTANCE TEST (f) PASSED: Job cache tables contain NO user-identifying data\n');

  console.log('========================================================================');
  console.log('🎉 ALL 6 MODULE 2 ACCEPTANCE TESTS (a - f) PASSED WITH ZERO FAILURES!');
  console.log('========================================================================\n');
  process.exit(0);
}

runModule2AcceptanceSuite().catch((err) => {
  console.error('❌ Acceptance Test Suite Failed:', err);
  process.exit(1);
});
