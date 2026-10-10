import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { createUserScopedDal } from '../dal/userScopedDal';

const router = Router();
router.use(requireAuth);

// GET /api/notifications
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const unreadOnly = req.query.unreadOnly === 'true';
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const userDal = createUserScopedDal(userId);
    const result = await userDal.getNotifications({ unreadOnly, limit });

    res.json({
      success: true,
      notifications: result.notifications,
      unreadCount: result.unreadCount,
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS ROUTE] Error fetching notifications:', error.message);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const userDal = createUserScopedDal(userId);
    const updatedCount = await userDal.markAllNotificationsRead();

    res.json({
      success: true,
      message: `Marked ${updatedCount} notifications as read.`,
      updatedCount,
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS ROUTE] Error marking all read:', error.message);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const notificationId = req.params.id;

    const userDal = createUserScopedDal(userId);
    const success = await userDal.markNotificationRead(notificationId);

    if (!success) {
      res.status(404).json({ error: 'Not Found', message: 'Notification not found or access denied.' });
      return;
    }

    res.json({
      success: true,
      message: 'Notification marked as read.',
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS ROUTE] Error marking read:', error.message);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

export default router;
