import dotenv from 'dotenv';
import path from 'path';
import { GeminiEmbeddingProvider } from '../src/services/matching/providers/geminiEmbeddingProvider';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function testProviderClass() {
  console.log('Testing GeminiEmbeddingProvider class...');
  const provider = new GeminiEmbeddingProvider();
  console.log('Provider initialized. Model:', provider.model);
  
  const embedding = await provider.generateEmbedding('Senior Software Engineer React TypeScript Node.js');
  console.log('✅ Provider generated embedding successfully!');
  console.log('Vector dimensions:', embedding.length);
  console.log('First 5 values:', embedding.slice(0, 5));
}

testProviderClass().catch((err) => {
  console.error('❌ Provider test failed:', err);
});
