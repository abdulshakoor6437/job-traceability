import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import fs from 'fs';
import { extractCvText } from '../src/services/cv/textExtractor';
import { llmManager } from '../src/services/llm/llmProvider';

async function testGroqParsing() {
  const pdfPath = path.resolve(__dirname, '../test-fixtures/sample-cv.pdf');
  const pdfBuf = fs.readFileSync(pdfPath);
  const pdfExt = await extractCvText(pdfBuf);

  console.log('Sending text to llmManager.parseCvWithFallback...');
  try {
    const result = await llmManager.parseCvWithFallback(pdfExt.text);
    console.log('--- PARSE SUCCESS ---');
    console.log('Used Provider:', result.usedProvider);
    console.log('Needs Review :', result.needsReview);
    console.log('Profile Result:\n', JSON.stringify(result.profile, null, 2));
  } catch (err: any) {
    console.error('--- PARSE ERROR ---');
    console.error(err);
  }
}

testGroqParsing().catch(console.error);
