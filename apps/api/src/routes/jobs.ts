import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { jobSearchService } from '../services/job/jobSearchService';

const router = Router();

const JobSearchRequestSchema = z
  .object({
    role: z.string().optional(),
    query: z.string().optional(),
    keywords: z.string().optional(),
    location: z.string().optional().nullable(),
    filters: z
      .object({
        remoteOnly: z.boolean().optional(),
        minSalary: z.number().optional(),
        salaryCurrency: z.string().optional(),
        limit: z.number().optional(),
      })
      .optional(),
    forceRefresh: z.boolean().optional(),
    ttlHours: z.number().optional(),
  })
  .refine((data) => Boolean((data.role && data.role.trim()) || (data.query && data.query.trim()) || (data.keywords && data.keywords.trim())), {
    message: "At least one of 'role', 'query', or 'keywords' must be provided as a non-empty string",
  });

/**
 * POST /api/jobs/search
 * Takes role/keywords, location, and filters.
 * Returns normalized, deduplicated, shared-cached job results.
 * Per Requirement 7, this endpoint stores and returns shared global data
 * without associating user-identifying info with the cached jobs.
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const parseResult = JobSearchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: parseResult.error.errors.map((e) => e.message).join('; '),
      });
      return;
    }

    const { role, query, keywords, location, filters, forceRefresh, ttlHours } = parseResult.data;
    const searchTerm = (role || query || keywords)!.trim();

    const searchResult = await jobSearchService.searchJobs({
      query: searchTerm,
      location: location || null,
      filters,
      forceRefresh,
      ttlHours,
    });

    res.status(200).json({
      success: true,
      data: {
        jobs: searchResult.jobs,
        totalCount: searchResult.totalCount,
        fromCache: searchResult.fromCache,
        cacheKey: searchResult.cacheKey,
        externalCallsMade: searchResult.externalCallsMade,
        providersQueried: searchResult.providersQueried,
        skippedProviders: searchResult.skippedProviders,
      },
    });
  } catch (err: any) {
    console.error('Job search endpoint error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message || 'Failed to execute job search',
    });
  }
});

export default router;
