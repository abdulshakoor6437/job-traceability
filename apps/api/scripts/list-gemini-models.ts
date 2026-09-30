import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const apiKey = process.env.GEMINI_API_KEY || '';

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (data.models) {
    const embedModels = data.models.filter((m: any) => 
      m.supportedGenerationMethods?.includes('embedContent')
    );
    console.log('Models supporting embedContent:');
    embedModels.forEach((m: any) => console.log(' -', m.name, '| Display:', m.displayName));
  } else {
    console.log('Response:', data);
  }
}

listModels();
