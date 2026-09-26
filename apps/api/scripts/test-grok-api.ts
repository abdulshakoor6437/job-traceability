import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from workspace root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testGrokApi() {
  const apiKey = process.env.GROK_API_KEY;
  const model = process.env.GROK_MODEL || 'grok-3-mini';

  console.log('--------------------------------------------------');
  console.log(' Testing Grok (xAI) API Key Connection');
  console.log('--------------------------------------------------');
  console.log(`API Key configured : ${apiKey ? apiKey.substring(0, 8) + '...' + apiKey.slice(-4) : 'MISSING'}`);
  console.log(`Model requested    : ${model}`);
  console.log('Target Endpoint    : https://api.x.ai/v1/chat/completions');
  console.log('--------------------------------------------------');

  if (!apiKey) {
    console.error('❌ Error: GROK_API_KEY is not defined in .env file.');
    process.exit(1);
  }

  const startTime = Date.now();
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: 'Respond with exactly the word PONG if you receive this message.' },
        ],
        temperature: 0,
      }),
    });

    const latency = Date.now() - startTime;
    console.log(`HTTP Status        : ${res.status} ${res.statusText}`);
    console.log(`Latency            : ${latency} ms`);

    const responseText = await res.text();

    if (!res.ok) {
      console.error(`❌ Connection failed with HTTP ${res.status}`);
      console.error(`Response body      : ${responseText}`);
      process.exit(1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = null;
    }

    const messageContent = parsed?.choices?.[0]?.message?.content || responseText;
    console.log(`Response Content   : ${messageContent.trim()}`);
    console.log('--------------------------------------------------');
    console.log('✅ Grok (xAI) API is ACTIVE and working successfully!');
    console.log('--------------------------------------------------');
  } catch (err: any) {
    const latency = Date.now() - startTime;
    console.error(`❌ Network error after ${latency} ms: ${err.message}`);
    process.exit(1);
  }
}

testGrokApi();
