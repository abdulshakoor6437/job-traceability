import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { getDbPool } from '../src/dal/db';
import { matchingDal } from '../src/dal/matchingDal';
import { cvDal } from '../src/dal/cvDal';
import { MatchingService } from '../src/services/matching/matchingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { MockFitExplanationProvider, FitExplanationService } from '../src/services/matching/fitExplanationService';

async function run() {
  console.log('========================================================================');
  console.log('🧪 MODULE 3 ITEM 5 TEST: POST /api/matches/search & CROSS-USER ISOLATION');
  console.log('========================================================================\n');

  const pool = getDbPool();

  // Clean test tables
  await pool.execute('DELETE FROM user_job_matches');
  await pool.execute('DELETE FROM user_match_cache');
  await pool.execute('DELETE FROM cv_profile_embeddings');
  await pool.execute('DELETE FROM job_embeddings');
  await pool.execute('DELETE FROM cv_profiles WHERE user_id LIKE "test-match-%"');
  await pool.execute('DELETE FROM user_cv_files WHERE user_id LIKE "test-match-%"');
  await pool.execute('DELETE FROM users WHERE id LIKE "test-match-%"');
  await pool.execute('DELETE FROM cached_jobs WHERE id LIKE "job-item5-%"');

  const userAId = 'test-match-user-a';
  const userBId = 'test-match-user-b';

  // 1. Create Users A and B
  await pool.execute(
    'INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, "hash", 1), (?, ?, "hash", 1)',
    [userAId, 'usera@example.com', userBId, 'userb@example.com']
  );

  // 2. Create Active CV Profile for User A (Backend Engineer)
  const fileA = await cvDal.createCvFile(userAId, 'alice_cv.pdf', 'keys/alice.pdf', 'application/pdf', 1024, 'Backend developer resume');
  const cvA = await cvDal.createCvProfile(
    userAId,
    fileA.id,
    {
      contact_info: { full_name: 'Alice Backend', email: 'alice@example.com', phone: '', location: 'San Francisco, CA', linkedin_url: null, website: null },
      summary: 'Senior Backend Engineer specialized in Node.js, TypeScript, PostgreSQL, and distributed microservices.',
      work_history: [
        {
          title: 'Senior Backend Engineer',
          company: 'Cloud Scale Inc',
          location: 'San Francisco, CA',
          start_date: '2021-01',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Built distributed backend APIs using Node.js, TypeScript, and Redis'],
        },
      ],
      education: [],
      skills: [
        { skill_name: 'Node.js', category: 'Backend' },
        { skill_name: 'TypeScript', category: 'Languages' },
        { skill_name: 'PostgreSQL', category: 'Database' },
      ],
      certifications: [],
    },
    false,
    'completed'
  );
  const cvAId = (cvA as any).id || (cvA as any).profile?.id;
  await cvDal.setActiveProfile(userAId, cvAId);

  // 3. Create Active CV Profile for User B (Marketing Manager)
  const fileB = await cvDal.createCvFile(userBId, 'bob_cv.pdf', 'keys/bob.pdf', 'application/pdf', 1024, 'Marketing lead resume');
  const cvB = await cvDal.createCvProfile(
    userBId,
    fileB.id,
    {
      contact_info: { full_name: 'Bob Marketer', email: 'bob@example.com', phone: '', location: 'New York, NY', linkedin_url: null, website: null },
      summary: 'Growth Marketing Lead with experience running SEO, paid ad campaigns, content marketing, and brand strategy.',
      work_history: [
        {
          title: 'Head of Growth',
          company: 'Acquisition Co',
          location: 'New York, NY',
          start_date: '2020-05',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Led performance marketing campaigns and brand outreach'],
        },
      ],
      education: [],
      skills: [
        { skill_name: 'Growth Marketing', category: 'Marketing' },
        { skill_name: 'SEO', category: 'Marketing' },
        { skill_name: 'Content Strategy', category: 'Marketing' },
      ],
      certifications: [],
    },
    false,
    'completed'
  );
  const cvBId = (cvB as any).id || (cvB as any).profile?.id;
  await cvDal.setActiveProfile(userBId, cvBId);

  // 4. Seed Cached Jobs
  // Job 1: Backend Engineer (Normal)
  const job1Id = 'job-item5-backend-1';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-job1', '["ext-1"]', '["jsearch"]', 'Senior Node.js Backend Engineer', 'Tech Stack Ltd', 'San Francisco, CA', 0,
             'We are hiring a backend engineer with Node.js and TypeScript experience.', 'https://tech.example/apply', NOW())`,
    [job1Id]
  );

  // Job 2: Growth Marketing (Normal)
  const job2Id = 'job-item5-marketing-1';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-job2', '["ext-2"]', '["remotive"]', 'Digital Growth Marketing Manager', 'AdVenture Inc', 'Remote', 1,
             'Manage paid search campaigns and performance marketing strategies.', 'https://ad.example/apply', NOW())`,
    [job2Id]
  );

  // Job 3: Video Precondition Job (Red Flag Excluded)
  const job3Id = 'job-item5-video-excluded';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-job3', '["ext-3"]', '["serpapi"]', 'Full Stack Engineer', 'VideoScreen Co', 'New York, NY', 0,
             'You must submit a video introduction to be considered for this position.', 'https://video.example/apply', NOW())`,
    [job3Id]
  );

  // Configure isolated test service with mock embedding and explanation providers
  const mockEmbedding = new MockEmbeddingProvider();
  const mockExplanation = new MockFitExplanationProvider();
  const fitService = new FitExplanationService([mockExplanation], 60);

  const testMatchingService = new MatchingService({
    embeddingProvider: mockEmbedding,
    fitExplanationService: fitService,
  });

  console.log('1️⃣ Testing User A Search (Default View: excludes red-flags and scores < 40)...');
  const userAResult = await testMatchingService.searchMatches(userAId, {
    minScore: 40,
    includeExcluded: false,
  });

  console.log(`   - Matches returned: ${userAResult.matches.length}`);
  console.log(`   - Cache ID: ${userAResult.cacheId}`);
  console.log(`   - From Cache: ${userAResult.fromCache}`);

  for (const m of userAResult.matches) {
    console.log(`     • [Rank ${m.rankOrder}] ${m.title} | Score: ${m.score} (${m.label}) | Excluded: ${m.isExcluded}`);
    if (m.explanation) {
      console.log(`       Fit Explanation: "${m.explanation}"`);
    }
  }

  // Verify top match for Backend CV is the backend job
  if (userAResult.matches.length === 0 || userAResult.matches[0].jobId !== job1Id) {
    throw new Error('❌ FAILED: User A top match is not the backend job!');
  }
  // Verify red-flag job is excluded from default view
  const hasExcludedInDefault = userAResult.matches.some((m) => m.jobId === job3Id);
  if (hasExcludedInDefault) {
    throw new Error('❌ FAILED: Red-flag job appeared in default search results!');
  }
  console.log('   ✅ PASSED: Backend CV matches backend job top-ranked, excluded job hidden.\n');

  console.log('2️⃣ Testing Excluded View for User A (includeExcluded: true)...');
  const userAExcludedResult = await testMatchingService.searchMatches(
    userAId,
    { minScore: 0, includeExcluded: true, limit: 500 },
    { forceRefresh: true }
  );

  console.log(`   - Total matches returned in excluded view: ${userAExcludedResult.matches.length}`);
  const excludedJobMatch = userAExcludedResult.matches.find((m) => m.jobId === job3Id);
  if (!excludedJobMatch) {
    console.log('   All returned job IDs:', userAExcludedResult.matches.map((m) => m.jobId));
    throw new Error('❌ FAILED: Excluded job not found in excluded view!');
  }
  if (!excludedJobMatch.isExcluded || !excludedJobMatch.excludedReason) {
    console.log('   Job match details:', excludedJobMatch);
    throw new Error('❌ FAILED: Excluded job missing isExcluded or excludedReason!');
  }
  console.log(`   - Excluded Job Found: "${excludedJobMatch.title}"`);
  console.log(`   - Is Excluded: ${excludedJobMatch.isExcluded}`);
  console.log(`   - Excluded Reason: "${excludedJobMatch.excludedReason}"`);
  console.log('   ✅ PASSED: Excluded jobs visible with reason when includeExcluded = true.\n');

  console.log('3️⃣ Acceptance Test (e): Cross-User DAL Isolation Verification...');
  // A. User A cannot view User B's cache
  const userBCache = await matchingDal.getUserMatchCache(userBId, cvBId, userAResult.jobPoolVersion, 'dummy');
  // Attempting to query User B's cache with User A's identity must return empty array
  const crossUserAccess = await matchingDal.getUserJobMatches(userAId, userAResult.cacheId);
  for (const m of crossUserAccess) {
    if (m.user_id !== userAId) {
      throw new Error(`❌ ACCEPTANCE TEST (e) FAILED: User A accessed rows belonging to ${m.user_id}!`);
    }
  }

  // B. Run User B's search and confirm isolation
  const userBResult = await testMatchingService.searchMatches(userBId, { minScore: 40 });
  console.log(`   - User A Cache ID: ${userAResult.cacheId}`);
  console.log(`   - User B Cache ID: ${userBResult.cacheId}`);

  if (userAResult.cacheId === userBResult.cacheId) {
    throw new Error('❌ ACCEPTANCE TEST (e) FAILED: User A and User B shared the same match cache!');
  }

  // Verify User B's top match is Marketing job
  if (userBResult.matches.length === 0 || userBResult.matches[0].jobId !== job2Id) {
    throw new Error('❌ FAILED: User B top match is not the marketing job!');
  }

  // Cross-tenant check: Query User B's cache using User A's ID
  const illegalRows = await matchingDal.getUserJobMatches(userAId, userBResult.cacheId);
  if (illegalRows.length > 0) {
    throw new Error('❌ ACCEPTANCE TEST (e) FAILED: User A was able to read User B cache!');
  }
  console.log('   ✅ ACCEPTANCE TEST (e) PASSED: Cross-user DAL isolation strictly enforced.\n');

  console.log('4️⃣ Acceptance Test (g): Missing / Failed Embedding Skipped Gracefully...');
  // Add a job with an intentionally corrupt embedding or fail the provider
  const failingJobId = 'job-item5-broken-embedding';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-fail', '["ext-fail"]', '["jsearch"]', 'Corrupt Embedding Job', 'Broken Corp', 'Nowhere', 0,
             'This job will fail during embedding generation.', 'https://fail.example', NOW())`,
    [failingJobId]
  );

  // Subclass mock embedding to throw specifically on this job
  class FailingJobEmbeddingProvider extends MockEmbeddingProvider {
    async generateEmbedding(text: string): Promise<number[]> {
      if (text.includes('Corrupt Embedding Job')) {
        throw new Error('Simulated upstream Gemini 500 embedding failure');
      }
      return super.generateEmbedding(text);
    }
  }

  const resilientService = new MatchingService({
    embeddingProvider: new FailingJobEmbeddingProvider(),
    fitExplanationService: fitService,
  });

  // Must not throw or crash!
  const resilientResult = await resilientService.searchMatches(
    userAId,
    { minScore: 0, includeExcluded: true },
    { forceRefresh: true }
  );

  const brokenJobPresent = resilientResult.matches.some((m) => m.jobId === failingJobId);
  if (brokenJobPresent) {
    throw new Error('❌ FAILED: Broken embedding job was unexpectedly included!');
  }
  console.log('   - Total valid jobs matched:', resilientResult.matches.length);
  console.log('   ✅ ACCEPTANCE TEST (g) PASSED: Matching skipped failed job embedding gracefully without crashing.\n');

  console.log('========================================================================');
  console.log('🎉 MODULE 3 ITEM 5 TESTS PASSED PERFECTLY!');
  console.log('========================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal error in Item 5 test:', err);
  process.exit(1);
});
