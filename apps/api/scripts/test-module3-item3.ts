import assert from 'assert';
import { screenJobDescription } from '../src/services/matching/redFlagFilter';
import { MATCHING_CONFIG } from '../src/services/matching/matchingConfig';

async function testItem3() {
  console.log('\n========================================================================');
  console.log('🧪 MODULE 3 ITEM 3 TEST: RED-FLAG FILTER & PRECONDITION EXCLUSION');
  console.log('========================================================================\n');

  // 1. Verify Config-driven architecture (not hardcoded)
  console.log('1️⃣ Verifying Red-Flag Rule Configuration...');
  assert.ok(Array.isArray(MATCHING_CONFIG.redFlagPhrases));
  assert.ok(MATCHING_CONFIG.redFlagPhrases.length >= 5);
  console.log(`   Configured Rules Count: ${MATCHING_CONFIG.redFlagPhrases.length}`);
  for (const r of MATCHING_CONFIG.redFlagPhrases.slice(0, 5)) {
    console.log(`   • Phrase: "${r.phrase}" -> Reason: "${r.reason}"`);
  }
  console.log('   ✅ Rules defined in config object, verified configurable.');

  // 2. Acceptance Test (b): "submit a video introduction to be considered"
  console.log('\n2️⃣ Testing Acceptance Test (b): Mandatory Video Introduction Precondition...');
  const redFlagJobDesc = `
    About the Role:
    We are looking for a Senior Full Stack Engineer.
    Application Instructions:
    To apply, submit your resume and submit a video introduction to be considered for this role.
    Candidates without a video introduction will not be reviewed.
  `;
  const resB = screenJobDescription(redFlagJobDesc);
  assert.strictEqual(resB.isExcluded, true, 'Job with video introduction precondition must be excluded');
  assert.ok(resB.excludedReason, 'Must provide excludedReason');
  assert.ok(resB.excludedReason.toLowerCase().includes('video introduction'));
  console.log(`   - Is Excluded:    ${resB.isExcluded}`);
  console.log(`   - Excluded Reason: "${resB.excludedReason}"`);
  console.log(`   - Matched Phrase: "${resB.matchedPhrase}"`);
  console.log('   ✅ ACCEPTANCE TEST (b) PASSED: Precondition video introduction excluded with reason.');

  // 3. Acceptance Test (c): Normal "video call interview" is NOT excluded
  console.log('\n3️⃣ Testing Acceptance Test (c): Normal "Video Call Interview" Must NOT Be Excluded...');
  const normalJobDesc = `
    About Acme Corp:
    We are hiring a Backend Engineer to build scalable microservices in Node.js and TypeScript.
    
    Interview Process:
    1. Initial 30-minute recruiter phone screen
    2. 45-minute technical video call interview with the engineering manager
    3. Final round video conference with the team to discuss past architecture projects
    
    Apply today with your CV!
  `;
  const resC = screenJobDescription(normalJobDesc);
  assert.strictEqual(resC.isExcluded, false, 'Standard video call interview must NOT be excluded');
  assert.strictEqual(resC.excludedReason, null);
  console.log(`   - Is Excluded:    ${resC.isExcluded} (Expected false)`);
  console.log(`   - Excluded Reason: ${resC.excludedReason} (Expected null)`);
  console.log('   ✅ ACCEPTANCE TEST (c) PASSED: Filter is not overly broad; standard video calls allowed.');

  // 4. Test Other Mandatory Preconditions (Selfie, Face Recognition, Video Resume)
  console.log('\n4️⃣ Testing Other Face / Selfie / Asynchronous Video Preconditions...');
  const otherCases = [
    {
      desc: 'All candidates must complete a video resume before their application is considered.',
      expectedPhrase: 'video resume',
    },
    {
      desc: 'Our hiring portal uses selfie verification to confirm candidate identity during testing.',
      expectedPhrase: 'selfie verification',
    },
    {
      desc: 'Automated facial recognition is used to monitor technical assessments.',
      expectedPhrase: 'facial recognition',
    },
    {
      desc: 'Stage 1 consists of an automated ai video screening interview.',
      expectedPhrase: 'ai video screening',
    },
    {
      desc: 'Candidates are required to record a video interview answering 5 prompt questions.',
      expectedPhrase: 'record a video interview',
    },
  ];

  for (const c of otherCases) {
    const res = screenJobDescription(c.desc);
    assert.strictEqual(res.isExcluded, true, `Should exclude for phrase: ${c.expectedPhrase}`);
    assert.strictEqual(res.matchedPhrase, c.expectedPhrase);
    console.log(`   • Matched: "${res.matchedPhrase}" -> Excluded Reason: "${res.excludedReason}"`);
  }
  console.log('   ✅ All red-flag variations detected accurately.');

  console.log('\n========================================================================');
  console.log('🎉 MODULE 3 ITEM 3 TESTS PASSED PERFECTLY!');
  console.log('========================================================================\n');
  process.exit(0);
}

testItem3().catch((err) => {
  console.error('❌ Item 3 test failed:', err);
  process.exit(1);
});
