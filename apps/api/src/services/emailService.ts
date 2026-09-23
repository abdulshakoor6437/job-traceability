export interface IEmailService {
  sendVerificationEmail(toEmail: string, token: string, verificationUrl: string): Promise<void>;
  sendPasswordResetEmail(toEmail: string, token: string, resetUrl: string): Promise<void>;
}

export class ConsoleEmailService implements IEmailService {
  async sendVerificationEmail(toEmail: string, token: string, verificationUrl: string): Promise<void> {
    console.log('\n======================================================');
    console.log('📧 [EMAIL SENDER - CONSOLE DEV PROVIDER]');
    console.log(`To: ${toEmail}`);
    console.log('Subject: Verify your email address');
    console.log(`Link: ${verificationUrl}`);
    console.log(`Verification Token: ${token}`);
    console.log('======================================================\n');
  }

  async sendPasswordResetEmail(toEmail: string, token: string, resetUrl: string): Promise<void> {
    console.log('\n======================================================');
    console.log('📧 [EMAIL SENDER - CONSOLE DEV PROVIDER]');
    console.log(`To: ${toEmail}`);
    console.log('Subject: Password Reset Request');
    console.log(`Link: ${resetUrl}`);
    console.log(`Reset Token: ${token}`);
    console.log('======================================================\n');
  }
}

export const emailService: IEmailService = new ConsoleEmailService();
