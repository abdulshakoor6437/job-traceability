import dotenv from 'dotenv';
import path from 'path';
import { getDbPool } from '../src/dal/db';
import { authDal } from '../src/dal/authDal';
import { cvDal } from '../src/dal/cvDal';
import { matchingService } from '../src/services/matching/matchingService';
import { getRealEmbeddingApiCallCount } from '../src/services/matching/providers/geminiEmbeddingProvider';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testRealMatchingFlow() {
  console.log('--- TESTING REAL MATCHING FLOW WITH GEMINI EMBEDDINGS ---');
  const pool = getDbPool();

  // 1. Create or retrieve test user
  const email = 'real_gemini_test@example.com';
  let [userRows]: any = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  let userId: string;
  if (userRows.length === 0) {
    userId = `user-gemini-test-${Date.now()}`;
    await authDal.createUser(userId, email, '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
  } else {
    userId = userRows[0].id;
  }

  // 2. Insert active CV file and CV profile
  const cvFile = await cvDal.createCvFile(
    userId,
    'resume.pdf',
    `uploads/${userId}/resume.pdf`,
    'application/pdf',
    1024,
    'Alex Developer - Senior Fullstack Software Engineer with 5 years experience in TypeScript, React, Node.js, Next.js, and MySQL.'
  );

  const cvProfile = await cvDal.createCvProfile(
    userId,
    cvFile.id,
    {
      full_name: 'Alex Developer',
      email: email,
      phone: '555-0199',
      location: 'San Francisco, CA',
      linkedin_url: 'https://linkedin.com/in/alexdev',
      website: 'https://alexdev.io',
      summary: 'Senior Fullstack Software Engineer with 5 years experience building web apps with TypeScript, React, Node.js, Next.js, and MySQL.',
      skills: [
        { skill_name: 'TypeScript', category: 'Language' },
        { skill_name: 'React', category: 'Frontend' },
        { skill_name: 'Node.js', category: 'Backend' },
        { skill_name: 'MySQL', category: 'Database' }
      ],
      work_experience: [
        {
          job_title: 'Senior Fullstack Developer',
          company: 'Tech Solutions',
          start_date: '2021-01',
          end_date: null,
          is_current: 1,
          location: 'San Francisco, CA',
          description: 'Building TypeScript web apps with React and Node.js microservices.',
          bullet_points: ['Built React web apps', 'Designed Node.js REST APIs']
        }
      ],
      education: [],
      projects: [],
      certifications: []
    } as any,
    false
  );

  // 3. Ensure test jobs exist in cached_jobs
  const testJobs = [
    {
      id: 'job-real-001',
      dedup_key: 'dedup-real-001',
      title: 'Senior TypeScript & React Fullstack Engineer',
      company: 'Acme Software',
      location: 'San Francisco, CA',
      remote: 1,
      description: 'We are looking for a Senior Fullstack Engineer skilled in TypeScript, React, Node.js, and MySQL to join our engineering team.',
      source_providers: '["jsearch"]'
    },
    {
      id: 'job-real-002',
      dedup_key: 'dedup-real-002',
      title: 'Frontend Developer (React & Next.js)',
      company: 'Design System Corp',
      location: 'Remote',
      remote: 1,
      description: 'Join our team as a Frontend Developer building sleek interfaces in React, Next.js, and CSS design tokens.',
      source_providers: '["jsearch"]'
    },
    {
      id: 'job-real-003',
      dedup_key: 'dedup-real-003',
      title: 'Junior Java Backend Developer',
      company: 'Enterprise Legacy Systems',
      location: 'Chicago, IL',
      remote: 0,
      description: 'Maintenance of legacy Java Spring Boot applications and COBOL backend services.',
      source_providers: '["jsearch"]'
    }
  ];

  for (const j of testJobs) {
    await pool.execute(
      `INSERT INTO cached_jobs (id, dedup_key, title, company, location, remote, description, source_providers, external_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description)`,
      [j.id, j.dedup_key, j.title, j.company, j.location, j.remote, j.description, j.source_providers]
    );
  }

  // 4. Run matching service for userId
  console.log('Running searchMatches for user:', userId);
  const startCallCount = getRealEmbeddingApiCallCount();
  const matchResult = await matchingService.searchMatches(
    userId,
    { minScore: 0, includeExcluded: true, limit: 50 },
    { forceRefresh: true }
  );

  const endCallCount = getRealEmbeddingApiCallCount();
  console.log(`\n========================================================`);
  console.log(`✅ MATCHING COMPLETE FOR REAL!`);
  console.log(`Real Gemini API calls made during this test: ${endCallCount - startCallCount}`);
  console.log(`Total Matches returned: ${matchResult.matches.length}`);
  console.log(`========================================================\n`);

  for (const m of matchResult.matches) {
    console.log(`📌 Job: [${m.jobId}] ${m.title} @ ${m.company}`);
    console.log(`   Score: ${m.score}% (${m.label}) | Excluded: ${m.isExcluded} (${m.excludedReason || 'None'})`);
    console.log(`   Fit Explanation: ${m.explanation}`);
    console.log(`--------------------------------------------------------`);
  }

  process.exit(0);
}

testRealMatchingFlow().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
