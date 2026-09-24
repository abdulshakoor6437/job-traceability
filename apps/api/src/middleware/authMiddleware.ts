import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { createUserScopedDal, UserScopedDal } from '../dal';
import { config } from '../config/env';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userScopedDal?: UserScopedDal;
  sessionToken?: string;
  isActivityRoute?: boolean;
}

// Item 16: Keep EXACTLY ONE heartbeat route 'POST:/api/session/heartbeat'
const ACTIVITY_ROUTES_ALLOWLIST = new Set([
  'POST:/api/session/heartbeat',
]);

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let rawToken: string | undefined = req.cookies?.session_token;

    // Item 12: Accept Bearer header ONLY when NODE_ENV is not production ('development')
    if (!rawToken && config.env === 'development' && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        rawToken = parts[1];
      }
    }

    if (!rawToken) {
      res.status(401).json({ message: 'Authentication required. No valid session cookie provided.' });
      return;
    }

    const routeKey = `${req.method.toUpperCase()}:${req.baseUrl}${req.path}`;
    const isActivityRoute = ACTIVITY_ROUTES_ALLOWLIST.has(routeKey);

    const sessionData = await authService.validateAndTouchSession(rawToken, isActivityRoute);

    if (!sessionData) {
      res.clearCookie('session_token');
      res.status(401).json({ message: 'Session expired or invalidated.' });
      return;
    }

    req.userId = sessionData.userId;
    req.sessionToken = rawToken;
    req.isActivityRoute = isActivityRoute;
    req.userScopedDal = createUserScopedDal(sessionData.userId);

    if (isActivityRoute) {
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
