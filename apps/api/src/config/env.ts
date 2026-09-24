import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const rawEnv = process.env.NODE_ENV ? process.env.NODE_ENV.trim() : '';
// Item 11: An unset NODE_ENV must be treated as production
export const envMode = rawEnv === 'development' ? 'development' : 'production';

export const config = {
  env: envMode,
  port: parseInt(process.env.PORT || '4000', 10),
  webPort: parseInt(process.env.WEB_PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:4000',
  trustProxy: process.env.TRUST_PROXY === 'true',
  webhookSecret: process.env.WEBHOOK_SECRET || '',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || 'job_agent_dev',
    user: process.env.DB_USER || 'job_agent_user',
    password: process.env.DB_PASSWORD || '', // Strictly no fallback for DB secret (Item 2)
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  email: {
    mode: (process.env.EMAIL_MODE || 'console').toLowerCase(), // 'console' | 'smtp'
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '', // Strictly no fallback for SMTP secret (Item 2)
    emailFrom: process.env.EMAIL_FROM || 'Job Application Assistant <no-reply@localhost>',
    emailReplyTo: process.env.EMAIL_REPLY_TO || 'support@localhost',
  },
  session: {
    idleTimeoutMinutes: parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '30', 10),
    maxLifetimeHours: parseInt(process.env.SESSION_MAX_LIFETIME_HOURS || '24', 10),
  }
};

export function validateConfig(): void {
  const errors: string[] = [];

  // Item 2: Database password secret validation (refuse to start if missing or empty)
  if (!config.db.password) {
    errors.push('DB_PASSWORD environment variable is missing or empty.');
  }

  // Item 2: SMTP credentials validation when EMAIL_MODE=smtp
  if (config.email.mode === 'smtp') {
    if (!config.email.smtpHost) {
      errors.push('SMTP_HOST is required when EMAIL_MODE=smtp.');
    }
  }

  // Item 2: Production environment security gating
  if (config.env === 'production') {
    if (config.email.mode === 'console') {
      errors.push('EMAIL_MODE cannot be "console" in production. Must use real SMTP provider.');
    }

    if (!config.email.smtpUser || !config.email.smtpPassword) {
      errors.push('SMTP_USER and SMTP_PASSWORD are required in production mode.');
    }

    if (!config.appUrl.startsWith('https://')) {
      errors.push(`APP_URL must use HTTPS protocol in production (got: '${config.appUrl}').`);
    }

    if (config.appUrl.includes('localhost') || config.appUrl.includes('127.0.0.1')) {
      errors.push(`APP_URL cannot point to localhost or 127.0.0.1 in production.`);
    }

    if (config.email.emailFrom.includes('localhost') || config.email.emailFrom.includes('127.0.0.1')) {
      errors.push(`EMAIL_FROM address cannot use localhost domain in production.`);
    }
  }

  if (errors.length > 0) {
    console.error('\n❌ FATAL CONFIGURATION VALIDATION ERROR!');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error('API server refusing to start due to configuration errors.\n');
    process.exit(1);
  }
}
