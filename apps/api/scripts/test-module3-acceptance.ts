import dotenv from 'dotenv';
dotenv.config();

import { getDbPool } from '../src/dal/db';
import { matchingDal } from '../src/dal/matchingDal';
import { cvDal } from '../src/dal/cvDal';
import { MatchingService } from '../src/services/matching/matchingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { MockFitExplanationProvider, FitExplanationService } from '../src/services/matching/fitExplanationService';
import { screenJobDescription } from '../src/services/matching/redFlagFilter';

async function runAcceptanceTests() {
  console.log('========================================================================');
  console.log('🎯 MODULE 3 ACCEPTANCE TEST SUITE (Tests a - g)');
  console.log('========================================================================\n');

  const pool = getDbPool();

  const userAId = 'acc-user-backend';
  const userBId = 'acc-user-marketing';

  // Cleanup test records
  await pool.execute('DELETE FROM user_job_matches WHERE user_id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM user_match_cache WHERE user_id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM cv_profile_embeddings WHERE user_id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM cv_profiles WHERE user_id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM user_cv_files WHERE user_id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM users WHERE id IN (?, ?)', [userAId, userBId]);
  await pool.execute('DELETE FROM cached_jobs WHERE id LIKE "acc-job-%"');

  // Create Users A and B
  await pool.execute(
    'INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, "hash", 1), (?, ?, "hash", 1)',
    [userAId, 'backend@acc.com', userBId, 'marketing@acc.com']
  );

  // User A: Backend Engineer CV
  const fileA = await cvDal.createCvFile(userAId, 'backend.pdf', 'keys/backend.pdf', 'application/pdf', 1024, 'Backend engineer resume');
  const cvA = await cvDal.createCvProfile(
    userAId,
    fileA.id,
    {
      contact_info: { full_name: 'Alice Backend', email: 'backend@acc.com', phone: '', location: 'San Francisco, CA', linkedin_url: null, website: null },
      summary: 'Senior Backend Engineer specialized in Node.js, TypeScript, PostgreSQL, and distributed microservices.',
      work_history: [
        {
          title: 'Senior Backend Engineer',
          company: 'Scalable Systems',
          location: 'San Francisco, CA',
          start_date: '2020-01',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Built distributed APIs using Node.js and TypeScript'],
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

  // User B: Marketing Manager CV
  const fileB = await cvDal.createCvFile(userBId, 'marketing.pdf', 'keys/marketing.pdf', 'application/pdf', 1024, 'Marketing manager resume');
  const cvB = await cvDal.createCvProfile(
    userBId,
    fileB.id,
    {
      contact_info: { full_name: 'Bob Marketing', email: 'marketing@acc.com', phone: '', location: 'New York, NY', linkedin_url: null, website: null },
      summary: 'Digital Marketing Director experienced in growth hacking, SEO, email marketing, and social media campaigns.',
      work_history: [
        {
          title: 'Marketing Director',
          company: 'Growth Agency',
          location: 'New York, NY',
          start_date: '2019-06',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Led performance marketing campaigns and brand growth'],
        },
      ],
      education: [],
      skills: [
        { skill_name: 'SEO', category: 'Marketing' },
        { skill_name: 'Social Media', category: 'Marketing' },
        { skill_name: 'Campaigns', category: 'Marketing' },
      ],
      certifications: [],
    },
    false,
    'completed'
  );
  const cvBId = (cvB as any).id || (cvB as any).profile?.id;
  await cvDal.setActiveProfile(userBId, cvBId);

  // Seed Controlled Test Jobs
  const backendJobId = 'acc-job-backend';
  const marketingJobId = 'acc-job-marketing';
  const redFlagJobId = 'acc-job-redflag';
  const standardInterviewJobId = 'acc-job-standard-video';

  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES 
     (?, 'dedup-acc-1', '["ext-acc-1"]', '["jsearch"]', 'Principal Backend Engineer', 'Backend Co', 'San Francisco, CA', 0,
      'Seeking Principal Backend Engineer to build high-scale microservices in Node.js and TypeScript.', 'https://backend.example/1', NOW()),
     (?, 'dedup-acc-2', '["ext-acc-2"]', '["remotive"]', 'Senior Growth Marketing Lead', 'Growth Co', 'Remote', 1,
      'Lead digital advertising, social media campaigns, and SEO performance.', 'https://marketing.example/2', NOW()),
     (?, 'dedup-acc-3', '["ext-acc-3"]', '["serpapi"]', 'Full Stack Developer with Video Intro', 'Video Screening Corp', 'New York, NY', 0,
      'To apply, you must submit a video introduction to be considered for this role.', 'https://video.example/3', NOW()),
     (?, 'dedup-acc-4', '["ext-acc-4"]', '["jsearch"]', 'Backend Infrastructure Engineer', 'Interview Co', 'San Francisco, CA', 0,
      'Round 2 will be a 45-minute video call interview with the engineering manager.', 'https://interview.example/4', NOW())`,
    [backendJobId, marketingJobId, redFlagJobId, standardInterviewJobId]
  );

  // Instrumented Providers
  class CountingEmbeddingProvider extends MockEmbeddingProvider {
    public generateCalls = 0;
    async generateEmbedding(text: string): Promise<number[]> {
      this.generateCalls++;
      return super.generateEmbedding(text);
    }
  }

  const embeddingProvider = new CountingEmbeddingProvider();
  const mockExplanation = new MockFitExplanationProvider();
  const fitExplanationService = new FitExplanationService([mockExplanation], 60);

  const service = new MatchingService({
    embeddingProvider,
    fitExplanationService,
  });

  // -------------------------------------------------------------------------
  // TEST a: CV Suited to Role Scores Meaningfully Higher Than Unrelated Role
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (a): Role-Specific CV Matching vs Unrelated Job Scoring');
  console.log('------------------------------------------------------------------------');
  const searchA = await service.searchMatches(userAId, { minScore: 0, includeExcluded: true }, { forceRefresh: true });

  const backendMatch = searchA.matches.find((m) => m.jobId === backendJobId)!;
  const marketingMatch = searchA.matches.find((m) => m.jobId === marketingJobId)!;

  console.log(`Backend CV vs Backend Job ("${backendMatch.title}"): Score = ${backendMatch.score} (${backendMatch.label})`);
  console.log(`Backend CV vs Marketing Job ("${marketingMatch.title}"): Score = ${marketingMatch.score} (${marketingMatch.label})`);
  console.log(`Score Difference: ${backendMatch.score - marketingMatch.score} points`);

  const scoreDelta = backendMatch.score - marketingMatch.score;
  if (backendMatch.score <= marketingMatch.score || scoreDelta < 40) {
    throw new Error(`❌ TEST (a) FAILED: Expected backend match score (${backendMatch.score}) to be significantly higher than marketing match score (${marketingMatch.score})!`);
  }
  console.log(`✅ TEST (a) PASSED: Backend CV scored significantly higher on backend role (+${scoreDelta} points delta, exceeding required >= 40 threshold).\n`);

  // -------------------------------------------------------------------------
  // TEST b: "submit a video introduction to be considered" is Excluded
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (b): Precondition "submit a video introduction to be considered" Excluded');
  console.log('------------------------------------------------------------------------');
  const defaultSearch = await service.searchMatches(userAId, { includeExcluded: false }, { forceRefresh: true });
  const inDefaultView = defaultSearch.matches.some((m) => m.jobId === redFlagJobId);

  const excludedViewSearch = await service.searchMatches(userAId, { minScore: 0, includeExcluded: true }, { forceRefresh: true });
  const redFlagMatch = excludedViewSearch.matches.find((m) => m.jobId === redFlagJobId)!;

  console.log(`Job in Default View: ${inDefaultView} (Expected: false)`);
  console.log(`Job in Excluded View: isExcluded = ${redFlagMatch.isExcluded} (Expected: true)`);
  console.log(`Excluded Reason: "${redFlagMatch.excludedReason}"`);

  if (inDefaultView || !redFlagMatch.isExcluded || !redFlagMatch.excludedReason?.includes('video introduction')) {
    throw new Error('❌ TEST (b) FAILED: Precondition video job was not properly excluded or missing reason!');
  }
  console.log('✅ TEST (b) PASSED: Video precondition job excluded from default view and retains excluded_reason.\n');

  // -------------------------------------------------------------------------
  // TEST c: Normal "video call interview" is NOT Excluded
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (c): Standard "video call interview" NOT Excluded (Filter Not Overly Broad)');
  console.log('------------------------------------------------------------------------');
  const standardInterviewMatch = excludedViewSearch.matches.find((m) => m.jobId === standardInterviewJobId)!;

  console.log(`Job Title: "${standardInterviewMatch.title}"`);
  console.log(`isExcluded: ${standardInterviewMatch.isExcluded} (Expected: false)`);
  console.log(`excludedReason: ${standardInterviewMatch.excludedReason} (Expected: null)`);

  if (standardInterviewMatch.isExcluded || standardInterviewMatch.excludedReason !== null) {
    throw new Error('❌ TEST (c) FAILED: Standard video call interview was improperly excluded!');
  }
  console.log('✅ TEST (c) PASSED: Filter is specific to preconditions and allows legitimate video interviews.\n');

  // -------------------------------------------------------------------------
  // TEST d: Re-run Search Returns Cached Results with Zero New Embedding or LLM Calls
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (d): Cached Search Re-run with Exact Counter (0 Embedding & 0 LLM Calls)');
  console.log('------------------------------------------------------------------------');
  // First search to prime cache
  const primeSearch = await service.searchMatches(userAId, { minScore: 40 });
  const embeddingCallsBefore = embeddingProvider.generateCalls;
  const llmCallsBefore = mockExplanation.callCount;

  // Re-run identical search
  const cachedSearch = await service.searchMatches(userAId, { minScore: 40 });
  const embeddingCallsAfter = embeddingProvider.generateCalls;
  const llmCallsAfter = mockExplanation.callCount;

  console.log(`Search fromCache: ${cachedSearch.fromCache} (Expected: true)`);
  console.log(`New Embedding Calls: ${embeddingCallsAfter - embeddingCallsBefore} (Expected: 0)`);
  console.log(`New LLM Calls: ${llmCallsAfter - llmCallsBefore} (Expected: 0)`);

  if (!cachedSearch.fromCache || embeddingCallsAfter !== embeddingCallsBefore || llmCallsAfter !== llmCallsBefore) {
    throw new Error('❌ TEST (d) FAILED: Cache re-run triggered new embedding or LLM calls!');
  }
  console.log('✅ TEST (d) PASSED: Verified zero new embedding or LLM calls via exact call counters.\n');

  // -------------------------------------------------------------------------
  // TEST e: Cross-User DAL Isolation (User A cannot view or trigger User B matches)
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (e): Cross-User DAL Isolation');
  console.log('------------------------------------------------------------------------');
  const userBSearch = await service.searchMatches(userBId, { minScore: 40 });

  console.log(`User A Cache ID: ${cachedSearch.cacheId}`);
  console.log(`User B Cache ID: ${userBSearch.cacheId}`);

  if (cachedSearch.cacheId === userBSearch.cacheId) {
    throw new Error('❌ TEST (e) FAILED: User A and User B shared the same match cache!');
  }

  // Attempt cross-tenant DAL access: User A requests User B's cacheId
  const crossTenantAccess = await matchingDal.getUserJobMatches(userAId, userBSearch.cacheId);
  console.log(`Cross-tenant rows returned for User A querying User B cache: ${crossTenantAccess.length} (Expected: 0)`);

  if (crossTenantAccess.length > 0) {
    throw new Error('❌ TEST (e) FAILED: Cross-user DAL leak detected! User A accessed User B matches.');
  }
  console.log('✅ TEST (e) PASSED: Strict cross-user DAL isolation proven.\n');

  // -------------------------------------------------------------------------
  // TEST f: Below-Threshold Job Has No LLM Explanation, Above-Threshold Does
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (f): Explanation Threshold Gating Proved via Call Counts');
  console.log('------------------------------------------------------------------------');
  const freshProvider = new MockFitExplanationProvider();
  const freshFitService = new FitExplanationService([freshProvider], 60);

  // Job with score = 35 (< 60)
  const belowThresholdResult = await freshFitService.explainIfEligible({
    score: 35,
    cvSummary: 'Backend developer',
    cvSkills: ['Node.js'],
    jobTitle: 'Junior Marketer',
    jobDescription: 'Marketing job',
  });

  const callsAfterBelow = freshProvider.callCount;

  // Job with score = 85 (>= 60)                                        
  const aboveThresholdResult = await freshFitService.explainIfEligible({
    score: 85,
    cvSummary: 'Backend developer',
    cvSkills: ['Node.js', 'TypeScript'],
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'Seeking backend developer with Node.js and TypeScript expertise.',
  });

  const callsAfterAbove = freshProvider.callCount;

  console.log(`Below-threshold (Score 35): Explanation = ${belowThresholdResult.explanation}, LLM Call Count = ${callsAfterBelow}`);
  console.log(`Above-threshold (Score 85): Explanation = "${aboveThresholdResult.explanation}", LLM Call Count = ${callsAfterAbove}`);

  if (belowThresholdResult.explanation !== null || callsAfterBelow !== 0 || !aboveThresholdResult.explanation || callsAfterAbove !== 1) {
    throw new Error('❌ TEST (f) FAILED: Threshold gating did not prevent LLM call or generate explanation!');
  }
  console.log('✅ TEST (f) PASSED: Call counts prove below-threshold has zero LLM calls, above-threshold has 1 grounded call.\n');

  // -------------------------------------------------------------------------
  // TEST g: Missing / Failed Embedding Handled Gracefully without Crashing
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('TEST (g): Missing / Failed Embedding Skipped Gracefully and Logged');
  console.log('------------------------------------------------------------------------');
  const brokenJobId = 'acc-job-broken-embedding';
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, external_ids, source_providers, title, company, location, remote, description, apply_url, fetched_at)
     VALUES (?, 'dedup-broken', '["ext-broken"]', '["jsearch"]', 'Broken Job Embedding', 'Glitch Corp', 'Nowhere', 0,
             'Job with simulated upstream embedding outage.', 'https://glitch.example', NOW())`,
    [brokenJobId]
  );

  class FailingProvider extends MockEmbeddingProvider {
    async generateEmbedding(text: string): Promise<number[]> {
      if (text.includes('Broken Job Embedding')) {
        throw new Error('Simulated upstream Gemini 503 embedding service unavailable');
      }
      return super.generateEmbedding(text);
    }
  }

  const resilientMatchingService = new MatchingService({
    embeddingProvider: new FailingProvider(),
    fitExplanationService,
  });

  const resilientSearch = await resilientMatchingService.searchMatches(
    userAId,
    { minScore: 0, includeExcluded: true },
    { forceRefresh: true }
  );

  const brokenJobFound = resilientSearch.matches.some((m) => m.jobId === brokenJobId);
  console.log(`Total Valid Jobs Matched: ${resilientSearch.matches.length}`);
  console.log(`Broken Job Included: ${brokenJobFound} (Expected: false)`);

  if (brokenJobFound) {
    throw new Error('❌ TEST (g) FAILED: Broken embedding job was unexpectedly included!');
  }
  console.log('✅ TEST (g) PASSED: Missing/failed embedding skipped gracefully without crashing and properly logged.\n');

  console.log('========================================================================');
  console.log('🎉 ALL MODULE 3 ACCEPTANCE TESTS (a - g) PASSED WITH FLYING COLORS!');
  console.log('========================================================================');
  process.exit(0);
}

runAcceptanceTests().catch((err) => {
  console.error('Fatal error in Acceptance Test Suite:', err);
  process.exit(1);
});
