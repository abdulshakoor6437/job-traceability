import { MATCHING_CONFIG, RedFlagRule } from './matchingConfig';

export interface RedFlagCheckResult {
  isExcluded: boolean;
  excludedReason: string | null;
  matchedPhrase?: string;
}

/**
 * Screens a job description for mandatory face/facial recognition, selfie verification,
 * video introduction, video resume, or AI video screening preconditions.
 *
 * All phrase definitions and patterns are configured in matchingConfig.ts (never hardcoded in logic).
 * Differentiates precondition hurdles from standard 2-way live interviews (e.g. 'video call interview').
 */
export function screenJobDescription(
  description?: string | null,
  rules: RedFlagRule[] = MATCHING_CONFIG.redFlagPhrases
): RedFlagCheckResult {
  if (!description || !description.trim()) {
    return { isExcluded: false, excludedReason: null };
  }

  const text = description.toLowerCase();

  for (const rule of rules) {
    // 1. Regex pattern check if defined in config rule
    if (rule.pattern && rule.pattern.test(description)) {
      return {
        isExcluded: true,
        excludedReason: rule.reason,
        matchedPhrase: rule.phrase,
      };
    }

    // 2. Substring match for multi-word phrase
    const phrase = rule.phrase.toLowerCase().trim();
    if (!phrase) continue;

    if (text.includes(phrase)) {
      return {
        isExcluded: true,
        excludedReason: rule.reason,
        matchedPhrase: rule.phrase,
      };
    }
  }

  return { isExcluded: false, excludedReason: null };
}
