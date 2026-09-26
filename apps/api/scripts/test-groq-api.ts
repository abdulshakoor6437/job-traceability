import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { GroqLLMProvider } from '../src/services/llm/llmProvider';

async function testGroqProvider() {
  console.log('--------------------------------------------------');
  console.log(' Testing GroqLLMProvider CV Parsing via Groq API');
  console.log('--------------------------------------------------');

  const provider = new GroqLLMProvider();
  const sampleCvText = `
    Jane Doe
    Email: jane.doe@example.com
    Phone: +1 555-987-6543
    Location: Austin, TX
    LinkedIn: https://linkedin.com/in/janedoe

    Summary: Experienced Full Stack Developer with 6+ years specializing in TypeScript, React, and Node.js.

    Work History:
    Senior Software Engineer | Tech Corp | Austin, TX | 2022-01 to Present
    - Led frontend architecture migration to Next.js.
    - Improved API latency by 40% with Redis caching.

    Education:
    BS in Computer Science | University of Texas at Austin | 2017-08 to 2021-05

    Skills: TypeScript, Node.js, React, PostgreSQL, Docker, AWS
  `;

  const startTime = Date.now();
  try {
    const profile = await provider.parseCv(sampleCvText);
    const latency = Date.now() - startTime;

    console.log(`Latency : ${latency} ms`);
    console.log('Parsed Profile Result:');
    console.log(JSON.stringify(profile, null, 2));
    console.log('--------------------------------------------------');
    console.log('✅ GroqLLMProvider integration is ACTIVE and working!');
    console.log('--------------------------------------------------');
  } catch (err: any) {
    console.error(`❌ GroqLLMProvider failed: ${err.message}`);
    process.exit(1);
  }
}

testGroqProvider();
