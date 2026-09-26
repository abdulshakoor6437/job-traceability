import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { matchingDal } from '../src/dal/matchingDal';
import { jobDal } from '../src/dal/jobDal';
import { cvDal } from '../src/dal/cvDal';
import { getDbPool } from '../src/dal/db';
import { embeddingService } from '../src/services/matching/embeddingService';
import { MockEmbeddingProvider } from '../src/services/matching/providers/mockEmbeddingProvider';
import { GeminiEmbeddingProvider } from '../src/services/matching/providers/geminiEmbeddingProvider';
import { RowDataPacket } from 'mysql2/promise';

async function testItem1() {
  console.log('\n========================================================================');
  console.log('🧪 MODULE 3 ITEM 1 TEST: EMBEDDING ABSTRACTION & GENERATION');
  console.log('========================================================================\n');

  await matchingDal.resetAllForTesting();
  console.log('🧹 Cleaned matching tables.');

  // 1. Verify Provider Abstraction
  console.log('1️⃣ Verifying IEmbeddingProvider Interface & Providers...');
  const mockProvider = new MockEmbeddingProvider(64);
  assert.strictEqual(mockProvider.name, 'mock_embedding');
  assert.strictEqual(mockProvider.model, 'mock-embedding-v1');

  const geminiProvider = new GeminiEmbeddingProvider('dummy-key', 'text-embedding-004');
  assert.strictEqual(geminiProvider.name, 'gemini');
  assert.strictEqual(geminiProvider.model, 'text-embedding-004');
  console.log('   ✅ Provider interface implemented cleanly by both Mock and Gemini providers.');

  // Set mock provider for cost-free test execution
  embeddingService.setProvider(mockProvider);

  // 2. Test Text Preparation
  console.log('\n2️⃣ Testing Text Preparation for Jobs and CV Profiles...');
  const jobText = embeddingService.prepareJobText(
    'Staff Backend Engineer',
    'Build distributed ledger systems using Node.js and TypeScript.'
  );
  assert.ok(jobText.includes('Staff Backend Engineer'));
  assert.ok(jobText.includes('distributed ledger systems'));
  console.log('   Prepared Job Text Sample:\n   ', jobText.replace(/\n/g, ' '));

  const cvText = embeddingService.prepareCvProfileText({
    summary: 'Experienced Backend Architect with 8 years in distributed systems.',
    skills: [{ skill_name: 'TypeScript' }, { skill_name: 'Node.js' }, { skill_name: 'MySQL' }],
    workHistory: [
      {
        title: 'Lead Engineer',
        company: 'Cloud Corp',
        bullet_points: ['Scaled microservices to 10M DAU', 'Optimized database queries'],
      },
    ],
  });
  assert.ok(cvText.includes('Experienced Backend Architect'));
  assert.ok(cvText.includes('Core Skills:\nTypeScript, Node.js, MySQL'));
  assert.ok(cvText.includes('Lead Engineer at Cloud Corp'));
  console.log('   Prepared CV Profile Text Sample:\n   ', cvText.replace(/\n/g, ' '));
  console.log('   ✅ Text preparation formats title+desc and summary+skills+history correctly.');

  // 3. Test Job Embedding Generation and Storage (ZERO user_id)
  console.log('\n3️⃣ Testing Job Embedding Generation & Storage (Shared Cache)...');
  // Seed a sample job into cached_jobs
  const sampleJobId = 'job-test-' + Date.now();
  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO cached_jobs (id, dedup_key, title, company, description, source_providers, external_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sampleJobId,
      'dedup-' + sampleJobId,
      'Staff Backend Engineer',
      'Acme Inc',
      'Build scalable backend services with TypeScript, Node.js, and SQL databases.',
      JSON.stringify(['remotive']),
      JSON.stringify({ remotive: 'ext-1' }),
    ]
  );

  const jobVector = await embeddingService.ensureJobEmbedding({
    id: sampleJobId,
    title: 'Staff Backend Engineer',
    description: 'Build scalable backend services with TypeScript, Node.js, and SQL databases.',
  });

  assert.strictEqual(jobVector.length, 64, 'Job embedding vector must have 64 dimensions');
  const storedJobEmb = await matchingDal.getJobEmbedding(sampleJobId);
  assert.ok(storedJobEmb, 'Job embedding must be saved in database');
  assert.strictEqual(storedJobEmb.dimensions, 64);
  assert.strictEqual(storedJobEmb.vector.length, 64);
  assert.strictEqual(storedJobEmb.model, 'mock-embedding-v1');

  // Verify Privacy Rule: job_embeddings has ZERO user_id columns
  const [jobCols] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_embeddings'`
  );
  const colNames = jobCols.map((c) => c.COLUMN_NAME);
  assert.strictEqual(colNames.includes('user_id'), false, 'job_embeddings must NOT have user_id');
  console.log(`   ✅ Job embedding generated (${jobVector.length} dims) & stored in DB without user_id.`);

  // 4. Test User CV Profile Embedding Generation and Storage (User-Scoped)
  console.log('\n4️⃣ Testing User Active CV Profile Embedding Generation & Storage...');
  const testUserId = 'user-test-' + Date.now();
  const testProfileId = 'profile-test-' + Date.now();
  const testFileId = 'file-test-' + Date.now();

  // Create user and profile in DB
  await pool.execute(
    `INSERT INTO users (id, email, password_hash, is_verified) VALUES (?, ?, 'dummy', 1)`,
    [testUserId, `${testUserId}@example.com`]
  );
  await pool.execute(
    `INSERT INTO user_cv_files (id, user_id, original_filename, storage_key, mime_type, file_size_bytes)
     VALUES (?, ?, 'resume.pdf', 'storage-key', 'application/pdf', 1024)`,
    [testFileId, testUserId]
  );
  await pool.execute(
    `INSERT INTO cv_profiles (id, user_id, cv_file_id, version_number, is_active, summary)
     VALUES (?, ?, ?, 1, 1, 'Senior Backend Architect specializing in Node.js and high-concurrency microservices.')`,
    [testProfileId, testUserId, testFileId]
  );

  const cvVector = await embeddingService.ensureCvProfileEmbedding(testUserId, testProfileId, {
    summary: 'Senior Backend Architect specializing in Node.js and high-concurrency microservices.',
    skills: [{ skill_name: 'TypeScript' }, { skill_name: 'Node.js' }, { skill_name: 'PostgreSQL' }],
    workHistory: [
      {
        title: 'Backend Lead',
        company: 'Stripe',
        bullet_points: ['Built distributed payment engine'],
      },
    ],
  });

  assert.strictEqual(cvVector.length, 64, 'CV embedding vector must have 64 dimensions');
  const storedCvEmb = await matchingDal.getCvProfileEmbedding(testUserId, testProfileId);
  assert.ok(storedCvEmb, 'CV profile embedding must be stored in database');
  assert.strictEqual(storedCvEmb.dimensions, 64);
  assert.strictEqual(storedCvEmb.vector.length, 64);

  // Cross-user test: Another user cannot access or read User A's CV embedding
  const wrongUserEmb = await matchingDal.getCvProfileEmbedding('other-user-999', testProfileId);
  assert.strictEqual(wrongUserEmb, null, 'Cross-user check: foreign user cannot retrieve embedding');
  console.log('   ✅ CV profile embedding generated and stored with strict user_id isolation.');

  // Clean up
  await matchingDal.resetAllForTesting();
  await pool.execute(`DELETE FROM cv_profiles WHERE id = ?`, [testProfileId]);
  await pool.execute(`DELETE FROM user_cv_files WHERE id = ?`, [testFileId]);
  await pool.execute(`DELETE FROM users WHERE id = ?`, [testUserId]);
  await pool.execute(`DELETE FROM cached_jobs WHERE id = ?`, [sampleJobId]);

  console.log('\n========================================================================');
  console.log('🎉 MODULE 3 ITEM 1 TESTS PASSED PERFECTLY!');
  console.log('========================================================================\n');
  process.exit(0);
}

testItem1().catch((err) => {
  console.error('❌ Item 1 test failed:', err);
  process.exit(1);
});
