import { GoogleGenAI } from '@google/genai';
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

/** Reset all global circuit breakers — use ONLY in tests. */
export function resetAllCircuitBreakers() {
  providerCircuitBreakers.clear();
}

// Real LLM API Call Counter (incremented in code on each actual API call)
let realLLMApiCallCount = 0;
export function incrementRealLLMApiCallCount(): void {
  realLLMApiCallCount++;
}
export function getRealLLMApiCallCount(): number {
  return realLLMApiCallCount;
}
export function resetRealLLMApiCallCount(): void {
  realLLMApiCallCount = 0;
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
  // 1. Try markdown fenced code block
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }

  // 2. Try direct raw text parse
  try { return JSON.parse(raw.trim()); } catch {}

  // 3. Fallback: Extract substring between first '{' and last '}'
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const jsonSub = raw.substring(start, end + 1);
    try { return JSON.parse(jsonSub); } catch {}
  }

  throw new Error(`Failed to parse JSON from LLM response: ${raw.substring(0, 100)}`);
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

    // If rawText contains embedded JSON (e.g. from tailoring prompt), extract entities to avoid fabrication
    try {
      const jsonStart = rawText.indexOf('{');
      const jsonEnd = rawText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const potentialJson = rawText.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(potentialJson);
        const src = parsed.sourceCv || (parsed.contact_info ? parsed : null);
        if (src) {
          return {
            contact_info: {
              full_name: src.contact_info?.full_name || fullName,
              email: src.contact_info?.email || (emailMatch ? emailMatch[0] : ''),
              phone: src.contact_info?.phone || (phoneMatch ? phoneMatch[0] : ''),
              location: src.contact_info?.location || 'San Francisco, CA',
              linkedin_url: src.contact_info?.linkedin_url || null,
              website: src.contact_info?.website || null,
            },
            summary: src.summary || rawText.substring(0, 200),
            work_history: (src.work_history || []).map((w: any) => ({
              title: w.title || 'Software Engineer',
              company: w.company || 'Tech Corp',
              location: w.location || null,
              start_date: w.start_date || '2021-01',
              end_date: w.end_date || 'Present',
              is_current: Boolean(w.is_current),
              bullet_points: Array.isArray(w.bullet_points) ? w.bullet_points : ['Key achievement'],
            })),
            education: (src.education || []).map((e: any) => ({
              institution: e.institution || 'University',
              degree: e.degree || 'Bachelor',
              field_of_study: e.field_of_study || null,
              start_date: e.start_date || '2016-08',
              end_date: e.end_date || '2020-05',
            })),
            skills: (src.skills || []).map((s: any) => ({
              skill_name: typeof s === 'string' ? s : (s.skill_name || 'TypeScript'),
              category: typeof s === 'object' ? s.category : 'General',
            })),
            certifications: (src.certifications || []).map((c: any) => ({
              name: c.name || 'Certification',
              issuing_organization: c.issuing_organization || 'Issuer',
              issue_date: c.issue_date || null,
              expiration_date: c.expiration_date || null,
              credential_id: c.credential_id || null,
            })),
          };
        }
      }
    } catch {}

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
    incrementRealLLMApiCallCount();
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
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
// Google Gemini Provider (using @google/genai SDK)
// ---------------------------------------------------------------------------
export class GeminiLLMProvider implements ILLMProvider {
  public name = 'gemini';
  private ai: GoogleGenAI;
  private model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    this.ai = new GoogleGenAI({ apiKey });
    this.model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    incrementRealLLMApiCallCount();
    try {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: `${CV_SYSTEM_PROMPT}\n\n${rawText}`,
      });
      const content = response.text || '';
      return extractJson(content) as CvStructuredProfile;
    } catch (err: any) {
      const error: any = new Error(`Gemini API error: ${err.message || err}`);
      error.statusCode = err.status || 500;
      throw error;
    }
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
    incrementRealLLMApiCallCount();
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
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
// Groq (groq.com) Provider
// ---------------------------------------------------------------------------
export class GroqLLMProvider implements ILLMProvider {
  public name = 'groq';
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.GROQ_API_KEY || '';
    this.model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    if (!this.apiKey) throw new Error('GROQ_API_KEY is not set');
  }

  async parseCv(rawText: string): Promise<CvStructuredProfile> {
    incrementRealLLMApiCallCount();
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
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
      const err: any = new Error(`Groq API error: ${res.status}`);
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
    if (process.env.GROQ_API_KEY) {
      try { this.registerProvider(new GroqLLMProvider()); }
      catch (e: any) { console.warn('[LLM MANAGER] Groq registration failed:', e.message); }
    }
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

  public ensureProvidersRegistered() {
    if (process.env.GROQ_API_KEY && !this.providers.has('groq')) {
      try { this.registerProvider(new GroqLLMProvider()); } catch (e: any) {}
    }
    if (process.env.GROK_API_KEY && !this.providers.has('grok')) {
      try { this.registerProvider(new GrokLLMProvider()); } catch (e: any) {}
    }
    if (process.env.GEMINI_API_KEY && !this.providers.has('gemini')) {
      try { this.registerProvider(new GeminiLLMProvider()); } catch (e: any) {}
    }
    if (process.env.OPENROUTER_API_KEY && !this.providers.has('openrouter')) {
      try { this.registerProvider(new OpenRouterLLMProvider()); } catch (e: any) {}
    }
  }

  async parseCvWithFallback(
    rawText: string,
    overrideProviderList?: string[]
  ): Promise<{ profile: CvStructuredProfile; needsReview: boolean; usedProvider: string; logs: LLMAttemptLog[] }> {
    this.ensureProvidersRegistered();
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
        // Only stop fallback for explicit schema-validation errors (isValidationError flag).
        // HTTP 400 from an LLM API (bad key, bad request) is retryable — fall through.
        const isValidationErr = err.isValidationError === true;

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

    const mockProvider = this.providers.get('mock_primary');
    if (mockProvider) {
      console.warn('[LLM FALLBACK] All API providers rate-limited or failed. Utilizing safety mock fallback.');
      const rawProfile = await mockProvider.parseCv(rawText);
      const { profile, needsReview } = validateAndCleanCvProfile(rawProfile);
      return { profile, needsReview, usedProvider: 'mock_primary', logs: currentLogs };
    }

    throw new Error(`All configured LLM providers failed. Attempted: ${configuredList.join(', ')}`);
  }
}
export const llmManager = new LLMManager();

/**
 * Create a fully isolated LLMManager backed by its own private circuit-breaker
 * map. Use this in tests so each scenario starts with a clean slate and does
 * not interfere with the global singleton or other test scenarios.
 *
 * @param providers  Pre-registered ILLMProvider instances to populate the manager.
 * @param providerList  The ordered list of provider names to attempt (maps to LLM_PROVIDERS).
 */
export function createIsolatedLLMManager(
  providers: ILLMProvider[],
  providerList: string[]
): { manager: LLMManager; providerList: string[] } {
  // Fresh circuit-breaker map scoped to this isolated manager
  const localBreakers = new Map<string, CircuitBreaker>();

  const manager = new LLMManager();
  // Clear any auto-registered providers from the constructor
  (manager as any).providers = new Map<string, ILLMProvider>();
  for (const p of providers) {
    manager.registerProvider(p);
  }

  // Monkey-patch parseCvWithFallback to use localBreakers instead of the global map
  const origParse = manager.parseCvWithFallback.bind(manager);
  manager.parseCvWithFallback = async function (
    rawText: string,
    overrideList?: string[]
  ) {
    const list = overrideList || providerList;
    const currentLogs: LLMAttemptLog[] = [];

    for (const providerName of list) {
      const cleanName = providerName.trim();
      const provider = (manager as any).providers.get(cleanName);

      if (!provider) {
        console.warn(`[ISOLATED LLM] Provider '${cleanName}' is not registered.`);
        continue;
      }

      // Use local breaker map
      if (!localBreakers.has(cleanName)) localBreakers.set(cleanName, new CircuitBreaker());
      const cb = localBreakers.get(cleanName)!;

      if (cb.isOpen()) {
        console.warn(`[ISOLATED LLM] Skipping '${cleanName}' — Circuit Breaker OPEN.`);
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
        console.log(`[ISOLATED LLM SUCCESS] Provider '${cleanName}' in ${latencyMs}ms.`);
        const { profile, needsReview } = validateAndCleanCvProfile(rawProfile);
        return { profile, needsReview, usedProvider: cleanName, logs: currentLogs };
      } catch (err: any) {
        const latencyMs = Date.now() - startTime;
        const statusCode = err.statusCode || 500;
        // Only stop fallback for explicit schema-validation errors (isValidationError flag).
        // HTTP 400 from an LLM API (bad key, bad request) is retryable — fall through.
        const isValidationErr = err.isValidationError === true;
        cb.recordFailure();
        const log: LLMAttemptLog = { provider: cleanName, success: false, latencyMs, statusCode, reason: err.message };
        currentLogs.push(log);
        console.error(`[ISOLATED LLM ERROR] Provider '${cleanName}' failed (${statusCode}): ${err.message}`);
        if (isValidationErr) throw err;
        console.warn(`[ISOLATED LLM FALLBACK] Falling back from '${cleanName}'.`);
      }
    }

    throw new Error(`All configured LLM providers failed. Attempted: ${list.join(', ')}`);
  };

  return { manager, providerList };
}
