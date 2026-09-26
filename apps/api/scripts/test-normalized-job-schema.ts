import assert from 'assert';
import { NormalizedJobSchema, validateAndNormalizeJob } from '../src/services/job/schema';

async function runSchemaTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 2: Normalized Job Schema & Non-Fabrication Tests');
  console.log('================================================================\n');

  console.log('▶ Test 2.1: Full valid job with all fields populated...');
  const fullJob = validateAndNormalizeJob({
    externalId: 'ext-101',
    sourceProvider: 'jsearch',
    title: 'Senior Software Engineer',
    company: 'Acme Corp',
    location: 'Austin, TX',
    remote: true,
    salaryMin: 140000,
    salaryMax: 180000,
    salaryCurrency: 'USD',
    description: 'We are looking for a Senior Software Engineer to build scalable APIs.',
    applyUrl: 'https://acme.com/jobs/101',
    postedDate: '2026-09-20T10:00:00.000Z',
    fetchedAt: '2026-09-26T18:00:00.000Z',
  });

  assert.strictEqual(fullJob.externalId, 'ext-101');
  assert.strictEqual(fullJob.sourceProvider, 'jsearch');
  assert.strictEqual(fullJob.title, 'Senior Software Engineer');
  assert.strictEqual(fullJob.company, 'Acme Corp');
  assert.strictEqual(fullJob.location, 'Austin, TX');
  assert.strictEqual(fullJob.remote, true);
  assert.strictEqual(fullJob.salaryMin, 140000);
  assert.strictEqual(fullJob.salaryMax, 180000);
  assert.strictEqual(fullJob.salaryCurrency, 'USD');
  assert.strictEqual(fullJob.applyUrl, 'https://acme.com/jobs/101');
  console.log('  ✅ Full valid job successfully normalized.');

  console.log('\n▶ Test 2.2: Remotive / missing salary job (Acceptance Test d verification)...');
  const remotiveJob = validateAndNormalizeJob({
    externalId: 'remotive-999',
    sourceProvider: 'remotive',
    title: 'Staff Platform Engineer',
    company: 'Distributed Systems Ltd',
    location: 'Worldwide',
    remote: true,
    // Note: No salaryMin, salaryMax, or salaryCurrency provided
  });

  assert.strictEqual(remotiveJob.externalId, 'remotive-999');
  assert.strictEqual(remotiveJob.sourceProvider, 'remotive');
  assert.strictEqual(remotiveJob.salaryMin, null, 'salaryMin must be null when absent');
  assert.strictEqual(remotiveJob.salaryMax, null, 'salaryMax must be null when absent');
  assert.strictEqual(remotiveJob.salaryCurrency, null, 'salaryCurrency must be null when salary is absent');
  assert.strictEqual(remotiveJob.description, null, 'description must be null when absent');
  assert.strictEqual(remotiveJob.applyUrl, null, 'applyUrl must be null when absent');
  assert.strictEqual(remotiveJob.postedDate, null, 'postedDate must be null when absent');
  console.log('  ✅ Missing fields strictly set to null — NO fabrication or estimation occurred:');
  console.log('     salaryMin:', remotiveJob.salaryMin);
  console.log('     salaryMax:', remotiveJob.salaryMax);
  console.log('     salaryCurrency:', remotiveJob.salaryCurrency);
  console.log('     description:', remotiveJob.description);
  console.log('     applyUrl:', remotiveJob.applyUrl);
  console.log('     postedDate:', remotiveJob.postedDate);

  console.log('\n▶ Test 2.3: Rejecting invalid jobs (missing title or company)...');
  let threwForMissingTitle = false;
  try {
    validateAndNormalizeJob({
      externalId: 'ext-error',
      sourceProvider: 'jsearch',
      title: '', // Empty title
      company: 'Test Corp',
    });
  } catch (err: any) {
    threwForMissingTitle = true;
    console.log('  ✅ Caught expected error for missing title:', err.message);
  }
  assert.ok(threwForMissingTitle, 'Should throw error when title is missing');

  let threwForMissingCompany = false;
  try {
    validateAndNormalizeJob({
      externalId: 'ext-error-2',
      sourceProvider: 'jsearch',
      title: 'DevOps Lead',
      company: '', // Empty company
    });
  } catch (err: any) {
    threwForMissingCompany = true;
    console.log('  ✅ Caught expected error for missing company:', err.message);
  }
  assert.ok(threwForMissingCompany, 'Should throw error when company is missing');

  console.log('\n================================================================');
  console.log('🎉 SCOPE ITEM 2 PASSED: Normalized job schema strictly enforced');
  console.log('================================================================\n');
}

runSchemaTests().catch((err) => {
  console.error('❌ Schema Test Failed:', err);
  process.exit(1);
});
