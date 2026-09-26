import { MatchLabel } from './types';

/**
 * Computes cosine similarity between two numeric vectors in application code (Node).
 * Formula: dot(A, B) / (norm(A) * norm(B))
 */
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    throw new Error('computeCosineSimilarity: inputs must be arrays of numbers');
  }
  if (vecA.length === 0 || vecB.length === 0) {
    throw new Error('computeCosineSimilarity: vectors cannot be empty');
  }
  if (vecA.length !== vecB.length) {
    throw new Error(
      `computeCosineSimilarity: vector dimensions do not match (${vecA.length} vs ${vecB.length})`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  const cosine = dotProduct / denominator;
  // Guard against precision overshoot: clamp strictly between -1.0 and 1.0
  return Math.max(-1.0, Math.min(1.0, cosine));
}

/**
 * Converts a cosine similarity value into a 0-100 integer score.
 * For normalized semantic embeddings, cosine similarity generally ranges between 0.0 and 1.0.
 */
export function convertCosineToScore(cosine: number): number {
  // Normalize into 0 to 1 range (guarding negative cosine values to 0)
  const clamped = Math.max(0, Math.min(1.0, cosine));
  return Math.round(clamped * 100);
}

/**
 * Returns qualitative label for a given score:
 * - 80+     : Strong match
 * - 60 - 79 : Good match
 * - 40 - 59 : Possible match
 * - < 40    : Weak match (excluded from default view)
 */
export function getMatchLabel(score: number): MatchLabel {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Good match';
  if (score >= 40) return 'Possible match';
  return 'Weak match';
}

/**
 * Returns true if a match score is below 40 and should be excluded from default view.
 */
export function isScoreExcludedByDefault(score: number): boolean {
  return score < 40;
}
