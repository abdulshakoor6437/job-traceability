import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';

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

export default router;
