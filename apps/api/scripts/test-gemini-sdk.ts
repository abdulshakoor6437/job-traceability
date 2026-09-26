import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testGeminiSdk() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  console.log('--------------------------------------------------');
  console.log(' Testing @google/genai SDK Connection');
  console.log('--------------------------------------------------');
  console.log(`API Key configured : ${apiKey ? apiKey.substring(0, 8) + '...' + apiKey.slice(-4) : 'MISSING'}`);
  console.log(`Model requested    : ${model}`);
  console.log('--------------------------------------------------');

  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY is not defined in .env');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const startTime = Date.now();
  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: 'Hello, explain artificial intelligence in simple words.',
    });

    const latency = Date.now() - startTime;
    console.log(`Latency            : ${latency} ms`);
    console.log('Response Content   :');
    console.log(response.text?.trim());
    console.log('--------------------------------------------------');
    console.log('✅ @google/genai SDK is ACTIVE and working!');
    console.log('--------------------------------------------------');
  } catch (err: any) {
    const latency = Date.now() - startTime;
    console.error(`❌ Gemini API Error after ${latency} ms: ${err.message}`);
    process.exit(1);
  }
}

testGeminiSdk();
