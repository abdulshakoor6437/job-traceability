import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';

const router = Router();

router.use(requireAuth);

// POST /api/user/heartbeat (Explicit active heartbeat sent when user is active & tab visible)
router.post('/heartbeat', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userDal = req.userScopedDal!;
    await userDal.touchLastActive();
    const profile = await userDal.getProfile();

    res.json({
      message: 'Heartbeat recorded.',
      lastActiveAt: profile?.last_active_at,
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Heartbeat failed.' });
  }
});

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
    // Consider active if activity was within last 30 minutes
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

export default router;
