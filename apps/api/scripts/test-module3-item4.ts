import dotenv from 'dotenv';
dotenv.config();

import {
  FitExplanationService,
  MockFitExplanationProvider,
} from '../src/services/matching/fitExplanationService';

async function run() {
  console.log('========================================================================');
  console.log('🧪 MODULE 3 ITEM 4 TEST: LLM FIT EXPLANATION & THRESHOLD GATING');
  console.log('========================================================================\n');

  const mockProvider = new MockFitExplanationProvider();
  const service = new FitExplanationService([mockProvider], 60);

  const cvSummary = 'Senior Backend Engineer with 6 years building distributed systems and high-throughput APIs.';
  const cvSkills = ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Redis'];

  console.log('1️⃣ Testing Below-Threshold Gating (Score = 55 < 60 Threshold)...');
  const belowResult = await service.explainIfEligible({
    score: 55,
    cvSummary,
    cvSkills,
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'Build high-performance REST APIs in Node.js and TypeScript with Redis caching.',
  });

  console.log('   - Explanation:', belowResult.explanation);
  console.log('   - Generated Flag:', belowResult.generated);
  console.log('   - Provider Calls:', mockProvider.callCount);

  if (belowResult.explanation !== null || belowResult.generated !== false || mockProvider.callCount !== 0) {
    throw new Error('❌ FAILED: Below-threshold job triggered LLM call or generated explanation!');
  }
  console.log('   ✅ PASSED: Zero LLM calls made for below-threshold score.\n');

  console.log('2️⃣ Testing Above-Threshold Gating (Score = 85 >= 60 Threshold)...');
  const aboveResult = await service.explainIfEligible({
    score: 85,
    cvSummary,
    cvSkills,
    jobTitle: 'Staff Backend Engineer',
    jobDescription: 'Lead backend microservices in Node.js, TypeScript, and Docker.',
  });

  console.log('   - Explanation:', aboveResult.explanation);
  console.log('   - Generated Flag:', aboveResult.generated);
  console.log('   - Provider Used:', aboveResult.provider);
  console.log('   - Provider Calls:', mockProvider.callCount);

  if (!aboveResult.explanation || aboveResult.generated !== true || (mockProvider.callCount as number) !== 1) {
    throw new Error('❌ FAILED: Above-threshold job failed to generate explanation or increment counter!');
  }
  // Verify groundedness
  const mentionsRealSkill = cvSkills.some((s) => aboveResult.explanation!.includes(s));
  if (!mentionsRealSkill) {
    throw new Error('❌ FAILED: Explanation is not grounded in actual CV skills!');
  }
  console.log('   ✅ PASSED: Grounded explanation generated with exact call count = 1.\n');

  console.log('3️⃣ Testing Multi-Provider Fallback Chain...');
  const failingProvider = new MockFitExplanationProvider(true); // throws
  const backupProvider = new MockFitExplanationProvider(false);
  const fallbackService = new FitExplanationService([failingProvider, backupProvider], 60);

  const fallbackResult = await fallbackService.explainIfEligible({
    score: 90,
    cvSummary,
    cvSkills,
    jobTitle: 'Principal Engineer',
    jobDescription: 'Hands-on architectural leadership with TypeScript and distributed systems.',
  });

  console.log('   - Failing provider call count:', failingProvider.callCount);
  console.log('   - Backup provider call count:', backupProvider.callCount);
  console.log('   - Result Provider:', fallbackResult.provider);
  console.log('   - Result Explanation:', fallbackResult.explanation);

  if (failingProvider.callCount !== 1 || backupProvider.callCount !== 1 || fallbackResult.provider !== 'mock_explanation') {
    throw new Error('❌ FAILED: Multi-provider fallback chain failed!');
  }
  console.log('   ✅ PASSED: Multi-provider fallback chain succeeded seamlessly.\n');

  console.log('4️⃣ Acceptance Test (f) Verification: Call Counts Comparison...');
  const testFProvider = new MockFitExplanationProvider();
  const testFService = new FitExplanationService([testFProvider], 60);

  // Job 1: Score 38 (below threshold)
  const job1Result = await testFService.explainIfEligible({
    score: 38,
    cvSummary,
    cvSkills,
    jobTitle: 'Junior Social Media Manager',
    jobDescription: 'Create engaging social media campaigns and TikTok videos.',
  });

  const callsAfterJob1 = testFProvider.callCount;

  // Job 2: Score 82 (above threshold)
  const job2Result = await testFService.explainIfEligible({
    score: 82,
    cvSummary,
    cvSkills,
    jobTitle: 'Senior TypeScript Developer',
    jobDescription: 'Develop backend Node.js microservices with Docker and PostgreSQL.',
  });

  const callsAfterJob2 = testFProvider.callCount;

  console.log(`   - Job 1 (Score 38 < 60): Explanation = ${job1Result.explanation}, LLM Call Count = ${callsAfterJob1}`);
  console.log(`   - Job 2 (Score 82 >= 60): Explanation = "${job2Result.explanation}", LLM Call Count = ${callsAfterJob2}`);

  if (callsAfterJob1 !== 0 || callsAfterJob2 !== 1) {
    throw new Error(`❌ ACCEPTANCE TEST (f) FAILED: Expected 0 calls after job 1 and 1 call after job 2, got ${callsAfterJob1} and ${callsAfterJob2}`);
  }
  console.log('   ✅ ACCEPTANCE TEST (f) PASSED: Exact counter proves 0 calls for below threshold, 1 for above threshold.\n');

  console.log('========================================================================');
  console.log('🎉 MODULE 3 ITEM 4 TESTS PASSED PERFECTLY!');
  console.log('========================================================================');
}

run().catch((err) => {
  console.error('Fatal error in Item 4 test:', err);
  process.exit(1);
});
