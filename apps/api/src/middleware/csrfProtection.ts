import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env';

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Exclude webhooks path (Item 3 & Item 10 exemption)
  const reqPath = req.path || req.originalUrl || '';
  if (reqPath.startsWith('/api/webhooks')) {
    return next();
  }

  // Only check state-changing HTTP methods
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
  if (!isStateChanging) {
    return next();
  }

  const origin = req.headers.origin;
  const secFetchSite = req.headers['sec-fetch-site'];

  // Require Origin header equal to APP_URL or Sec-Fetch-Site same-origin / same-site
  const isOriginValid = origin && origin === config.appUrl;
  const isSecFetchValid = secFetchSite === 'same-origin' || secFetchSite === 'same-site';

  if (!isOriginValid && !isSecFetchValid) {
    res.status(403).json({ message: 'Forbidden: CSRF protection validation failed.' });
    return;
  }

  next();
}
