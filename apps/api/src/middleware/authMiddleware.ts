import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { createUserScopedDal, UserScopedDal } from '../dal';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userScopedDal?: UserScopedDal;
  sessionToken?: string;
  isPassive?: boolean;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let rawToken: string | undefined = req.cookies?.session_token;

    if (!rawToken && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        rawToken = parts[1];
      }
    }

    if (!rawToken) {
      res.status(401).json({ message: 'Authentication required. No session token provided.' });
      return;
    }

    const isPassive = req.headers['x-passive-request'] === 'true' || req.query.passive === 'true';
    const sessionData = await authService.validateAndTouchSession(rawToken, isPassive);

    if (!sessionData) {
      res.clearCookie('session_token');
      res.status(401).json({ message: 'Session expired or invalidated.' });
      return;
    }

    req.userId = sessionData.userId;
    req.sessionToken = rawToken;
    req.isPassive = isPassive;
    req.userScopedDal = createUserScopedDal(sessionData.userId);

    // Only active (non-passive) requests touch the last_active_at timestamp
    if (!isPassive) {
      req.userScopedDal.touchLastActive().catch((err) => {
        console.error('Failed to touch last active timestamp:', err);
      });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Internal server error during authentication.' });
  }
}
