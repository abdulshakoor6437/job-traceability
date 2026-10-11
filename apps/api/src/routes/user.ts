import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { JOB_SOURCING_CONFIG } from '../services/job/config';
import { jobDal } from '../dal/jobDal';
import { tailoredCvDal } from '../dal/tailoredCvDal';

const router = Router();

router.use(requireAuth);



// GET /api/user/active-signal
router.get('/active-signal', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userDal = req.userScopedDal!;
    const profile = await userDal.getProfile();

    if (!profile) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const lastActive = profile.last_active_at ? new Date(profile.last_active_at) : null;
    const now = new Date();
    const isActive = lastActive
      ? (now.getTime() - lastActive.getTime()) <= 30 * 60 * 1000
      : false;

    res.json({
      userId: req.userId,
      lastActiveAt: profile.last_active_at,
      isActive,
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve active signal.' });
  }
});

// GET /api/user/settings
router.get('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userDal = req.userScopedDal!;
    const settings = await userDal.getSettings();

    if (!settings) {
      res.status(404).json({ message: 'User settings not found.' });
      return;
    }

    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve user settings.' });
  }
});

// PATCH /api/user/settings
router.patch('/settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { timezone } = req.body;
    if (!timezone || typeof timezone !== 'string') {
      res.status(400).json({ message: 'Timezone string is required.' });
      return;
    }

    const userDal = req.userScopedDal!;
    const updated = await userDal.updateSettings(timezone);

    res.json({ message: 'Settings updated successfully.', settings: updated });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to update user settings.' });
  }
});

// PUT /api/user/settings/digest
router.put('/settings/digest', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { optOut } = req.body;
    if (typeof optOut !== 'boolean') {
      res.status(400).json({ message: 'optOut boolean field is required.' });
      return;
    }

    const userDal = req.userScopedDal!;
    const updated = await userDal.updateDigestOptOut(optOut);

    res.json({ message: 'Digest settings updated successfully.', settings: updated });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to update digest settings.' });
  }
});

// GET /api/user/search-preferences
router.get('/search-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userDal = req.userScopedDal!;
    const prefs = await userDal.getSearchPreferences();

    if (!prefs) {
      res.status(404).json({ message: 'User search preferences not found.' });
      return;
    }

    res.json({
      preferences: {
        id: prefs.id,
        userId: prefs.user_id,
        role: prefs.role,
        location: prefs.location,
        filters: prefs.filters_json ? JSON.parse(prefs.filters_json) : null,
        createdAt: prefs.created_at,
        updatedAt: prefs.updated_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve search preferences.' });
  }
});

// PUT /api/user/search-preferences
router.put('/search-preferences', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { role, location, filters } = req.body;
    if (!role || typeof role !== 'string' || !role.trim()) {
      res.status(400).json({ message: 'Role string is required for search preferences.' });
      return;
    }

    const userDal = req.userScopedDal!;
    const updated = await userDal.updateSearchPreferences(role, location, filters);

    res.json({
      message: 'Search preferences updated successfully.',
      preferences: {
        id: updated.id,
        userId: updated.user_id,
        role: updated.role,
        location: updated.location,
        filters: updated.filters_json ? JSON.parse(updated.filters_json) : null,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || 'Failed to update search preferences.' });
  }
});

// GET /api/user/limits — Unified Usage & Limits panel endpoint
router.get('/limits', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // 1. JSearch monthly quota
    const jsearchLimitConfig = JOB_SOURCING_CONFIG.providerQuotas['jsearch'] || { monthlyLimit: 500 };
    const jsearchLimit: number = jsearchLimitConfig.monthlyLimit ?? 500;
    const jsearchUsedRaw = await jobDal.getProviderUsageThisMonth('jsearch');
    const jsearchRapidUsed = await jobDal.getProviderUsageThisMonth('jsearch_rapidapi');
    const jsearchUsed = jsearchUsedRaw + jsearchRapidUsed;

    // 2. SerpApi monthly quota
    const serpLimitConfig = JOB_SOURCING_CONFIG.providerQuotas['serpapi'] || { monthlyLimit: 100 };
    const serpLimit: number = serpLimitConfig.monthlyLimit ?? 100;
    const serpUsedRaw = await jobDal.getProviderUsageThisMonth('serpapi');
    const serpGoogleUsed = await jobDal.getProviderUsageThisMonth('google_jobs_serpapi');
    const serpUsed = serpUsedRaw + serpGoogleUsed;

    // 3. Module 4 daily tailoring cap
    const rawTailorCap = process.env.TAILORED_CV_DAILY_CAP;
    const tailorLimit = parseInt(rawTailorCap || '', 10) > 0 ? parseInt(rawTailorCap || '', 10) : 20;
    const tailorUsed = await tailoredCvDal.getDailyGenerationCount(userId);

    // 4. Module 5 background job throttling status
    const userDal = req.userScopedDal!;
    const searchPrefs = await userDal.getSearchPreferences();
    let bgJobThrottled = false;
    let bgThrottleReason: string | null = null;

    if (jsearchLimit !== Infinity && jsearchUsed >= jsearchLimit) {
      bgJobThrottled = true;
      bgThrottleReason = `JSearch monthly quota exhausted (${jsearchUsed}/${jsearchLimit} calls).`;
    } else if (serpLimit !== Infinity && serpUsed >= serpLimit) {
      bgJobThrottled = true;
      bgThrottleReason = `SerpApi monthly quota exhausted (${serpUsed}/${serpLimit} calls).`;
    }

    const bgStatus = !searchPrefs
      ? 'inactive'
      : (bgJobThrottled ? 'throttled' : 'active');

    res.json({
      jsearch: {
        provider: 'jsearch',
        monthlyLimit: jsearchLimit,
        usedThisMonth: jsearchUsed,
        remaining: Math.max(0, jsearchLimit - jsearchUsed),
        isExhausted: jsearchLimit !== Infinity && jsearchUsed >= jsearchLimit,
      },
      serpapi: {
        provider: 'serpapi',
        monthlyLimit: serpLimit,
        usedThisMonth: serpUsed,
        remaining: Math.max(0, serpLimit - serpUsed),
        isExhausted: serpLimit !== Infinity && serpUsed >= serpLimit,
      },
      tailoring: {
        dailyLimit: tailorLimit,
        usedToday: tailorUsed,
        remaining: Math.max(0, tailorLimit - tailorUsed),
        isExhausted: tailorUsed >= tailorLimit,
      },
      backgroundJob: {
        status: bgStatus,
        isThrottled: bgJobThrottled,
        throttleReason: bgThrottleReason,
        intervalHours: 4,
        hasActivePreferences: Boolean(searchPrefs),
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve usage limits.', error: error.message });
  }
});

export default router;
