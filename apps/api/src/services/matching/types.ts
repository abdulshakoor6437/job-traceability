export interface IEmbeddingProvider {
  readonly name: string;
  readonly model: string;
  generateEmbedding(text: string): Promise<number[]>;
}

export type MatchLabel = 'Strong match' | 'Good match' | 'Possible match' | 'Weak match';

export interface ScoredJobMatch {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string | null;
  applyUrl: string | null;
  score: number; // 0 - 100
  label: MatchLabel;
  isExcluded: boolean;
  excludedReason: string | null;
  explanation: string | null;
  rankOrder: number;
}

export interface MatchSearchParams {
  location?: string;
  remoteOnly?: boolean;
  minScore?: number;
  includeExcluded?: boolean;
  limit?: number;
}

export interface MatchSearchResult {
  matches: ScoredJobMatch[];
  totalMatches: number;
  fromCache: boolean;
  cacheId: string;
  jobPoolVersion: string;
  cvProfileId: string;
}
