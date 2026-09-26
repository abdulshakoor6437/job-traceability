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
 * All phrase definitions are configured in matchingConfig.ts (never hardcoded in logic).
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
    const phrase = rule.phrase.toLowerCase().trim();
    if (!phrase) continue;

    // Substring match for multi-word phrase
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
