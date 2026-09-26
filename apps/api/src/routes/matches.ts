import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { matchingService } from '../services/matching/matchingService';

const router = Router();
router.use(requireAuth);

const MatchSearchRequestSchema = z.object({
  location: z.string().optional(),
  remoteOnly: z.boolean().optional(),
  minScore: z.number().min(0).max(100).optional(),
  includeExcluded: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  forceRefresh: z.boolean().optional(),
});

/**
 * POST /api/matches/search
 * User-scoped matching and ranking endpoint.
 * Requires authenticated session/token (cross-user isolated).
 *
 * Request Body:
 * {
 *   "location"?: "San Francisco",
 *   "remoteOnly"?: true,
 *   "minScore"?: 40,
 *   "includeExcluded"?: false,
 *   "limit"?: 50,
 *   "forceRefresh"?: false
 * }
 */
router.post('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parseResult = MatchSearchRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Bad Request',
        message: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      });
      return;
    }

    const userId = req.userId!;
    const { location, remoteOnly, minScore, includeExcluded, limit, forceRefresh } = parseResult.data;

    const result = await matchingService.searchMatches(
      userId,
      {
        location,
        remoteOnly,
        minScore,
        includeExcluded,
        limit,
      },
      { forceRefresh }
    );

    res.status(200).json({
      success: true,
      data: {
        matches: result.matches,
        totalMatches: result.totalMatches,
        fromCache: result.fromCache,
        cacheId: result.cacheId,
        jobPoolVersion: result.jobPoolVersion,
        cvProfileId: result.cvProfileId,
      },
    });
  } catch (err: any) {
    if (err.message?.includes('No active CV profile found')) {
      res.status(400).json({
        error: 'Precondition Required',
        message: err.message,
      });
      return;
    }

    console.error('Match search endpoint error:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message || 'Failed to search matches',
    });
  }
});

export default router;
