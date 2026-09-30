import { IEmbeddingProvider } from '../types';

let realEmbeddingApiCallCount = 0;

export function getRealEmbeddingApiCallCount(): number {
  return realEmbeddingApiCallCount;
}

export function resetRealEmbeddingApiCallCount(): void {
  realEmbeddingApiCallCount = 0;
}

export function incrementRealEmbeddingApiCallCount(): void {
  realEmbeddingApiCallCount++;
}

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  public readonly name = 'gemini';
  public readonly model: string;
  private apiKey: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    let m = model || process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
    if (m === 'text-embedding-004' || m === 'models/text-embedding-004') {
      m = 'gemini-embedding-001';
    }
    this.model = m;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    if (!text || !text.trim()) {
      throw new Error('Cannot generate embedding for empty text');
    }

    incrementRealEmbeddingApiCallCount();

    const cleanText = text.substring(0, 10000); // Safety length cap for embedding
    const modelPath = this.model.startsWith('models/') ? this.model : `models/${this.model}`;
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent?key=${this.apiKey}`;

    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: cleanText }],
          },
        }),
      });

      if (res.status === 429 && attempts < maxAttempts) {
        console.warn(`[GEMINI EMBEDDING 429] Rate limit hit. Retrying attempt ${attempts + 1}/${maxAttempts} in ${attempts * 1500}ms...`);
        await new Promise((r) => setTimeout(r, attempts * 1500));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const err: any = new Error(`Gemini embedding API error: ${res.status} ${res.statusText} - ${errText}`);
        err.statusCode = res.status;
        throw err;
      }

      const data: any = await res.json();
      const values: number[] = data?.embedding?.values;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`Invalid response structure from Gemini embedding API: missing embedding.values`);
      }

      return values;
    }
    throw new Error('Gemini embedding API failed after retries due to 429 Rate Limit');
  }
}
