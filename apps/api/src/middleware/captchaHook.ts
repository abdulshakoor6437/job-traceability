import { Request, Response, NextFunction } from 'express';

export interface ICaptchaVerifier {
  verify(token?: string, clientIp?: string): Promise<boolean>;
}

export class DisabledCaptchaVerifier implements ICaptchaVerifier {
  async verify(token?: string, clientIp?: string): Promise<boolean> {
    // Disabled default allows requests through
    return true;
  }
}

export const captchaVerifier: ICaptchaVerifier = new DisabledCaptchaVerifier();

export async function captchaProtection(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = (req.body?.captchaToken || req.headers['x-captcha-token']) as string | undefined;
  const clientIp = req.ip || req.socket.remoteAddress;

  const isValid = await captchaVerifier.verify(token, clientIp);
  if (!isValid) {
    res.status(400).json({ message: 'CAPTCHA verification failed. Please try again.' });
    return;
  }

  next();
}
