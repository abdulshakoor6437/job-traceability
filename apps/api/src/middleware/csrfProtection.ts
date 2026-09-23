import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Only check state-changing HTTP methods
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());

  if (isStateChanging) {
    const origin = req.headers.origin;

    if (origin && origin !== config.appUrl) {
      console.warn(`[CSRF PROTECT] Blocked request from unauthorized origin: ${origin}`);
      res.status(403).json({ message: 'CSRF Origin validation failed. Access denied.' });
      return;
    }
  }

  next();
}
