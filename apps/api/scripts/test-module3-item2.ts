import assert from 'assert';
import {
  computeCosineSimilarity,
  convertCosineToScore,
  getMatchLabel,
  isScoreExcludedByDefault,
} from '../src/services/matching/cosineSimilarity';

async function testItem2() {
  console.log('\n========================================================================');
  console.log('🧪 MODULE 3 ITEM 2 TEST: COSINE SIMILARITY & QUALITATIVE SCORING');
  console.log('========================================================================\n');

  // 1. Math precision & edge cases
  console.log('1️⃣ Testing Vector Cosine Similarity Formulas...');
  const vIdenticalA = [1, 2, 3, 4];
  const vIdenticalB = [1, 2, 3, 4];
  const simIdentical = computeCosineSimilarity(vIdenticalA, vIdenticalB);
  assert.strictEqual(Math.round(simIdentical * 1000) / 1000, 1.0);
  assert.strictEqual(convertCosineToScore(simIdentical), 100);
  assert.strictEqual(getMatchLabel(100), 'Strong match');
  console.log(`   - Identical vectors cosine: ${simIdentical} -> score: 100 -> label: "Strong match"`);

  const vOrthogonalA = [1, 0, 0];
  const vOrthogonalB = [0, 1, 0];
  const simOrthogonal = computeCosineSimilarity(vOrthogonalA, vOrthogonalB);
  assert.strictEqual(simOrthogonal, 0.0);
  assert.strictEqual(convertCosineToScore(simOrthogonal), 0);
  assert.strictEqual(getMatchLabel(0), 'Weak match');
  assert.strictEqual(isScoreExcludedByDefault(0), true);
  console.log(`   - Orthogonal vectors cosine: ${simOrthogonal} -> score: 0 -> label: "Weak match" (Excluded)`);

  // Opposite vectors
  const vOppositeA = [1, 0];
  const vOppositeB = [-1, 0];
  const simOpposite = computeCosineSimilarity(vOppositeA, vOppositeB);
  assert.strictEqual(simOpposite, -1.0);
  assert.strictEqual(convertCosineToScore(simOpposite), 0);
  console.log(`   - Opposite vectors cosine: ${simOpposite} -> clamped score: 0`);

  // 2. Score threshold categorization
  console.log('\n2️⃣ Testing Qualitative Label Categorization (80+, 60-79, 40-59, <40)...');
  const testCases = [
    { score: 95, expectedLabel: 'Strong match', excluded: false },
    { score: 80, expectedLabel: 'Strong match', excluded: false },
    { score: 79, expectedLabel: 'Good match', excluded: false },
    { score: 65, expectedLabel: 'Good match', excluded: false },
    { score: 60, expectedLabel: 'Good match', excluded: false },
    { score: 59, expectedLabel: 'Possible match', excluded: false },
    { score: 45, expectedLabel: 'Possible match', excluded: false },
    { score: 40, expectedLabel: 'Possible match', excluded: false },
    { score: 39, expectedLabel: 'Weak match', excluded: true },
    { score: 20, expectedLabel: 'Weak match', excluded: true },
    { score: 0, expectedLabel: 'Weak match', excluded: true },
  ];

  for (const tc of testCases) {
    const label = getMatchLabel(tc.score);
    const excluded = isScoreExcludedByDefault(tc.score);
    assert.strictEqual(label, tc.expectedLabel, `Score ${tc.score} must have label ${tc.expectedLabel}`);
    assert.strictEqual(excluded, tc.excluded, `Score ${tc.score} exclusion state must be ${tc.excluded}`);
    console.log(`   - Score ${tc.score.toString().padStart(2, ' ')}/100 -> "${label.padEnd(14, ' ')}" | Default Excluded: ${excluded}`);
  }

  // 3. Error handling validation
  console.log('\n3️⃣ Testing Vector Dimension Mismatch & Empty Array Guards...');
  assert.throws(
    () => computeCosineSimilarity([1, 2], [1, 2, 3]),
    /vector dimensions do not match/
  );
  assert.throws(
    () => computeCosineSimilarity([], []),
    /vectors cannot be empty/
  );
  console.log('   ✅ Dimension guards throw appropriate descriptive errors.');

  // 4. Batch candidate scoring benchmark in Node
  console.log('\n4️⃣ Benchmarking 1,000 Cosine Similarity Calculations in Node Memory...');
  const cvVec = Array.from({ length: 64 }, () => Math.random());
  const candidateVecs = Array.from({ length: 1000 }, () =>
    Array.from({ length: 64 }, () => Math.random())
  );

  const t0 = Date.now();
  for (const cand of candidateVecs) {
    const sim = computeCosineSimilarity(cvVec, cand);
    const score = convertCosineToScore(sim);
    getMatchLabel(score);
  }
  const duration = Date.now() - t0;
  console.log(`   ✅ 1,000 comparisons completed in ${duration} ms (sub-millisecond throughput in Node).`);

  console.log('\n========================================================================');
  console.log('🎉 MODULE 3 ITEM 2 TESTS PASSED PERFECTLY!');
  console.log('========================================================================\n');
  process.exit(0);
}

testItem2().catch((err) => {
  console.error('❌ Item 2 test failed:', err);
  process.exit(1);
});
