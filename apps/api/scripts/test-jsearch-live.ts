import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const key = process.env.RAPIDAPI_KEY || process.env.JSEARCH_API_KEY;
  console.log('Testing JSearch with key:', key ? `${key.substring(0, 6)}...` : 'NONE');
  const url = `https://jsearch.p.rapidapi.com/search-v2?query=software%20engineer%20in%20New%20York&page=1&num_pages=1`;
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': key || '',
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
  });
  const latency = Date.now() - t0;
  console.log(`HTTP Status: ${res.status} ${res.statusText}`);
  console.log(`Latency: ${latency} ms`);
  const json: any = await res.json();
  console.log('STATUS:', json.status);
  console.log('REQUEST_ID:', json.request_id);
  console.log('PARAMETERS:', json.parameters);
  const jobs = json.data?.jobs || json.data || [];
  console.log('JOBS COUNT:', jobs.length);
  if (jobs.length > 0) {
    console.log('FIRST JOB RAW (Keys):', Object.keys(jobs[0]));
    console.log('FIRST JOB RAW SAMPLE:');
    console.log(JSON.stringify(jobs[0], null, 2));
  }
}

main().catch(console.error);
