import assert from 'assert';
import { JSearchProvider } from '../src/services/job/providers/jsearchProvider';
import { SerpApiProvider } from '../src/services/job/providers/serpApiProvider';
import { RemotiveProvider } from '../src/services/job/providers/remotiveProvider';
import { IJobSource, NormalizedJob } from '../src/services/job/types';

async function runProviderTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 1: IJobSource & Provider Adapters Test Suite');
  console.log('================================================================\n');

  let callCountJSearch = 0;
  let callCountSerpApi = 0;
  let callCountRemotive = 0;

  // 1. Mock fetcher for JSearch
  const mockJSearchFetcher: typeof fetch = async (input, init) => {
    callCountJSearch++;
    const rawData = {
      status: 'OK',
      data: [
        {
          job_id: 'js-12345',
          employer_name: 'Tech Corp',
          job_title: 'Full Stack Engineer',
          job_city: 'San Francisco',
          job_state: 'CA',
          job_country: 'US',
          job_is_remote: true,
          job_min_salary: 120000,
          job_max_salary: 160000,
          job_salary_currency: 'USD',
          job_description: 'We are seeking a Full Stack Engineer...',
          job_apply_link: 'https://techcorp.com/jobs/12345',
          job_posted_at_datetime_utc: '2026-09-20T12:00:00Z',
        },
      ],
    };
    return new Response(JSON.stringify(rawData), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // 2. Mock fetcher for SerpAPI
  const mockSerpApiFetcher: typeof fetch = async (input, init) => {
    callCountSerpApi++;
    const rawData = {
      jobs_results: [
        {
          job_id: 'serp-9988',
          title: 'Senior Backend Developer',
          company_name: 'CloudBase',
          location: 'New York, NY',
          description: 'Looking for a Go / Node backend developer',
          share_link: 'https://google.com/jobs/serp-9988',
          detected_extensions: {
            posted_at: '2 days ago',
            work_from_home: false,
            salary: '$130K–$150K a year',
          },
          apply_options: [{ title: 'Apply directly', link: 'https://cloudbase.io/careers' }],
        },
      ],
    };
    return new Response(JSON.stringify(rawData), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  // 3. Mock fetcher for Remotive
  const mockRemotiveFetcher: typeof fetch = async (input, init) => {
    callCountRemotive++;
    const rawData = {
      'job-count': 1,
      jobs: [
        {
          id: 55443,
          url: 'https://remotive.com/remote-jobs/dev-55443',
          title: 'Remote React Developer',
          company_name: 'RemoteFirst',
          candidate_required_location: 'Worldwide',
          salary: '', // Remotive typically does not provide structured salary
          description: 'A global remote position for React experts',
          publication_date: '2026-09-22T08:30:00',
        },
      ],
    };
    return new Response(JSON.stringify(rawData), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  console.log('▶ Step 1.1: Instantiating providers and verifying IJobSource interface compliance...');
  const jsearch: IJobSource = new JSearchProvider('mock-jsearch-key', mockJSearchFetcher);
  const serpapi: IJobSource = new SerpApiProvider('mock-serpapi-key', mockSerpApiFetcher);
  const remotive: IJobSource = new RemotiveProvider(mockRemotiveFetcher);

  assert.strictEqual(jsearch.name, 'jsearch');
  assert.strictEqual(serpapi.name, 'serpapi');
  assert.strictEqual(remotive.name, 'remotive');
  console.log('  ✅ All 3 providers implement IJobSource correctly.');

  console.log('\n▶ Step 1.2: Calling searchJobs on JSearchProvider...');
  const jsearchResults = await jsearch.searchJobs('engineer', 'San Francisco', 1);
  assert.strictEqual(jsearchResults.length, 1);
  const jsJob = jsearchResults[0];
  assert.strictEqual(jsJob.externalId, 'js-12345');
  assert.strictEqual(jsJob.sourceProvider, 'jsearch');
  assert.strictEqual(jsJob.title, 'Full Stack Engineer');
  assert.strictEqual(jsJob.company, 'Tech Corp');
  assert.strictEqual(jsJob.location, 'San Francisco, CA, US');
  assert.strictEqual(jsJob.remote, true);
  assert.strictEqual(jsJob.salaryMin, 120000);
  assert.strictEqual(jsJob.salaryMax, 160000);
  assert.strictEqual(jsJob.salaryCurrency, 'USD');
  assert.strictEqual(jsJob.applyUrl, 'https://techcorp.com/jobs/12345');
  console.log('  ✅ JSearchProvider mapped fields accurately:', JSON.stringify(jsJob, null, 2));

  console.log('\n▶ Step 1.3: Calling searchJobs on SerpApiProvider...');
  const serpResults = await serpapi.searchJobs('developer', 'New York', 1);
  assert.strictEqual(serpResults.length, 1);
  const serpJob = serpResults[0];
  assert.strictEqual(serpJob.externalId, 'serp-9988');
  assert.strictEqual(serpJob.sourceProvider, 'serpapi');
  assert.strictEqual(serpJob.title, 'Senior Backend Developer');
  assert.strictEqual(serpJob.company, 'CloudBase');
  assert.strictEqual(serpJob.location, 'New York, NY');
  assert.strictEqual(serpJob.remote, false);
  assert.strictEqual(serpJob.salaryMin, 130000);
  assert.strictEqual(serpJob.salaryMax, 150000);
  assert.strictEqual(serpJob.salaryCurrency, 'USD');
  assert.strictEqual(serpJob.applyUrl, 'https://cloudbase.io/careers');
  console.log('  ✅ SerpApiProvider mapped fields accurately:', JSON.stringify(serpJob, null, 2));

  console.log('\n▶ Step 1.4: Calling searchJobs on RemotiveProvider...');
  const remotiveResults = await remotive.searchJobs('react');
  assert.strictEqual(remotiveResults.length, 1);
  const remotiveJob = remotiveResults[0];
  assert.strictEqual(remotiveJob.externalId, '55443');
  assert.strictEqual(remotiveJob.sourceProvider, 'remotive');
  assert.strictEqual(remotiveJob.title, 'Remote React Developer');
  assert.strictEqual(remotiveJob.company, 'RemoteFirst');
  assert.strictEqual(remotiveJob.location, 'Worldwide');
  assert.strictEqual(remotiveJob.remote, true);
  assert.strictEqual(remotiveJob.salaryMin, null, 'Remotive salaryMin must be null');
  assert.strictEqual(remotiveJob.salaryMax, null, 'Remotive salaryMax must be null');
  assert.strictEqual(remotiveJob.salaryCurrency, null, 'Remotive salaryCurrency must be null');
  assert.strictEqual(remotiveJob.applyUrl, 'https://remotive.com/remote-jobs/dev-55443');
  console.log('  ✅ RemotiveProvider mapped fields accurately with null salary:', JSON.stringify(remotiveJob, null, 2));

  console.log('\n▶ Step 1.5: Verifying adapters do NOT perform caching or deduplication internally...');
  await jsearch.searchJobs('engineer', 'San Francisco', 1);
  await serpapi.searchJobs('developer', 'New York', 1);
  await remotive.searchJobs('react');

  assert.strictEqual(callCountJSearch, 2, 'JSearch adapter must have called provider fetcher exactly 2 times');
  assert.strictEqual(callCountSerpApi, 2, 'SerpApi adapter must have called provider fetcher exactly 2 times');
  assert.strictEqual(callCountRemotive, 2, 'Remotive adapter must have called provider fetcher exactly 2 times');
  console.log('  ✅ Verified: No internal caching inside adapters. Provider calls are 1:1 with searchJobs invocations.');

  console.log('\n================================================================');
  console.log('🎉 SCOPE ITEM 1 PASSED: All 3 adapters implement IJobSource cleanly');
  console.log('================================================================\n');
}

runProviderTests().catch((err) => {
  console.error('❌ Provider Test Failed:', err);
  process.exit(1);
});
