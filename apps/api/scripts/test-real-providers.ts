import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { JSearchProvider } from '../src/services/job/providers/jsearchProvider';
import { SerpApiProvider } from '../src/services/job/providers/serpApiProvider';
import { RemotiveProvider } from '../src/services/job/providers/remotiveProvider';

async function main() {
  console.log('\n========================================================================');
  console.log('📡 REAL LIVE PROVIDER PROBE & RAW RESPONSE EXTRACTION');
  console.log('========================================================================\n');

  const jsearchKey = process.env.JSEARCH_API_KEY || process.env.RAPIDAPI_KEY || '';
  const serpapiKey = process.env.SERPAPI_API_KEY || '';

  console.log('Configured Keys Status:');
  console.log(`- JSearch / RapidAPI Key: ${jsearchKey ? `Present (${jsearchKey.substring(0, 6)}...${jsearchKey.substring(jsearchKey.length - 4)})` : 'MISSING'}`);
  console.log(`- SerpApi Key:           ${serpapiKey ? `Present (${serpapiKey.substring(0, 6)}...${serpapiKey.substring(serpapiKey.length - 4)})` : 'MISSING'}`);
  console.log(`- Remotive API:          Public (No Key Required)\n`);

  // 1. Remotive Live Call (Always available without API key)
  console.log('------------------------------------------------------------------------');
  console.log('1. REMOTIVE LIVE API CALL:');
  console.log('------------------------------------------------------------------------');
  try {
    const remotiveStart = Date.now();
    const remotiveUrl = 'https://remotive.com/api/remote-jobs?search=software%20engineer&limit=5';
    const remotiveRes = await fetch(remotiveUrl);
    const remotiveLatencyMs = Date.now() - remotiveStart;

    console.log(`HTTP Status: ${remotiveRes.status} ${remotiveRes.statusText}`);
    console.log(`Wall-Clock Latency: ${remotiveLatencyMs} ms`);

    const remotiveRawJson = await remotiveRes.json();
    console.log('FULL Raw JSON Response (sample first 2 jobs):');
    const preview = {
      '0-legal-notice': remotiveRawJson['0-legal-notice'],
      'job-count': remotiveRawJson['job-count'],
      jobs: (remotiveRawJson.jobs || []).slice(0, 2),
    };
    console.log(JSON.stringify(preview, null, 2));

    const provider = new RemotiveProvider();
    const normalizedJobs = await provider.searchJobs('software engineer');
    console.log(`\nNormalized Jobs Mapped: ${normalizedJobs.length}`);
    if (normalizedJobs.length > 0) {
      console.log('First Normalized Job:', JSON.stringify(normalizedJobs[0], null, 2));
    }
  } catch (err: any) {
    console.error('Remotive Live Call Failed:', err.message);
  }

  // 2. JSearch Live Call
  console.log('\n------------------------------------------------------------------------');
  console.log('2. JSEARCH LIVE API CALL:');
  console.log('------------------------------------------------------------------------');
  if (!jsearchKey) {
    console.log('❌ CANNOT MAKE LIVE JSEARCH CALL: Neither JSEARCH_API_KEY nor RAPIDAPI_KEY is set in .env.');
    console.log('   Please add JSEARCH_API_KEY=<your_rapidapi_key> to .env.');
  } else {
    try {
      const url = 'https://jsearch.p.rapidapi.com/search-v2?query=software%20engineer%20in%20New%20York&page=1&num_pages=1';
      const jsearchStart = Date.now();
      const res = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': jsearchKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
      });
      const jsearchLatencyMs = Date.now() - jsearchStart;

      console.log(`HTTP Status: ${res.status} ${res.statusText}`);
      console.log(`Wall-Clock Latency: ${jsearchLatencyMs} ms`);

      const rawJson = await res.json();
      console.log('FULL Raw JSON Response from JSearch:');
      console.log(JSON.stringify(rawJson, null, 2));

      const provider = new JSearchProvider(jsearchKey);
      const normalizedJobs = await provider.searchJobs('software engineer', 'New York');
      console.log(`\nNormalized Jobs Mapped: ${normalizedJobs.length}`);
      if (normalizedJobs.length > 0) {
        console.log('First Normalized Job:', JSON.stringify(normalizedJobs[0], null, 2));
      }
    } catch (err: any) {
      console.error('JSearch Live Call Failed:', err.message);
    }
  }

  // 3. SerpApi Live Call
  console.log('\n------------------------------------------------------------------------');
  console.log('3. SERPAPI LIVE API CALL:');
  console.log('------------------------------------------------------------------------');
  if (!serpapiKey) {
    console.log('❌ CANNOT MAKE LIVE SERPAPI CALL: SERPAPI_API_KEY is not set in .env.');
    console.log('   Please add SERPAPI_API_KEY=<your_serpapi_key> to .env.');
  } else {
    try {
      const url = `https://serpapi.com/search.json?engine=google_jobs&q=software%20engineer%20in%20New%20York&api_key=${serpapiKey}`;
      const serpStart = Date.now();
      const res = await fetch(url);
      const serpLatencyMs = Date.now() - serpStart;

      console.log(`HTTP Status: ${res.status} ${res.statusText}`);
      console.log(`Wall-Clock Latency: ${serpLatencyMs} ms`);

      const rawJson = await res.json();
      console.log('FULL Raw JSON Response from SerpApi:');
      console.log(JSON.stringify(rawJson, null, 2));

      const provider = new SerpApiProvider(serpapiKey);
      const normalizedJobs = await provider.searchJobs('software engineer', 'New York');
      console.log(`\nNormalized Jobs Mapped: ${normalizedJobs.length}`);
      if (normalizedJobs.length > 0) {
        console.log('First Normalized Job:', JSON.stringify(normalizedJobs[0], null, 2));
      }
    } catch (err: any) {
      console.error('SerpApi Live Call Failed:', err.message);
    }
  }
}

main().catch(console.error);
