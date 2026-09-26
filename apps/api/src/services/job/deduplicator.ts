import { NormalizedJob } from './types';

/**
 * Normalizes company names by lowercasing and stripping corporate entity suffixes.
 */
export function normalizeCompany(company: string): string {
  if (!company) return '';
  return company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|limited|co|technologies|solutions|group|holdings|services)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Normalizes job titles by lowercasing, expanding common abbreviations,
 * and stripping bracketed / parenthetical annotations (e.g., "(Remote)", "[US]").
 */
export function normalizeTitle(title: string): string {
  if (!title) return '';
  let clean = title
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(sr|sr\.)\b/g, 'senior')
    .replace(/\b(jr|jr\.)\b/g, 'junior')
    .replace(/\b(dev)\b/g, 'developer')
    .replace(/\b(eng)\b/g, 'engineer')
    .replace(/\b(mgr)\b/g, 'manager');

  return clean.replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Normalizes locations by stripping whitespace, punctuation, and standardizing 'remote'.
 */
export function normalizeLocation(loc: string | null): string {
  if (!loc) return '';
  const clean = loc.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
  if (clean.includes('remote') || clean.includes('worldwide') || clean.includes('anywhere')) {
    return 'remote';
  }
  return clean;
}

/**
 * Computes Dice's bigram similarity coefficient between two strings (0.0 to 1.0).
 */
export function stringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  if (str1.length < 2 || str2.length < 2) return str1 === str2 ? 1.0 : 0.0;

  const getBigrams = (str: string): Map<string, number> => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const b1 = getBigrams(str1);
  const b2 = getBigrams(str2);

  let intersection = 0;
  for (const [bigram, count1] of b1.entries()) {
    if (b2.has(bigram)) {
      intersection += Math.min(count1, b2.get(bigram)!);
    }
  }

  const total = (str1.length - 1) + (str2.length - 1);
  return (2.0 * intersection) / total;
}

/**
 * Checks if two jobs are likely duplicates across providers using fuzzy matching
 * on normalized company, title, and location.
 */
export function areLikelyDuplicates(jobA: NormalizedJob, jobB: NormalizedJob): boolean {
  const compA = normalizeCompany(jobA.company);
  const compB = normalizeCompany(jobB.company);

  if (!compA || !compB) return false;

  // Company must match or have high similarity (e.g., >= 0.85)
  const compSim = stringSimilarity(compA, compB);
  if (compSim < 0.80 && !compA.includes(compB) && !compB.includes(compA)) {
    return false;
  }

  // Title similarity
  const titleA = normalizeTitle(jobA.title);
  const titleB = normalizeTitle(jobB.title);
  const titleSim = stringSimilarity(titleA, titleB);

  // If titles are nearly identical (>= 0.82) or one contains the other
  const titlesMatch = titleSim >= 0.80 || titleA === titleB || (titleA.length > 5 && titleB.length > 5 && (titleA.includes(titleB) || titleB.includes(titleA)));

  if (!titlesMatch) {
    return false;
  }

  // Location check: if both have location, compare them.
  // If either is remote or both are remote, treat as matching location.
  if (jobA.remote && jobB.remote) {
    return true;
  }

  const locA = normalizeLocation(jobA.location);
  const locB = normalizeLocation(jobB.location);

  if (!locA || !locB || locA === 'remote' || locB === 'remote') {
    return true; // Weak or flexible location match when title and company are strong
  }

  const locSim = stringSimilarity(locA, locB);
  return locSim >= 0.70 || locA.includes(locB) || locB.includes(locA);
}

/**
 * Merges jobB into jobA, keeping the most complete fields and aggregating sources.
 */
export function mergeJobs(jobA: NormalizedJob, jobB: NormalizedJob): NormalizedJob {
  const sources = new Set<string>();
  (jobA.sourceProviders || [jobA.sourceProvider]).forEach((s) => sources.add(s));
  (jobB.sourceProviders || [jobB.sourceProvider]).forEach((s) => sources.add(s));

  const extIds: Record<string, string> = {
    ...(jobA.externalIds || { [jobA.sourceProvider]: jobA.externalId }),
    ...(jobB.externalIds || { [jobB.sourceProvider]: jobB.externalId }),
  };

  // Favor the job that has salary data
  const salaryMin = jobA.salaryMin !== null ? jobA.salaryMin : jobB.salaryMin;
  const salaryMax = jobA.salaryMax !== null ? jobA.salaryMax : jobB.salaryMax;
  const salaryCurrency = jobA.salaryCurrency || jobB.salaryCurrency;

  // Favor longer / fuller description
  const descA = jobA.description || '';
  const descB = jobB.description || '';
  const description = descA.length >= descB.length ? (jobA.description || null) : (jobB.description || null);

  // Apply URL
  const applyUrl = jobA.applyUrl || jobB.applyUrl;

  // Prefer earlier postedDate if available
  let postedDate = jobA.postedDate || jobB.postedDate;
  if (jobA.postedDate && jobB.postedDate) {
    try {
      postedDate = new Date(jobA.postedDate) < new Date(jobB.postedDate) ? jobA.postedDate : jobB.postedDate;
    } catch {
      postedDate = jobA.postedDate;
    }
  }

  return {
    ...jobA,
    salaryMin,
    salaryMax,
    salaryCurrency,
    description,
    applyUrl,
    postedDate,
    sourceProviders: Array.from(sources),
    externalIds: extIds,
  };
}

/**
 * Deduplicates an array of NormalizedJob items across providers using fuzzy matching.
 * Returns deduplicated jobs with merged sources.
 */
export function deduplicateJobs(jobs: NormalizedJob[]): NormalizedJob[] {
  const result: NormalizedJob[] = [];

  for (const job of jobs) {
    let merged = false;

    for (let i = 0; i < result.length; i++) {
      if (areLikelyDuplicates(result[i], job)) {
        result[i] = mergeJobs(result[i], job);
        merged = true;
        break;
      }
    }

    if (!merged) {
      result.push({
        ...job,
        sourceProviders: job.sourceProviders || [job.sourceProvider],
        externalIds: job.externalIds || { [job.sourceProvider]: job.externalId },
      });
    }
  }

  return result;
}
