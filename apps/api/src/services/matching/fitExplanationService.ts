import { GoogleGenAI } from '@google/genai';
import { MATCHING_CONFIG } from './matchingConfig';

export interface IFitExplanationProvider {
  name: string;
  generateFitExplanation(params: {
    cvSummary: string;
    cvSkills: string[];
    jobTitle: string;
    jobDescription: string;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Mock Fit Explanation Provider (cost discipline: zero quota for routine tests)
// ---------------------------------------------------------------------------
export class MockFitExplanationProvider implements IFitExplanationProvider {
  public name = 'mock_explanation';
  public callCount = 0;
  private shouldFail: boolean;

  constructor(shouldFail = false) {
    this.shouldFail = shouldFail;
  }

  async generateFitExplanation(params: {
    cvSummary: string;
    cvSkills: string[];
    jobTitle: string;
    jobDescription: string;
  }): Promise<string> {
    this.callCount++;

    if (this.shouldFail) {
      throw new Error('MockFitExplanationProvider simulated failure');
    }

    const { cvSkills, jobTitle, jobDescription } = params;
    // Ground strictly on actual CV skills found in job description or role
    const matched = cvSkills.filter((s) =>
      jobDescription.toLowerCase().includes(s.toLowerCase()) ||
      jobTitle.toLowerCase().includes(s.toLowerCase())
    );

    const skillsStr = matched.length > 0
      ? matched.slice(0, 3).join(', ')
      : cvSkills.slice(0, 2).join(', ');

    return `Strong match for ${jobTitle} based on verified expertise in ${skillsStr}. Background aligns directly with core job requirements.`;
  }
}

// ---------------------------------------------------------------------------
// Real Gemini Provider for Live Verification
// ---------------------------------------------------------------------------
export class GeminiFitExplanationProvider implements IFitExplanationProvider {
  public name = 'gemini';
  private ai: GoogleGenAI;
  private model: string;
  public callCount = 0;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    this.ai = new GoogleGenAI({ apiKey });
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async generateFitExplanation(params: {
    cvSummary: string;
    cvSkills: string[];
    jobTitle: string;
    jobDescription: string;
  }): Promise<string> {
    this.callCount++;

    const systemPrompt = `You are a career matching assistant. Write a concise 1 to 2 sentence explanation of why this candidate is a good fit for this job.
CRITICAL RULES:
1. Ground your explanation strictly on the provided CV summary, skills, and actual job requirements.
2. DO NOT fabricate or hallucinate any skills, experience, or degrees not mentioned in the CV.
3. Keep the explanation under 45 words.
4. Output plain text only. No greetings, markdown bolding, bullet points, or quotes.`;

    const userPrompt = `CANDIDATE CV:
Summary: ${params.cvSummary}
Skills: ${params.cvSkills.join(', ')}

TARGET JOB:
Title: ${params.jobTitle}
Description: ${params.jobDescription.substring(0, 1000)}

Provide a 1-2 sentence grounded fit explanation:`;

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: `${systemPrompt}\n\n${userPrompt}`,
    });

    const explanation = (response.text || '').trim();
    if (!explanation) {
      throw new Error('Gemini returned empty fit explanation');
    }
    return explanation;
  }
}

// ---------------------------------------------------------------------------
// Groq / OpenRouter Fallback Provider
// ---------------------------------------------------------------------------
export class OpenAIFallbackFitExplanationProvider implements IFitExplanationProvider {
  public name: string;
  private apiKey: string;
  private endpoint: string;
  private model: string;
  public callCount = 0;

  constructor(name: string, endpoint: string, apiKey: string, model: string) {
    this.name = name;
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateFitExplanation(params: {
    cvSummary: string;
    cvSkills: string[];
    jobTitle: string;
    jobDescription: string;
  }): Promise<string> {
    this.callCount++;

    const systemPrompt = `You are a career matching assistant. Write a concise 1 to 2 sentence explanation of why this candidate is a good fit for this job. Ground your explanation strictly on the provided CV summary, skills, and actual job requirements. Never fabricate skills or experience. Plain text only, under 45 words.`;

    const userPrompt = `CANDIDATE CV:
Summary: ${params.cvSummary}
Skills: ${params.cvSkills.join(', ')}

TARGET JOB:
Title: ${params.jobTitle}
Description: ${params.jobDescription.substring(0, 1000)}`;

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      throw new Error(`${this.name} API error: ${res.status}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    if (!content) {
      throw new Error(`${this.name} returned empty explanation`);
    }
    return content;
  }
}

// ---------------------------------------------------------------------------
// Fit Explanation Service with Multi-Provider Fallback & Threshold Gating
// ---------------------------------------------------------------------------
export class FitExplanationService {
  private providers: IFitExplanationProvider[];
  private threshold: number;
  private totalCalls = 0;

  constructor(
    providers?: IFitExplanationProvider[],
    threshold: number = MATCHING_CONFIG.explanationScoreThreshold
  ) {
    this.threshold = threshold;

    if (providers && providers.length > 0) {
      this.providers = providers;
    } else {
      // Default production provider chain: Gemini -> Groq -> Mock
      const defaultChain: IFitExplanationProvider[] = [];
      if (process.env.GEMINI_API_KEY) {
        try {
          defaultChain.push(new GeminiFitExplanationProvider());
        } catch {
          // ignore init error
        }
      }
      if (process.env.GROQ_API_KEY) {
        defaultChain.push(
          new OpenAIFallbackFitExplanationProvider(
            'groq',
            'https://api.groq.com/openai/v1/chat/completions',
            process.env.GROQ_API_KEY,
            process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
          )
        );
      }
      // Always have mock as fallback
      defaultChain.push(new MockFitExplanationProvider());
      this.providers = defaultChain;
    }
  }

  getThreshold(): number {
    return this.threshold;
  }

  getTotalCalls(): number {
    return this.totalCalls;
  }

  resetTotalCalls(): void {
    this.totalCalls = 0;
  }

  /**
   * Generates a 1-2 sentence fit explanation IF score >= threshold.
   * If score < threshold, returns null immediately and performs 0 LLM calls (cost control).
   */
  async explainIfEligible(params: {
    score: number;
    cvSummary: string;
    cvSkills: string[];
    jobTitle: string;
    jobDescription: string;
  }): Promise<{ explanation: string | null; generated: boolean; provider?: string }> {
    // 1. Cost discipline: Skip below threshold
    if (params.score < this.threshold) {
      return { explanation: null, generated: false };
    }

    this.totalCalls++;

    // 2. Multi-provider fallback chain
    let lastError: Error | null = null;
    for (const provider of this.providers) {
      try {
        const text = await provider.generateFitExplanation({
          cvSummary: params.cvSummary,
          cvSkills: params.cvSkills,
          jobTitle: params.jobTitle,
          jobDescription: params.jobDescription,
        });

        return { explanation: text, generated: true, provider: provider.name };
      } catch (err: any) {
        lastError = err;
        console.warn(`[FIT EXPLANATION] Provider '${provider.name}' failed: ${err.message}. Trying next provider...`);
      }
    }

    console.error(`[FIT EXPLANATION] All providers failed: ${lastError?.message}`);
    return {
      explanation: `Strong background alignment with ${params.jobTitle} core requirements.`,
      generated: true,
      provider: 'static_fallback',
    };
  }
}

export const defaultFitExplanationService = new FitExplanationService();
