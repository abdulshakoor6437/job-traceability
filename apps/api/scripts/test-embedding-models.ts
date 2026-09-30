import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const apiKey = process.env.GEMINI_API_KEY || '';

async function testModel(modelName: string, apiVersion: string = 'v1beta') {
  const modelPath = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/${modelPath}:embedContent?key=${apiKey}`;
  console.log(`Testing model: "${modelName}" on apiVersion: "${apiVersion}"...`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: 'Test text embedding' }] }
      })
    });
    const status = res.status;
    const body = await res.text();
    if (res.ok) {
      const data = JSON.parse(body);
      console.log(`  SUCCESS! (${status}) Vector len: ${data.embedding?.values?.length}`);
    } else {
      console.log(`  FAILED! (${status}) Body: ${body.substring(0, 300)}`);
    }
  } catch (err: any) {
    console.log(`  ERROR: ${err.message}`);
  }
}

async function run() {
  console.log('API Key present:', !!apiKey);
  await testModel('gemini-embedding-001', 'v1beta');
  await testModel('gemini-embedding-001', 'v1');
  await testModel('gemini-embedding-2', 'v1beta');
  await testModel('gemini-embedding-2', 'v1');
  await testModel('text-embedding-004', 'v1beta');
}

run();
