import assert from 'assert';
import http from 'http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import jobRoutes from '../src/routes/jobs';
import { jobDal } from '../src/dal/jobDal';
import { jobSearchService } from '../src/services/job/jobSearchService';
import { IJobSource, NormalizedJob } from '../src/services/job/types';

function makePostRequest(
  port: number,
  path: string,
  body: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 500, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runApiTests() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 6: POST /api/jobs/search Endpoint Tests');
  console.log('================================================================\n');

  // Clean cache database
  await jobDal.resetAllForTesting();
  console.log('🧹 Cleaned job cache database tables.');

  // Set up mock provider in jobSearchService for predictable API integration testing
  const mockApiProvider: IJobSource = {
    name: 'jsearch',
    searchJobs: async (query, location) => [
      {
        externalId: 'api-job-01',
        sourceProvider: 'jsearch',
        title: `${query} Specialist`,
        company: 'Vanguard Systems',
        location: location || 'London, UK',
        remote: true,
        salaryMin: 140000,
        salaryMax: 180000,
        salaryCurrency: 'USD',
        description: 'Vanguard systems is hiring an experienced engineer',
        applyUrl: 'https://vanguard.test/careers/01',
        postedDate: '2026-09-24T10:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
      {
        externalId: 'api-job-02',
        sourceProvider: 'jsearch',
        title: `Junior ${query} Assistant`,
        company: 'Vanguard Systems',
        location: location || 'London, UK',
        remote: false,
        salaryMin: 60000,
        salaryMax: 80000,
        salaryCurrency: 'USD',
        description: 'Entry level role',
        applyUrl: 'https://vanguard.test/careers/02',
        postedDate: '2026-09-24T10:00:00Z',
        fetchedAt: new Date().toISOString(),
      },
    ],
  };

  (jobSearchService as any).providers = new Map();
  jobSearchService.registerProvider(mockApiProvider);

  // Spin up test server on ephemeral port
  const app = express();
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/jobs', jobRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const port = address.port;
  console.log(`🌐 Test API server listening on http://127.0.0.1:${port}`);

  try {
    console.log('\n▶ Step 6.1: Rejecting request with missing keywords/role (400 validation)...');
    const resBad = await makePostRequest(port, '/api/jobs/search', {
      location: 'London',
    });
    assert.strictEqual(resBad.status, 400, 'Must return 400 when role/query is omitted');
    console.log('  ✅ Validation caught empty role query with 400 Bad Request:', resBad.body);

    console.log('\n▶ Step 6.2: Calling POST /api/jobs/search with valid role and location (cache miss)...');
    const res1 = await makePostRequest(port, '/api/jobs/search', {
      role: 'Platform Engineer',
      location: 'London',
      filters: { remoteOnly: false },
    });

    assert.strictEqual(res1.status, 200, 'Search endpoint must return 200 OK');
    assert.strictEqual(res1.body.success, true);
    assert.strictEqual(res1.body.data.fromCache, false, 'First search must be fromCache: false');
    assert.strictEqual(res1.body.data.jobs.length, 2, 'Must return 2 jobs');
    assert.strictEqual(res1.body.data.jobs[0].company, 'Vanguard Systems');
    assert.strictEqual(res1.body.data.externalCallsMade, 1);
    console.log('  ✅ First search returned normalized, live results:', {
      fromCache: res1.body.data.fromCache,
      totalCount: res1.body.data.totalCount,
      cacheKey: res1.body.data.cacheKey,
      externalCallsMade: res1.body.data.externalCallsMade,
    });

    console.log('\n▶ Step 6.3: Calling identical POST /api/jobs/search within cache TTL (cache hit)...');
    const res2 = await makePostRequest(port, '/api/jobs/search', {
      role: 'Platform Engineer',
      location: 'London',
      filters: { remoteOnly: false },
    });

    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.data.fromCache, true, 'Second search must be fromCache: true');
    assert.strictEqual(res2.body.data.externalCallsMade, 0, 'Cached response must record 0 external calls');
    assert.strictEqual(res2.body.data.jobs.length, 2);
    console.log('  ✅ Second search served directly from shared cache with 0 external calls!');

    console.log('\n▶ Step 6.4: Testing filters (remoteOnly)...');
    const resFiltered = await makePostRequest(port, '/api/jobs/search', {
      role: 'Platform Engineer',
      location: 'London',
      filters: { remoteOnly: true },
    });

    assert.strictEqual(resFiltered.status, 200);
    assert.strictEqual(resFiltered.body.data.jobs.length, 1, 'Only 1 job matches remoteOnly: true');
    assert.strictEqual(resFiltered.body.data.jobs[0].remote, true);
    console.log('  ✅ Remote-only filter applied successfully:', resFiltered.body.data.jobs[0].title);

    console.log('\n▶ Step 6.5: Testing salary filter (minSalary >= 100000)...');
    const resSalary = await makePostRequest(port, '/api/jobs/search', {
      role: 'Platform Engineer',
      location: 'London',
      filters: { minSalary: 100000 },
    });

    assert.strictEqual(resSalary.status, 200);
    assert.strictEqual(resSalary.body.data.jobs.length, 1, 'Only 1 job matches minSalary >= 100000');
    assert.strictEqual(resSalary.body.data.jobs[0].salaryMax, 180000);
    console.log('  ✅ Salary filter applied successfully:', {
      title: resSalary.body.data.jobs[0].title,
      salary: `${resSalary.body.data.jobs[0].salaryMin} - ${resSalary.body.data.jobs[0].salaryMax}`,
    });

    console.log('\n================================================================');
    console.log('🎉 SCOPE ITEM 6 PASSED: POST /api/jobs/search fully verified');
    console.log('================================================================\n');
  } finally {
    server.close();
  }
  process.exit(0);
}

runApiTests().catch((err) => {
  console.error('❌ API Endpoint Test Failed:', err);
  process.exit(1);
});
