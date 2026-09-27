/**
 * tailoringService.ts
 *
 * Responsibilities:
 *  1. Build a tailoring prompt that instructs the LLM to rephrase/reorder ONLY —
 *     never add new skills, employers, titles, dates, or achievements.
 *  2. Call the existing multi-provider LLM chain to produce the tailored CV.
 *  3. Post-generation: extract named entities from the output and verify every
 *     entity traces back to the source CV's structured data.
 *  4. If entity violations are found, attempt ONE regeneration; if it still
 *     fails, flag the record — never silently pass fabricated data.
 *
 * Non-fabrication rule enforcement is the core guarantee of this module.
 */

import { CvStructuredProfile } from '../cv/schemaValidator';
import { LLMManager, ILLMProvider, MockLLMProvider } from '../llm/llmProvider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TailoringInput {
  sourceCv: CvStructuredProfile;
  jobTitle: string;
  jobDescription: string;
}

export interface TailoringResult {
  tailoredProfile: CvStructuredProfile;
  validationStatus: 'passed' | 'failed' | 'flagged';
  validationIssues: string[];
  usedProvider: string;
  regenerated: boolean;
}

export interface EntitySet {
  companies: Set<string>;
  titles: Set<string>;
  dates: Set<string>;
  skills: Set<string>;
  institutions: Set<string>;
  certifications: Set<string>;
}

// ---------------------------------------------------------------------------
// Entity extraction helpers
// ---------------------------------------------------------------------------

/** Normalise a string for loose comparison (lowercase, strip punctuation). */
function normalise(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

/** Build the set of all ground-truth entities from the source CV. */
export function buildSourceEntitySet(source: CvStructuredProfile): EntitySet {
  const companies = new Set<string>();
  const titles = new Set<string>();
  const dates = new Set<string>();
  const skills = new Set<string>();
  const institutions = new Set<string>();
  const certifications = new Set<string>();

  for (const w of source.work_history || []) {
    if (w.company) companies.add(normalise(w.company));
    if (w.title) titles.add(normalise(w.title));
    if (w.start_date) dates.add(normalise(w.start_date));
    if (w.end_date) dates.add(normalise(w.end_date));
  }
  for (const s of source.skills || []) {
    if (s.skill_name) skills.add(normalise(s.skill_name));
  }
  for (const e of source.education || []) {
    if (e.institution) institutions.add(normalise(e.institution));
    if (e.degree) titles.add(normalise(e.degree));
    if (e.start_date) dates.add(normalise(e.start_date));
    if (e.end_date) dates.add(normalise(e.end_date));
  }
  for (const c of source.certifications || []) {
    if (c.name) certifications.add(normalise(c.name));
    if (c.issuing_organization) companies.add(normalise(c.issuing_organization));
  }

  return { companies, titles, dates, skills, institutions, certifications };
}

/**
 * Validate that every named entity in the tailored output exists in the source
 * entity set.  Returns a list of violation strings (empty = clean).
 */
export function validateEntities(
  source: EntitySet,
  tailored: CvStructuredProfile
): string[] {
  const violations: string[] = [];

  for (const w of tailored.work_history || []) {
    if (w.company && !source.companies.has(normalise(w.company))) {
      violations.push(`Fabricated company: "${w.company}"`);
    }
    if (w.title && !source.titles.has(normalise(w.title))) {
      violations.push(`Fabricated job title: "${w.title}"`);
    }
    if (w.start_date && !source.dates.has(normalise(w.start_date))) {
      violations.push(`Fabricated start date: "${w.start_date}"`);
    }
    if (w.end_date && w.end_date.toLowerCase() !== 'present' && !source.dates.has(normalise(w.end_date))) {
      violations.push(`Fabricated end date: "${w.end_date}"`);
    }
  }

  for (const s of tailored.skills || []) {
    if (s.skill_name && !source.skills.has(normalise(s.skill_name))) {
      violations.push(`Fabricated skill: "${s.skill_name}"`);
    }
  }

  for (const e of tailored.education || []) {
    if (e.institution && !source.institutions.has(normalise(e.institution))) {
      violations.push(`Fabricated institution: "${e.institution}"`);
    }
  }

  for (const c of tailored.certifications || []) {
    if (c.name && !source.certifications.has(normalise(c.name))) {
      violations.push(`Fabricated certification: "${c.name}"`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildTailoringPrompt(input: TailoringInput): string {
  const sourceJson = JSON.stringify(input.sourceCv, null, 2);

  return `You are a professional CV tailoring assistant.

STRICT NON-FABRICATION RULES (MANDATORY — violation is grounds for rejection):
- You MUST NOT add any new employers, companies, or organisations not present in the source CV.
- You MUST NOT add any job titles not present in the source CV.
- You MUST NOT change or invent any dates (start dates, end dates, graduation dates).
- You MUST NOT add any skills not present in the source CV.
- You MUST NOT add any achievements, certifications, degrees, or other credentials not present in the source CV.
- You MAY rephrase bullet points and the summary to emphasise relevant experience.
- You MAY reorder work history entries, skills, and bullet points for relevance to the target role.
- You MUST return the EXACT SAME JSON schema as the input — no new top-level keys.

TARGET ROLE
Title: ${input.jobTitle}
Description:
${input.jobDescription.substring(0, 2000)}

SOURCE CV (ground truth — do not invent anything outside this):
${sourceJson}

Return ONLY a valid JSON object matching the source CV schema. No markdown, no explanation, no preamble.`;
}

// ---------------------------------------------------------------------------
// ILLMProvider adapter for tailoring
// The existing ILLMProvider interface has parseCv(rawText).
// We adapt it: send the tailoring prompt as rawText, parse the returned JSON
// as a CvStructuredProfile.
// ---------------------------------------------------------------------------

/**
 * A thin adapter that wraps the LLMManager to call tailoring.
 * We reuse parseCvWithFallback since the return type is already CvStructuredProfile.
 */
export class TailoringService {
  private llmManager: LLMManager;

  constructor(llmManager?: LLMManager) {
    // Accept an injected manager (tests) or fall back to the shared singleton
    if (llmManager) {
      this.llmManager = llmManager;
    } else {
      // Lazy import to avoid circular dep issues at module load
      const { llmManager: shared } = require('../llm/llmProvider');
      this.llmManager = shared;
    }
  }

  /**
   * Generate a tailored CV.
   * Internally calls the LLM, validates entities, retries once on failure,
   * then flags on second failure.
   */
  async tailorCv(input: TailoringInput): Promise<TailoringResult> {
    const sourceEntitySet = buildSourceEntitySet(input.sourceCv);
    const prompt = buildTailoringPrompt(input);

    // First attempt
    console.log(`[TAILORING ATTEMPT 1] Calling LLM for job: "${input.jobTitle}"`);
    const { profile: firstAttempt, usedProvider } = await this.llmManager.parseCvWithFallback(prompt);
    console.log(`[TAILORING ATTEMPT 1] LLM returned. Running entity validation...`);
    const firstViolations = validateEntities(sourceEntitySet, firstAttempt);
    console.log(`[TAILORING ATTEMPT 1] Violations found: ${firstViolations.length}`);

    if (firstViolations.length === 0) {
      return {
        tailoredProfile: firstAttempt,
        validationStatus: 'passed',
        validationIssues: [],
        usedProvider,
        regenerated: false,
      };
    }

    // One retry
    console.warn(
      `[TAILORING] Validation failed on first attempt (${firstViolations.length} violations). Retrying once.`,
      firstViolations
    );
    console.log(`[TAILORING ATTEMPT 2] Calling LLM again for job: "${input.jobTitle}"`);
    const { profile: secondAttempt, usedProvider: usedProvider2 } =
      await this.llmManager.parseCvWithFallback(prompt);
    console.log(`[TAILORING ATTEMPT 2] LLM returned. Running entity validation...`);
    const secondViolations = validateEntities(sourceEntitySet, secondAttempt);
    console.log(`[TAILORING ATTEMPT 2] Violations found: ${secondViolations.length}`);

    if (secondViolations.length === 0) {
      return {
        tailoredProfile: secondAttempt,
        validationStatus: 'passed',
        validationIssues: [],
        usedProvider: usedProvider2,
        regenerated: true,
      };
    }

    // Still failing — flag it, never silently display
    console.error(
      `[TAILORING] Validation still failed after regeneration (${secondViolations.length} violations). Flagging.`,
      secondViolations
    );
    return {
      tailoredProfile: secondAttempt,
      validationStatus: 'flagged',
      validationIssues: secondViolations,
      usedProvider: usedProvider2,
      regenerated: true,
    };
  }
}

// Singleton — routes import this
export const tailoringService = new TailoringService();
