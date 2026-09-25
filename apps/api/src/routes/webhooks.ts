import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { authDal } from '../dal/authDal';
import { config } from '../config/env';

const router = Router();

// Item 3: Dedicated webhook rate limiter
export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Max 30 requests per minute
  message: { message: 'Too many webhook requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(webhookRateLimiter);

// Item 3: Webhook authentication middleware
function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  // 1. Unconfigured WEBHOOK_SECRET returns 404
  if (!config.webhookSecret || config.webhookSecret.trim().length === 0) {
    res.status(404).json({ message: 'Webhook endpoint is disabled.' });
    return;
  }

  // 2. Extract provided secret from X-Webhook-Secret header or Authorization header ONLY
  let providedSecret = (req.headers['x-webhook-secret'] as string) || '';
  if (!providedSecret && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    providedSecret = parts.length === 2 ? parts[1] : parts[0];
  }

  if (!providedSecret) {
    res.status(401).json({ message: 'Webhook authentication secret is required.' });
    return;
  }

  // 3. Constant-time comparison to prevent timing attacks
  const providedBuf = Buffer.from(providedSecret);
  const expectedBuf = Buffer.from(config.webhookSecret);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(401).json({ message: 'Invalid webhook authentication secret.' });
    return;
  }

  next();
}

router.use(requireWebhookSecret);

// POST /api/webhooks/email-suppression (Provider webhook endpoint for bounces & complaints)
router.post('/email-suppression', async (req: Request, res: Response) => {
  try {
    const { email, reason, type } = req.body;
    const targetEmail = email || req.body?.recipient || req.body?.emailAddress;
    const suppressionReason = reason || type || 'bounce';

    if (!targetEmail || typeof targetEmail !== 'string') {
      res.status(400).json({ message: 'Missing target email address.' });
      return;
    }

    await authDal.suppressEmail(targetEmail, suppressionReason);
    console.log(`📌 [WEBHOOK] Suppressed email ${targetEmail} via provider webhook. Reason: ${suppressionReason}`);

    res.json({ message: 'Suppression event recorded successfully.' });
  } catch (error: any) {
    console.error('Email suppression webhook error:', error);
    res.status(500).json({ message: 'Failed to process suppression webhook.' });
  }
});

export default router;
