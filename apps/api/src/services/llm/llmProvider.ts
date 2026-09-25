import { CvStructuredProfile, validateAndCleanCvProfile } from '../cv/schemaValidator';

export interface LLMAttemptLog {
  provider: string;
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  reason?: string;
}

export interface ILLMProvider {
  name: string;
  parseCv(rawText: string): Promise<CvStructuredProfile>;
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------
class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private openUntil: number = 0;

  isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure() {
    const now = Date.now();
    if (now - this.lastFailureTime > 60000) {
      this.failures = 1;
    } else {
      this.failures += 1;
    }
    this.lastFailureTime = now;
    if (this.failures >= 3) {
      this.openUntil = now + 60000;
      console.warn(`[CIRCUIT BREAKER] Circuit OPENED for provider. Failures: ${this.failures}`);
    }
  }
}

const providerCircuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(providerName: string): CircuitBreaker {
  let cb = providerCircuitBreakers.get(providerName);
  if (!cb) {
    cb = new CircuitBreaker();
    providerCircuitBreakers.set(providerName, cb);
  }
  return cb;
}

// ---------------------------------------------------------------------------
// Shared prompt
// ---------------------------------------------------------------------------
const CV_SYSTEM_PROMPT = `You are a CV parsing assistant. Extract structured information from the provided CV text and return ONLY a valid JSON object matching this exact schema. Do not include any markdown, explanation, or extra text — raw JSON only.

Schema:
{
  "contact_info": {
    "full_name": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin_url": "string or null",
    "website": "string or null"
  },
  "summary": "string or null",
  "work_history": [
    {
      "title": "string",
      "company": "string",
      "location": "string or null",
      "start_date": "YYYY-MM string",
      "end_date": "YYYY-MM string or Present",
      "is_current": boolean,
      "bullet_points": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field_of_study": "string or null",
      "start_date": "YYYY-MM string or null",
      "end_date": "YYYY-MM string or null"
    }
  ],
  "skills": [
    { "skill_name": "string", "category": "string or null" }
  ],
  "certifications": [
    {
      "name": "string",
      "issuing_organization": "string or null",
      "issue_date": "YYYY-MM string or null",
      "expiration_date": "YYYY-MM string or null",
      "credential_id": "string or null"
    }
  ]
}`;

function extractJson(raw: string): unknown {
  // Strip markdown code fences if the model wrapped the JSON
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = fenced ? fenced[1] : raw;
  return JSON.parse(text.trim());
}

// ---------------------------------------------------------------------------
// Mock Provider (used in tests / when no real keys are set)
// ---------------------------------------------------------------------------
export class MockLLMProvider implements ILLMProvider {
  public name: string;
  private failType?: '500' | '429' | 'timeout' | 'validation';

  constructor(name: string, failType?: '500' | '429' | 'timeout' | 'validation') {
    this.name = name;
    this.failType = failType;
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    if (this.failType === '500') {
      const err: any = new Error('HTTP 500 Internal Server Error');
      err.statusCode = 500;
      throw err;
    }
    if (this.failType === '429') {
      const err: any = new Error('HTTP 429 Rate Limit Exceeded');
      err.statusCode = 429;
      throw err;
    }
    if (this.failType === 'timeout') {
      const err: any = new Error('Gateway Timeout');
      err.statusCode = 504;
      throw err;
    }
    if (this.failType === 'validation') {
      const err: any = new Error('Validation Error: Unparsable content');
      err.statusCode = 400;
      err.isValidationError = true;
      throw err;
    }

    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const fullName = lines.find((l) => !l.includes('@') && !l.startsWith('http') && l.length < 50) || 'John Doe';
    const emailMatch = rawText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = rawText.match(/(\+?\d{1,3}[-.\\s]?)?\(?\d{3}\)?[-.\\s]?\d{3}[-.\\s]?\d{4}/);

    return {
      contact_info: {
        full_name: fullName,
        email: emailMatch ? emailMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
        location: 'San Francisco, CA',
        linkedin_url: 'https://linkedin.com/in/johndoe',
        website: 'https://johndoe.dev',
      },
      summary: rawText.substring(0, 200),
      work_history: [
        {
          title: 'Senior Software Engineer',
          company: 'Acme Corp',
          location: 'San Francisco, CA',
          start_date: '2021-01',
          end_date: 'Present',
          is_current: true,
          bullet_points: ['Built multi-tenant cloud application', 'Optimized database queries'],
        },
      ],
      education: [
        {
          institution: 'University of California, Berkeley',
          degree: 'Bachelor of Science',
          field_of_study: 'Computer Science',
          start_date: '2016-08',
          end_date: '2020-05',
        },
      ],
      skills: [
        { skill_name: 'TypeScript', category: 'Programming Languages' },
        { skill_name: 'Node.js', category: 'Backend' },
        { skill_name: 'MySQL', category: 'Database' },
      ],
      certifications: [
        {
          name: 'AWS Certified Solutions Architect',
          issuing_organization: 'Amazon Web Services',
          issue_date: '2022-03',
          expiration_date: '2025-03',
          credential_id: 'AWS-123456',
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Grok (xAI) Provider
// ---------------------------------------------------------------------------
export class GrokLLMProvider implements ILLMProvider {
  public name = 'grok';
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROK_API_KEY || '';
    this.model = process.env.GROK_MODEL || 'grok-3-mini';
    if (!this.apiKey) throw new Error('GROK_API_KEY is not set');
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: CV_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err: any = new Error(`Grok API error: ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }

    const json: any = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    return extractJson(content) as CvStructuredProfile;
  }
}

// ---------------------------------------------------------------------------
// Google Gemini Provider
// ---------------------------------------------------------------------------
export class GeminiLLMProvider implements ILLMProvider {
  public name = 'gemini';
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || '';
    this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    if (!this.apiKey) throw new Error('GEMINI_API_KEY is not set');
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: CV_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: rawText }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      const err: any = new Error(`Gemini API error: ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }

    const json: any = await res.json();
    const content: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return extractJson(content) as CvStructuredProfile;
  }
}

// ---------------------------------------------------------------------------
// OpenRouter Provider
// ---------------------------------------------------------------------------
export class OpenRouterLLMProvider implements ILLMProvider {
  public name = 'openrouter';
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct';
    if (!this.apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'Job Apply Agent',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: CV_SYSTEM_PROMPT },
          { role: 'user', content: rawText },
        ],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err: any = new Error(`OpenRouter API error: ${res.status}`);
      err.statusCode = res.status;
      throw err;
    }

    const json: any = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    return extractJson(content) as CvStructuredProfile;
  }
}

// ---------------------------------------------------------------------------
// LLM Manager
// ---------------------------------------------------------------------------
export class LLMManager {
  private providers: Map<string, ILLMProvider> = new Map();
  public attemptLogs: LLMAttemptLog[] = [];

  constructor() {
    // Always register mocks so tests can use them without real keys
    this.registerProvider(new MockLLMProvider('mock_primary'));
    this.registerProvider(new MockLLMProvider('mock_secondary'));
    this.registerProvider(new MockLLMProvider('mock_tertiary'));

    // Register real providers when keys are available
    if (process.env.GROK_API_KEY) {
      try { this.registerProvider(new GrokLLMProvider()); }
      catch (e: any) { console.warn('[LLM MANAGER] Grok registration failed:', e.message); }
    }
    if (process.env.GEMINI_API_KEY) {
      try { this.registerProvider(new GeminiLLMProvider()); }
      catch (e: any) { console.warn('[LLM MANAGER] Gemini registration failed:', e.message); }
    }
    if (process.env.OPENROUTER_API_KEY) {
      try { this.registerProvider(new OpenRouterLLMProvider()); }
      catch (e: any) { console.warn('[LLM MANAGER] OpenRouter registration failed:', e.message); }
    }
  }

  registerProvider(provider: ILLMProvider) {
    this.providers.set(provider.name, provider);
  }

  async parseCvWithFallback(
    rawText: string,
    overrideProviderList?: string[]
  ): Promise<{ profile: CvStructuredProfile; needsReview: boolean; usedProvider: string; logs: LLMAttemptLog[] }> {
    const configuredList = overrideProviderList || (process.env.LLM_PROVIDERS ? process.env.LLM_PROVIDERS.split(',') : ['mock_primary', 'mock_secondary', 'mock_tertiary']);
    const currentLogs: LLMAttemptLog[] = [];

    for (const providerName of configuredList) {
      const cleanName = providerName.trim();
      const provider = this.providers.get(cleanName);

      if (!provider) {
        console.warn(`[LLM MANAGER] Provider '${cleanName}' is not registered in system.`);
        continue;
      }

      const cb = getCircuitBreaker(cleanName);
      if (cb.isOpen()) {
        console.warn(`[LLM MANAGER] Skipping provider '${cleanName}' because Circuit Breaker is OPEN.`);
        currentLogs.push({ provider: cleanName, success: false, latencyMs: 0, reason: 'Circuit Breaker OPEN' });
        continue;
      }

      const startTime = Date.now();
      try {
        const rawProfile = await provider.parseCv(rawText);
        const latencyMs = Date.now() - startTime;
        cb.recordSuccess();

        const log: LLMAttemptLog = { provider: cleanName, success: true, latencyMs, statusCode: 200 };
        currentLogs.push(log);
        this.attemptLogs.push(log);
        console.log(`[LLM SUCCESS] Provider '${cleanName}' parsed CV successfully in ${latencyMs}ms.`);

        const { profile, needsReview } = validateAndCleanCvProfile(rawProfile);
        return { profile, needsReview, usedProvider: cleanName, logs: currentLogs };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const statusCode = err.statusCode || 500;
        const isValidationErr = err.isValidationError || statusCode === 400;

        cb.recordFailure();

        const log: LLMAttemptLog = { provider: cleanName, success: false, latencyMs, statusCode, reason: err.message };
        currentLogs.push(log);
        this.attemptLogs.push(log);

        console.error(`[LLM ERROR] Provider '${cleanName}' failed (${statusCode}): ${err.message}`);

        if (isValidationErr) {
          throw err;
        }

        console.warn(`[LLM FALLBACK] Falling back from '${cleanName}' due to retryable error (${statusCode}).`);
      }
    }

    throw new Error(`All configured LLM providers failed. Attempted: ${configuredList.join(', ')}`);
  }
}
export const llmManager = new LLMManager();
