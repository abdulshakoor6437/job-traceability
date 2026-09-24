import { Router, Request, Response } from 'express';
import { authService } from '../services/authService';
import { authDal } from '../dal/authDal';
import { authRateLimiter } from '../middleware/rateLimiter';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { config } from '../config/env';

const router = Router();

// Signup
router.post('/signup', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required.' });
      return;
    }

    const result = await authService.signup(email, password);
    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Signup failed.' });
  }
});

// Verify Email
router.post('/verify-email', async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ message: 'Verification token is required.' });
      return;
    }

    const success = await authService.verifyEmail(token);
    if (!success) {
      res.status(400).json({ message: 'Invalid or expired verification token.' });
      return;
    }

    res.json({ message: 'Email verified successfully. You can now log in.' });
  } catch (error: any) {
    res.status(500).json({ message: 'Email verification failed.' });
  }
});

// Resend Verification Email (Item 7)
router.post('/resend-verification', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ message: 'Email is required.' });
      return;
    }

    const message = await authService.resendVerification(email);
    res.json({ message });
  } catch (error: any) {
    res.status(500).json({ message: 'Resend verification request failed.' });
  }
});

// Login (Item 12: Cookie ONLY, session token NOT returned in JSON body)
router.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required.' });
      return;
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || req.socket.remoteAddress || '127.0.0.1';
    const result = await authService.login(email, password, clientIp);
    if ('error' in result) {
      res.status(401).json({ message: result.error });
      return;
    }

    const isProduction = config.env !== 'development';
    res.cookie('session_token', result.rawToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: config.session.maxLifetimeHours * 60 * 60 * 1000,
      path: '/',
    });

    // Item 12: Session token is NOT returned in JSON body.
    res.json({
      message: 'Logged in successfully.',
      userId: result.userId,
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Login failed.' });
  }
});

// Logout
router.post('/logout', async (req: AuthenticatedRequest, res: Response) => {
  try {
    let rawToken: string | undefined = req.cookies?.session_token;

    if (!rawToken && config.env === 'development' && req.headers.authorization) {
      const parts = req.headers.authorization.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        rawToken = parts[1];
      }
    }

    if (rawToken) {
      await authService.logout(rawToken);
    }

    res.clearCookie('session_token', { path: '/' });
    res.json({ message: 'Logged out successfully. Token invalidated.' });
  } catch (error: any) {
    res.status(500).json({ message: 'Logout failed.' });
  }
});

// Request Password Reset
router.post('/request-password-reset', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ message: 'Email is required.' });
      return;
    }

    const message = await authService.requestPasswordReset(email);
    res.json({ message });
  } catch (error: any) {
    res.status(500).json({ message: 'Password reset request failed.' });
  }
});

// Reset Password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ message: 'Token and new password are required.' });
      return;
    }

    const success = await authService.resetPassword(token, newPassword);
    if (!success) {
      res.status(400).json({ message: 'Invalid or expired password reset token.' });
      return;
    }

    res.json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Password reset failed.' });
  }
});

// Get Logged-in User Profile (Protected)
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userDal = req.userScopedDal!;
    const user = await userDal.getProfile();

    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        is_verified: Boolean(user.is_verified),
        last_active_at: user.last_active_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to fetch user profile.' });
  }
});

export default router;
