import { z } from 'zod';
import { NormalizedJob } from './types';

export const NormalizedJobSchema = z.object({
  externalId: z.string().min(1, 'externalId is required'),
  sourceProvider: z.string().min(1, 'sourceProvider is required'),
  title: z.string().min(1, 'title is required'),
  company: z.string().min(1, 'company is required'),
  location: z.string().nullable().default(null),
  remote: z.boolean().default(false),
  salaryMin: z.number().nullable().default(null),
  salaryMax: z.number().nullable().default(null),
  salaryCurrency: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  applyUrl: z.string().nullable().default(null),
  postedDate: z.string().nullable().default(null),
  fetchedAt: z.string().default(() => new Date().toISOString()),
  sourceProviders: z.array(z.string()).optional(),
  externalIds: z.record(z.string()).optional(),
});

/**
 * Validates and normalizes any job record to guarantee compliance with the
 * NormalizedJob schema. Missing fields are coerced strictly to null, never
 * fabricated, estimated, or assigned synthetic placeholders.
 */
export function validateAndNormalizeJob(raw: Partial<NormalizedJob>): NormalizedJob {
  const sanitized = {
    externalId: raw.externalId ? String(raw.externalId).trim() : '',
    sourceProvider: raw.sourceProvider ? String(raw.sourceProvider).trim() : 'unknown',
    title: raw.title ? String(raw.title).trim() : '',
    company: raw.company ? String(raw.company).trim() : '',
    location: raw.location !== undefined && raw.location !== null && String(raw.location).trim().length > 0
      ? String(raw.location).trim()
      : null,
    remote: Boolean(raw.remote),
    // Missing fields (e.g. Remotive has no salary) are null, never fabricated or estimated
    salaryMin: typeof raw.salaryMin === 'number' && !isNaN(raw.salaryMin) ? raw.salaryMin : null,
    salaryMax: typeof raw.salaryMax === 'number' && !isNaN(raw.salaryMax) ? raw.salaryMax : null,
    salaryCurrency: raw.salaryCurrency && String(raw.salaryCurrency).trim().length > 0
      ? String(raw.salaryCurrency).trim().toUpperCase()
      : null,
    description: raw.description !== undefined && raw.description !== null && String(raw.description).trim().length > 0
      ? String(raw.description).trim()
      : null,
    applyUrl: raw.applyUrl !== undefined && raw.applyUrl !== null && String(raw.applyUrl).trim().length > 0
      ? String(raw.applyUrl).trim()
      : null,
    postedDate: raw.postedDate !== undefined && raw.postedDate !== null && String(raw.postedDate).trim().length > 0
      ? String(raw.postedDate).trim()
      : null,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
    sourceProviders: raw.sourceProviders || (raw.sourceProvider ? [raw.sourceProvider] : []),
    externalIds: raw.externalIds || (raw.sourceProvider && raw.externalId ? { [raw.sourceProvider]: raw.externalId } : {}),
  };

  // If no salary min and max, ensure currency is null (never invent a currency for non-existent salary)
  if (sanitized.salaryMin === null && sanitized.salaryMax === null) {
    sanitized.salaryCurrency = null;
  }

  const result = NormalizedJobSchema.safeParse(sanitized);
  if (!result.success) {
    throw new Error(`Job schema validation failed: ${result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
  }

  return result.data as NormalizedJob;
}
