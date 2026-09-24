import nodemailer from 'nodemailer';
import { config } from '../config/env';

export interface IEmailService {
  sendVerificationEmail(toEmail: string, token: string, verificationUrl: string): Promise<boolean>;
  sendAlreadyRegisteredEmail(toEmail: string, loginUrl: string, resetUrl: string): Promise<boolean>;
  sendPasswordResetEmail(toEmail: string, token: string, resetUrl: string): Promise<boolean>;
}

export class EmailService implements IEmailService {
  private getTransporter() {
    if (config.email.mode === 'smtp') {
      const isLocalHost = config.email.smtpHost === 'localhost' || config.email.smtpHost === '127.0.0.1';
      const options: any = {
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpSecure,
        connectionTimeout: 5000,
        socketTimeout: 5000,
      };

      // Item 2: Require TLS for any non-local SMTP host when not using implicit TLS
      if (!isLocalHost && !config.email.smtpSecure) {
        options.requireTLS = true;
      }

      if (config.email.smtpUser && config.email.smtpUser.trim().length > 0) {
        options.auth = {
          user: config.email.smtpUser,
          pass: config.email.smtpPassword,
        };
      }

      return nodemailer.createTransport(options);
    }
    return null;
  }

  async sendVerificationEmail(toEmail: string, token: string, verificationUrl: string): Promise<boolean> {
    const subject = 'Verify your email for Job Application Assistant';
    const textContent = `Hello,\n\nPlease verify your email address by opening the following link in your browser:\n${verificationUrl}\n\nNote: This link expires in 24 hours.\n\nIf you did not create an account, you can safely ignore this email.`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e0e0e0; padding: 30px; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">Email Verification Required</h2>
          <p>Thank you for registering with Job Application Assistant. Please verify your email address to activate your account.</p>
          <div style="margin: 25px 0;">
            <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Verify Email Address</a>
          </div>
          <p style="font-size: 13px; color: #666666;">Or copy and paste this link into your browser:<br><a href="${verificationUrl}" style="color: #2563eb;">${verificationUrl}</a></p>
          <p style="font-size: 13px; color: #888888; border-top: 1px solid #eeeeee; padding-top: 15px; margin-top: 25px;">
            Note: This link expires in 24 hours.<br>
            If you did not request this, please ignore this email.
          </p>
        </div>
      </body>
      </html>
    `;

    return this.dispatch(toEmail, subject, textContent, htmlContent);
  }

  async sendAlreadyRegisteredEmail(toEmail: string, loginUrl: string, resetUrl: string): Promise<boolean> {
    const subject = 'Account Registration Notice - Job Application Assistant';
    const textContent = `Hello,\n\nA registration attempt was made using your email address, but an account already exists.\n\nIf this was you, you can log in here:\n${loginUrl}\n\nIf you forgot your password, reset it here:\n${resetUrl}\n\nIf you did not request this, please ignore this email.`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e0e0e0; padding: 30px; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">Account Already Exists</h2>
          <p>A registration attempt was made using your email address, but an account is already active.</p>
          <div style="margin: 25px 0;">
            <a href="${loginUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block; margin-right: 10px;">Log In Now</a>
            <a href="${resetUrl}" style="background-color: #4b5563; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="font-size: 13px; color: #888888; border-top: 1px solid #eeeeee; padding-top: 15px; margin-top: 25px;">
            If you did not request this, please ignore this email.
          </p>
        </div>
      </body>
      </html>
    `;

    return this.dispatch(toEmail, subject, textContent, htmlContent);
  }

  async sendPasswordResetEmail(toEmail: string, token: string, resetUrl: string): Promise<boolean> {
    const subject = 'Reset your Job Application Assistant password';
    const textContent = `Hello,\n\nWe received a request to reset your password. You can set a new password by clicking the link below:\n${resetUrl}\n\nNote: This link expires in 1 hour.\n\nIf you did not request a password reset, please ignore this email.`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333; margin: 0; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e0e0e0; padding: 30px; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">Password Reset Request</h2>
          <p>We received a request to reset your password. Click the button below to choose a new password.</p>
          <div style="margin: 25px 0;">
            <a href="${resetUrl}" style="background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="font-size: 13px; color: #666666;">Or copy and paste this link into your browser:<br><a href="${resetUrl}" style="color: #dc2626;">${resetUrl}</a></p>
          <p style="font-size: 13px; color: #888888; border-top: 1px solid #eeeeee; padding-top: 15px; margin-top: 25px;">
            Note: This link expires in 1 hour.<br>
            If you did not request a password reset, please ignore this email.
          </p>
        </div>
      </body>
      </html>
    `;

    return this.dispatch(toEmail, subject, textContent, htmlContent);
  }

  private async dispatch(toEmail: string, subject: string, text: string, html: string): Promise<boolean> {
    if (config.email.mode === 'console') {
      console.log('\n======================================================');
      console.log('📧 [EMAIL SENDER - CONSOLE DEV PROVIDER]');
      console.log(`To: ${toEmail}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body:\n${text}`);
      console.log('======================================================\n');
      return true;
    }

    try {
      const transporter = this.getTransporter();
      if (!transporter) {
        throw new Error('SMTP transporter uninitialized.');
      }

      await transporter.sendMail({
        from: config.email.emailFrom,
        replyTo: config.email.emailReplyTo,
        to: toEmail,
        subject,
        text,
        html,
      });

      console.log(`✅ [EMAIL SERVICE] Sent SMTP email successfully to: ${toEmail}`);
      return true;
    } catch (error: any) {
      console.error(`❌ [EMAIL SERVICE ERROR] Failed to send email to ${toEmail}: ${error.message}`);
      return false;
    }
  }
}

export const emailService: IEmailService = new EmailService();
