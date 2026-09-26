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
    this.model = model || process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

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
}
