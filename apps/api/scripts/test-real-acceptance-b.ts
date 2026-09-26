import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { jobDal } from '../src/dal/jobDal';
import { JobSearchService } from '../src/services/job/jobSearchService';
import { JSearchProvider } from '../src/services/job/providers/jsearchProvider';
import { SerpApiProvider } from '../src/services/job/providers/serpApiProvider';
import { RemotiveProvider } from '../src/services/job/providers/remotiveProvider';

async function testAcceptanceB() {
  console.log('\n========================================================================');
  console.log('🔍 LIVE ACCEPTANCE TEST (b): CROSS-PROVIDER DEDUPLICATION CHECK');
  console.log('========================================================================\n');

  await jobDal.resetAllForTesting();

  const jsearch = new JSearchProvider();
  const serp = new SerpApiProvider();
  const remotive = new RemotiveProvider();

  const service = new JobSearchService([jsearch, serp, remotive]);

  // Query 1: Broad popular query
  const query1 = 'software engineer';
  const loc1 = 'New York';
  console.log(`[QUERY 1] Searching for: "${query1}" in "${loc1}"...`);
  const t0 = Date.now();
  const res1 = await service.searchJobs({ query: query1, location: loc1, ttlHours: 8 });
  console.log(`Completed in ${Date.now() - t0} ms.`);
  console.log(`Providers queried: ${JSON.stringify(res1.providersQueried)}`);
  console.log(`Providers skipped/failed: ${JSON.stringify(res1.skippedProviders)}`);
  console.log(`Total normalized jobs returned: ${res1.jobs.length}`);

  const crossProviderDups1 = res1.jobs.filter((j) => (j.sourceProviders || []).length > 1);
  console.log(`Cross-provider duplicates found in Query 1: ${crossProviderDups1.length}`);

  if (crossProviderDups1.length > 0) {
    console.log('\n✨ GENUINE CROSS-PROVIDER DUPLICATE FOUND in Query 1:');
    for (const dup of crossProviderDups1) {
      console.log(JSON.stringify(dup, null, 2));
    }
  } else {
    console.log('No cross-provider duplicate detected in Query 1.');
    console.log('Per instructions: trying one more query before concluding...\n');

    // Query 2: Another popular query
    const query2 = 'python developer';
    const loc2 = 'San Francisco';
    console.log(`[QUERY 2] Searching for: "${query2}" in "${loc2}"...`);
    const t1 = Date.now();
    const res2 = await service.searchJobs({ query: query2, location: loc2, ttlHours: 8 });
    console.log(`Completed in ${Date.now() - t1} ms.`);
    console.log(`Providers queried: ${JSON.stringify(res2.providersQueried)}`);
    console.log(`Providers skipped/failed: ${JSON.stringify(res2.skippedProviders)}`);
    console.log(`Total normalized jobs returned: ${res2.jobs.length}`);

    const crossProviderDups2 = res2.jobs.filter((j) => (j.sourceProviders || []).length > 1);
    console.log(`Cross-provider duplicates found in Query 2: ${crossProviderDups2.length}`);

    if (crossProviderDups2.length > 0) {
      console.log('\n✨ GENUINE CROSS-PROVIDER DUPLICATE FOUND in Query 2:');
      for (const dup of crossProviderDups2) {
        console.log(JSON.stringify(dup, null, 2));
      }
    } else {
      console.log('\nHonest Report: No cross-provider duplicate appeared in either query between the three active providers (JSearch, SerpApi, Remotive returned distinct listings).');
    }
  }

  process.exit(0);
}

testAcceptanceB().catch((err) => {
  console.error('Acceptance (b) error:', err);
  process.exit(1);
});
