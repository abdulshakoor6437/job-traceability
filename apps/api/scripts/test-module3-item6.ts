import dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../src/dal/db';
import { matchingDal } from '../src/dal/matchingDal';
import { cvDal } from '../src/dal/cvDal';
import { MatchingService } from '../src/services/matching/matchingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { MockFitExplanationProvider, FitExplanationService } from '../src/services/matching/fitExplanationService';

async function run() {
  console.log('========================================================================');
  console.log('🧪 MODULE 3 ITEM 6 TEST: MATCH RESULTS CACHING & INVALIDATION');
  console.log('========================================================================\n');

  const pool = getDbPool();

  const userId = 'test-cache-user-1';

  // Cleanup
  await pool.execute('DELETE FROM user_job_matches WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM user_match_cache WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM cv_profile_embeddings WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM cv_profiles WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM user_cv_files WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
  await pool.execute('DELETE FROM cached_jobs WHERE id LIKE "cache-job-%"');

  // Create User
  await pool.execute(
    'INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, "hash", 1)',
    [userId, 'cacheuser@example.com']
  );

  // Create CV File & Profile 1
  const file1 = await cvDal.createCvFile(userId, 'cv1.pdf', 'keys/cv1.pdf', 'application/pdf', 1024, 'Backend engineer resume');
  const cv1 = await cvDal.createCvProfile(
    userId,
    file1.id,
    {
      contact_info: { full_name: 'Cache Tester', email: 'cacheuser@example.com', phone: '', location: 'Remote', linkedin_url: null, website: null },
      summary: 'Backend Engineer specializing in Node.js and TypeScript APIs.',
      work_history: [
        {
          title: 'Backend Engineer',
          company: 'Cloud Corp',
          location: 'Remote',
          start_date: '2022-01',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Built Node.js microservices with PostgreSQL'],
        },
      ],
      education: [],
      skills: [{ skill_name: 'Node.js', category: 'Backend' }, { skill_name: 'TypeScript', category: 'Languages' }],
      certifications: [],
    },
    false,
    'completed'
  );
  const cv1Id = (cv1 as any).id || (cv1 as any).profile?.id;
  await cvDal.setActiveProfile(userId, cv1Id);

  // Seed two jobs
  const job1Id = 'cache-job-backend-1';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-cache1', '["ext-c1"]', '["jsearch"]', 'Backend Developer Node.js', 'Cache Labs', 'Remote', 1,
             'Seeking Node.js and TypeScript developer.', 'https://cache.example/1', NOW())`,
    [job1Id]
  );

  // Instrument providers with call counters
  class CountingEmbeddingProvider extends MockEmbeddingProvider {
    public generateCalls = 0;
    async generateEmbedding(text: string): Promise<number[]> {
      this.generateCalls++;
      return super.generateEmbedding(text);
    }
  }

  const countingEmbedding = new CountingEmbeddingProvider();
  const mockExplanation = new MockFitExplanationProvider();
  const fitService = new FitExplanationService([mockExplanation], 60);

  const testMatchingService = new MatchingService({
    embeddingProvider: countingEmbedding,
    fitExplanationService: fitService,
  });

  console.log('1️⃣ Initial Search (Cache Miss)...');
  const initialResult = await testMatchingService.searchMatches(userId, { minScore: 40 });
  console.log(`   - fromCache: ${initialResult.fromCache}`);
  console.log(`   - Matches count: ${initialResult.matches.length}`);
  console.log(`   - Embedding generate calls: ${countingEmbedding.generateCalls}`);
  console.log(`   - LLM Explanation calls: ${mockExplanation.callCount}`);

  if (initialResult.fromCache !== false) {
    throw new Error('❌ FAILED: Initial search was unexpectedly marked as fromCache!');
  }
  const callsAfterInitialEmbedding = countingEmbedding.generateCalls;
  const callsAfterInitialLlm = mockExplanation.callCount;

  console.log('\n2️⃣ Acceptance Test (d): Re-running search with NO changes (Cache Hit)...');
  const cachedResult = await testMatchingService.searchMatches(userId, { minScore: 40 });
  console.log(`   - fromCache: ${cachedResult.fromCache}`);
  console.log(`   - Matches count: ${cachedResult.matches.length}`);
  console.log(`   - Embedding generate calls: ${countingEmbedding.generateCalls} (delta = ${countingEmbedding.generateCalls - callsAfterInitialEmbedding})`);
  console.log(`   - LLM Explanation calls: ${mockExplanation.callCount} (delta = ${mockExplanation.callCount - callsAfterInitialLlm})`);

  if (cachedResult.fromCache !== true) {
    throw new Error('❌ ACCEPTANCE TEST (d) FAILED: Re-run search did not hit cache!');
  }
  if (countingEmbedding.generateCalls !== callsAfterInitialEmbedding) {
    throw new Error(`❌ ACCEPTANCE TEST (d) FAILED: Embedding provider called during cache hit! Calls: ${countingEmbedding.generateCalls - callsAfterInitialEmbedding}`);
  }
  if (mockExplanation.callCount !== callsAfterInitialLlm) {
    throw new Error(`❌ ACCEPTANCE TEST (d) FAILED: LLM provider called during cache hit! Calls: ${mockExplanation.callCount - callsAfterInitialLlm}`);
  }
  console.log('   ✅ ACCEPTANCE TEST (d) PASSED: Zero new embedding or LLM calls on cached search!\n');

  console.log('3️⃣ Testing Invalidation when Active CV Profile Changes...');
  // Create Profile 2 and activate it
  const file2 = await cvDal.createCvFile(userId, 'cv2.pdf', 'keys/cv2.pdf', 'application/pdf', 1024, 'Fullstack resume');
  const cv2 = await cvDal.createCvProfile(
    userId,
    file2.id,
    {
      contact_info: { full_name: 'Cache Tester v2', email: 'cacheuser@example.com', phone: '', location: 'Remote', linkedin_url: null, website: null },
      summary: 'Fullstack Engineer with React and Node.js.',
      work_history: [],
      education: [],
      skills: [{ skill_name: 'React', category: 'Frontend' }, { skill_name: 'Node.js', category: 'Backend' }],
      certifications: [],
    },
    false,
    'completed'
  );
  const cv2Id = (cv2 as any).id || (cv2 as any).profile?.id;
  await cvDal.setActiveProfile(userId, cv2Id);

  // Search again: cache should be invalidated
  const invalidatedCvResult = await testMatchingService.searchMatches(userId, { minScore: 40 });
  console.log(`   - fromCache: ${invalidatedCvResult.fromCache} (Expected: false)`);
  console.log(`   - Active CV Profile ID: ${invalidatedCvResult.cvProfileId} (Expected: ${cv2Id})`);

  if (invalidatedCvResult.fromCache !== false || invalidatedCvResult.cvProfileId !== cv2Id) {
    throw new Error('❌ FAILED: Search after active CV profile change was not invalidated!');
  }
  console.log('   ✅ PASSED: Active CV profile change invalidated cache and recomputed matches.\n');

  console.log('4️⃣ Testing Invalidation when Job Pool Refreshes...');
  // Ensure search is now cached for CV 2
  const cv2Cached = await testMatchingService.searchMatches(userId, { minScore: 40 });
  if (!cv2Cached.fromCache) {
    throw new Error('❌ FAILED: Expected CV 2 second search to hit cache.');
  }
  console.log('   - CV 2 search cached successfully (fromCache: true).');

  // Insert a new job into cached_jobs (refreshes job pool)
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at, updated_at)
     VALUES ('cache-job-new-1', 'dedup-cache2', '["ext-c2"]', '["remotive"]', 'Senior React Architect', 'Job Pool Refresh Inc', 'Remote', 1,
             'Expert React and TypeScript frontend architect.', 'https://cache.example/2', NOW(), NOW())`
  );

  // Run search again: job pool version has changed, must invalidate and recompute!
  const refreshedPoolResult = await testMatchingService.searchMatches(userId, { minScore: 40 });
  console.log(`   - fromCache: ${refreshedPoolResult.fromCache} (Expected: false)`);
  console.log(`   - New Job Pool Version: ${refreshedPoolResult.jobPoolVersion}`);

  if (refreshedPoolResult.fromCache !== false) {
    throw new Error('❌ FAILED: Job pool refresh failed to invalidate match cache!');
  }
  console.log('   ✅ PASSED: Job pool refresh automatically invalidated match cache and re-ranked!\n');

  console.log('========================================================================');
  console.log('🎉 MODULE 3 ITEM 6 TESTS PASSED PERFECTLY!');
  console.log('========================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error in Item 6 test:', err);
  process.exit(1);
});
