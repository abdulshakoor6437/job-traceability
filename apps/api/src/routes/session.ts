import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';

const router = Router();

router.use(requireAuth);

// POST /api/session/heartbeat (Item 16: Single explicit heartbeat route)
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

export default router;
