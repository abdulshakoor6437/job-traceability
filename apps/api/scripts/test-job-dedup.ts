import assert from 'assert';
import {
  normalizeCompany,
  normalizeTitle,
  normalizeLocation,
  stringSimilarity,
  areLikelyDuplicates,
  mergeJobs,
  deduplicateJobs,
} from '../src/services/job/deduplicator';
import { NormalizedJob, IJobSource } from '../src/services/job/types';
import { JobSearchService } from '../src/services/job/jobSearchService';
import { jobDal } from '../src/dal/jobDal';

async function runDedupTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 4 & ACCEPTANCE TEST (b): Cross-Provider Deduplication');
  console.log('================================================================\n');

  console.log('▶ Test 4.1: Normalization and string similarity helpers...');
  assert.strictEqual(normalizeCompany('Google, LLC.'), 'google');
  assert.strictEqual(normalizeCompany('Google Inc'), 'google');
  assert.strictEqual(normalizeCompany('Microsoft Corporation'), 'microsoft');
  assert.strictEqual(normalizeTitle('Sr. Software Engineer (Remote)'), 'seniorsoftwareengineer');
  assert.strictEqual(normalizeTitle('Senior Software Engineer'), 'seniorsoftwareengineer');
  assert.strictEqual(normalizeLocation('San Francisco, CA'), 'sanfranciscoca');
  assert.strictEqual(normalizeLocation('Remote (US Only)'), 'remote');

  const sim = stringSimilarity('seniorsoftwareengineer', 'srsoftwareengineer');
  assert.ok(sim > 0.75, `Similarity ${sim} should be > 0.75`);
  console.log('  ✅ Normalization and similarity functions verified.');

  console.log('\n▶ Test 4.2: Fuzzy matching detection on overlapping jobs across providers...');
  const jsearchJob: NormalizedJob = {
    externalId: 'js-goog-001',
    sourceProvider: 'jsearch',
    title: 'Senior Software Engineer - Cloud',
    company: 'Google LLC',
    location: 'Mountain View, CA',
    remote: false,
    salaryMin: 180000,
    salaryMax: 240000,
    salaryCurrency: 'USD',
    description: 'Detailed description of the Cloud Senior Software Engineer role at Google...',
    applyUrl: 'https://careers.google.com/jobs/001',
    postedDate: '2026-09-20T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const serpApiJob: NormalizedJob = {
    externalId: 'serp-goog-999',
    sourceProvider: 'serpapi',
    title: 'Sr. Software Engineer - Cloud (Full-Time)',
    company: 'Google, Inc.',
    location: 'Mountain View',
    remote: false,
    salaryMin: null, // SerpAPI might not have salary for this listing
    salaryMax: null,
    salaryCurrency: null,
    description: 'Short snippet from Google Jobs',
    applyUrl: 'https://google.com/jobs/results/999',
    postedDate: '2026-09-21T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const areDupes = areLikelyDuplicates(jsearchJob, serpApiJob);
  assert.strictEqual(areDupes, true, 'Jobs with fuzzy company, title, and location MUST be detected as duplicates');
  console.log('  ✅ Detected fuzzy duplicate between JSearch and SerpAPI listings.');

  console.log('\n▶ Test 4.3: Merging duplicate jobs and tracking sources...');
  const merged = mergeJobs(jsearchJob, serpApiJob);

  assert.strictEqual(merged.company, 'Google LLC');
  assert.strictEqual(merged.title, 'Senior Software Engineer - Cloud');
  assert.strictEqual(merged.salaryMin, 180000, 'Real salary from JSearch must be preserved when SerpApi has null');
  assert.strictEqual(merged.salaryMax, 240000);
  assert.strictEqual(merged.salaryCurrency, 'USD');
  assert.strictEqual(merged.description, jsearchJob.description, 'Longer description must be preserved');
  assert.ok(merged.sourceProviders?.includes('jsearch'), 'Merged job must list jsearch as source');
  assert.ok(merged.sourceProviders?.includes('serpapi'), 'Merged job must list serpapi as source');
  assert.strictEqual(merged.sourceProviders?.length, 2, 'Must track exactly 2 reporting sources');
  assert.strictEqual(merged.externalIds?.['jsearch'], 'js-goog-001');
  assert.strictEqual(merged.externalIds?.['serpapi'], 'serp-goog-999');
  console.log('  ✅ Merged record accurately preserved fields and tracked both reporting sources:');
  console.log('     Sources:', merged.sourceProviders);
  console.log('     External IDs:', merged.externalIds);
  console.log('     Salary:', `${merged.salaryMin} - ${merged.salaryMax} ${merged.salaryCurrency}`);

  console.log('\n▶ Test 4.4: Deduplicating an array with overlapping and distinct jobs...');
  const amazonJob: NormalizedJob = {
    externalId: 'js-amzn-100',
    sourceProvider: 'jsearch',
    title: 'Senior Software Engineer',
    company: 'Amazon.com Services LLC',
    location: 'Seattle, WA',
    remote: false,
    salaryMin: 160000,
    salaryMax: 200000,
    salaryCurrency: 'USD',
    description: 'Amazon AWS role',
    applyUrl: 'https://amazon.jobs/100',
    postedDate: '2026-09-22T10:00:00Z',
    fetchedAt: new Date().toISOString(),
  };

  const deduplicatedList = deduplicateJobs([jsearchJob, serpApiJob, amazonJob]);
  assert.strictEqual(deduplicatedList.length, 2, '3 raw jobs with 1 duplicate pair must produce exactly 2 deduplicated jobs');
  console.log(`  ✅ Successfully reduced 3 raw jobs to ${deduplicatedList.length} unique records.`);

  console.log('\n▶ Test 4.5: End-to-end service test with overlapping JSearch and SerpAPI results (Acceptance Test b)...');
  await jobDal.resetAllForTesting();

  const mockJSearch: IJobSource = {
    name: 'jsearch',
    searchJobs: async () => [
      {
        externalId: 'jsearch-lead-01',
        sourceProvider: 'jsearch',
        title: 'Lead Frontend Architect',
        company: 'Stripe, Inc.',
        location: 'San Francisco, CA',
        remote: true,
        salaryMin: 190000,
        salaryMax: 230000,
        salaryCurrency: 'USD',
        description: 'Lead Stripe UI architecture across all web products',
        applyUrl: 'https://stripe.com/jobs/lead-01',
        postedDate: '2026-09-23T10:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
      {
        externalId: 'jsearch-uniq-02',
        sourceProvider: 'jsearch',
        title: 'Backend Database Engineer',
        company: 'Stripe, Inc.',
        location: 'San Francisco, CA',
        remote: true,
        salaryMin: 170000,
        salaryMax: 210000,
        salaryCurrency: 'USD',
        description: 'Distributed database scaling',
        applyUrl: 'https://stripe.com/jobs/db-02',
        postedDate: '2026-09-23T10:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
    ],
  };

  const mockSerpApi: IJobSource = {
    name: 'serpapi',
    searchJobs: async () => [
      // Duplicate of Lead Frontend Architect from Stripe
      {
        externalId: 'serpapi-lead-99',
        sourceProvider: 'serpapi',
        title: 'Lead Frontend Architect (Remote)',
        company: 'Stripe',
        location: 'San Francisco',
        remote: true,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        description: 'Stripe UI architecture role snippet',
        applyUrl: 'https://google.com/jobs/stripe-99',
        postedDate: '2026-09-23T11:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
      // Unique job from SerpAPI
      {
        externalId: 'serpapi-uniq-03',
        sourceProvider: 'serpapi',
        title: 'Site Reliability Engineer',
        company: 'Stripe, Inc.',
        location: 'San Francisco, CA',
        remote: true,
        salaryMin: 180000,
        salaryMax: 220000,
        salaryCurrency: 'USD',
        description: 'SRE at Stripe',
        applyUrl: 'https://stripe.com/jobs/sre-03',
        postedDate: '2026-09-23T10:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
    ],
  };

  const mockRemotive: IJobSource = {
    name: 'remotive',
    searchJobs: async () => [],
  };

  const searchService = new JobSearchService([mockJSearch, mockSerpApi, mockRemotive]);
  const result = await searchService.searchJobs({
    query: 'Architect',
    location: 'San Francisco',
  });

  // Total raw returned across providers was 4 (2 from JSearch, 2 from SerpAPI)
  // With 1 duplicate pair, final count MUST be 3!
  assert.strictEqual(result.jobs.length, 3, 'Must merge overlapping results into exactly 3 unique records');

  const mergedJob = result.jobs.find((j) => j.title.toLowerCase().includes('frontend'));
  assert.ok(mergedJob, 'Merged frontend architect job must exist');
  assert.ok(mergedJob.sourceProviders?.includes('jsearch'), 'Must include jsearch');
  assert.ok(mergedJob.sourceProviders?.includes('serpapi'), 'Must include serpapi');
  assert.strictEqual(mergedJob.sourceProviders?.length, 2, 'Must track exactly 2 reporting sources');
  assert.strictEqual(mergedJob.salaryMin, 190000, 'Preserved real salary from JSearch');
  assert.strictEqual(mergedJob.salaryMax, 230000);
  console.log('  ✅ Acceptance Test (b) PROVEN: Overlapping JSearch and SerpAPI results merged into one record:');
  console.log('     Title:', mergedJob.title);
  console.log('     Company:', mergedJob.company);
  console.log('     Sources reported:', mergedJob.sourceProviders);
  console.log('     Merged External IDs:', mergedJob.externalIds);

  console.log('\n================================================================');
  console.log('🎉 SCOPE ITEM 4 & TEST (b) PASSED: Cross-provider fuzzy dedup verified');
  console.log('================================================================\n');
  process.exit(0);
}

runDedupTests().catch((err) => {
  console.error('❌ Deduplication Test Failed:', err);
  process.exit(1);
});
