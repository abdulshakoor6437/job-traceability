import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { jobDal } from '../src/dal/jobDal';
import { JobSearchService } from '../src/services/job/jobSearchService';
import { IJobSource, NormalizedJob } from '../src/services/job/types';

async function runCachingTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 3 & ACCEPTANCE TEST (a): Shared Cache & Exact Call Counter');
  console.log('================================================================\n');

  // Reset database tables
  await jobDal.resetAllForTesting();
  console.log('🧹 Cleaned job cache database tables.');

  let realProviderCalls = 0;

  // Mock provider that strictly counts invocations
  const testProvider: IJobSource = {
    name: 'test_provider',
    searchJobs: async (query: string, location?: string): Promise<NormalizedJob[]> => {
      realProviderCalls++;
      return [
        {
          externalId: `job-${realProviderCalls}`,
          sourceProvider: 'test_provider',
          title: `${query} Specialist`,
          company: 'Acme Innovation',
          location: location || 'Remote',
          remote: true,
          salaryMin: 110000,
          salaryMax: 150000,
          salaryCurrency: 'USD',
          description: `Exciting opportunity for a ${query}`,
          applyUrl: 'https://acme.test/apply',
          postedDate: '2026-09-25T10:00:00Z',
          fetchedAt: new Date().toISOString(),
        },
      ];
    },
  };

  const service = new JobSearchService([testProvider]);

  console.log('\n▶ Step 3.1: First search (cache miss expected)...');
  const initialCalls = service.getExternalCallCount();
  assert.strictEqual(initialCalls, 0, 'Initial external call counter should be 0');

  const search1 = await service.searchJobs({
    query: 'Staff DevOps',
    location: 'Remote',
    ttlHours: 8,
  });

  assert.strictEqual(search1.fromCache, false, 'Search 1 must be a cache miss (fromCache: false)');
  assert.strictEqual(search1.jobs.length, 1, 'Search 1 must return 1 job');
  assert.strictEqual(search1.externalCallsMade, 1, 'Search 1 must record 1 external call');
  assert.strictEqual(service.getExternalCallCount(), 1, 'Exact external counter must equal 1');
  assert.strictEqual(realProviderCalls, 1, 'Real provider invocation count must equal 1');
  console.log('  ✅ First search succeeded. Provider called exactly once. Stored in shared cache.');

  console.log('\n▶ Step 3.2: Second identical search inside 8-hour cache TTL (cache hit expected)...');
  const counterBeforeSearch2 = service.getExternalCallCount();

  const search2 = await service.searchJobs({
    query: 'Staff DevOps',
    location: 'Remote',
    ttlHours: 8,
  });

  const counterAfterSearch2 = service.getExternalCallCount();
  const additionalCalls = counterAfterSearch2 - counterBeforeSearch2;

  assert.strictEqual(search2.fromCache, true, 'Search 2 must be served directly from cache (fromCache: true)');
  assert.strictEqual(search2.externalCallsMade, 0, 'Search 2 must report 0 external calls made');
  assert.strictEqual(additionalCalls, 0, 'Exact call counter proves ZERO external API calls were made!');
  assert.strictEqual(realProviderCalls, 1, 'Provider invocation count remained at 1 (ZERO external calls)');
  assert.strictEqual(search2.jobs.length, 1, 'Cached search returned identical job count');
  assert.strictEqual(search2.jobs[0].title, 'Staff DevOps Specialist');
  console.log(`  ✅ PROVEN: Exact external calls before search: ${counterBeforeSearch2}, after search: ${counterAfterSearch2}`);
  console.log(`  ✅ Additional external calls made: ${additionalCalls} (EXACT ZERO!)`);

  console.log('\n▶ Step 3.3: Third search with different criteria (cache miss expected)...');
  const search3 = await service.searchJobs({
    query: 'Backend Engineer',
    location: 'Austin, TX',
    ttlHours: 8,
  });

  assert.strictEqual(search3.fromCache, false, 'Search 3 with new criteria must be a cache miss');
  assert.strictEqual(service.getExternalCallCount(), 2, 'Counter must increment to 2 after different query');
  assert.strictEqual(realProviderCalls, 2, 'Real provider invoked exactly 2 times total');
  console.log('  ✅ Third search made 1 new external call as expected.');

  console.log('\n▶ Step 3.4: Verifying shared cache is keyed by role+location+filters, NOT by user...');
  const cachedDb = await jobDal.getCachedSearch(search1.cacheKey);
  assert.ok(cachedDb, 'Cache row must exist in job_search_cache');
  assert.strictEqual(cachedDb.cache.query, 'Staff DevOps');
  assert.strictEqual(cachedDb.cache.location, 'Remote');
  assert.strictEqual(cachedDb.jobs.length, 1);
  console.log('  ✅ Database row confirmed in job_search_cache with SHA-256 key:', cachedDb.cache.cache_key);

  console.log('\n================================================================');
  console.log('🎉 SCOPE ITEM 3 & TEST (a) PASSED: Zero external calls on cache hit!');
  console.log('================================================================\n');
  process.exit(0);
}

runCachingTests().catch((err) => {
  console.error('❌ Caching Test Failed:', err);
  process.exit(1);
});
