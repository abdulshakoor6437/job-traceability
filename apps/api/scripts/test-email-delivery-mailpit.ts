import net from 'net';
import http from 'http';
import { config } from '../src/config/env';
import { authDal } from '../src/dal/authDal';
import { processOutboxBatch } from '../src/services/emailOutboxWorker';
import { getDbPool } from '../src/dal/db';
import crypto from 'crypto';
import { apiRunner } from './test-helpers/apiRunner';

const API_HOST = '127.0.0.1';
const API_PORT = config.port;
const SMTP_PORT = 1025;

class SimpleTestSmtpServer {
  private server: net.Server | null = null;
  public receivedEmails: { from: string; to: string; data: string }[] = [];

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        let state = 'CONNECTED';
        let emailData = '';

        socket.write('220 127.0.0.1 ESMTP TestMailServer\r\n');

        socket.on('data', (buffer) => {
          const lines = buffer.toString('utf-8').split('\r\n');

          for (const line of lines) {
            if (!line.trim() && state !== 'DATA') continue;

            if (state === 'DATA') {
              if (line === '.') {
                state = 'READY';
                this.receivedEmails.push({ from: 'test', to: 'test', data: emailData });
                emailData = '';
                socket.write('250 2.0.0 Ok: queued as TEST12345\r\n');
              } else {
                emailData += line + '\n';
              }
              continue;
            }

            const cmd = line.toUpperCase();
            if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) {
              socket.write('250-127.0.0.1 Hello\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
            } else if (cmd.startsWith('AUTH')) {
              socket.write('235 2.7.0 Authentication successful\r\n');
            } else if (cmd.startsWith('MAIL FROM')) {
              socket.write('250 2.1.0 Ok\r\n');
            } else if (cmd.startsWith('RCPT TO')) {
              socket.write('250 2.1.5 Ok\r\n');
            } else if (cmd.startsWith('DATA')) {
              state = 'DATA';
              socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
            } else if (cmd.startsWith('QUIT')) {
              socket.write('221 2.0.0 Bye\r\n');
              socket.end();
            }
          }
        });
      });

      this.server.listen(SMTP_PORT, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

function makeRequest(
  method: string,
  path: string,
  data?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : undefined;
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Origin': config.appUrl,
    };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        host: API_HOST,
        port: API_PORT,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let bodyStr = '';
        res.on('data', (chunk) => (bodyStr += chunk));
        res.on('end', () => {
          try {
            const body = bodyStr ? JSON.parse(bodyStr) : {};
            resolve({ status: res.statusCode || 500, body });
          } catch {
            resolve({ status: res.statusCode || 500, body: bodyStr });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function runEmailDeliveryTest() {
  console.log('\n================================================================');
  console.log('📧 RUNNING REAL SMTP EMAIL DELIVERY & RECOVERY TEST');
  console.log('================================================================\n');

  const SMTP_PORT = 1025;
  const API_PORT = config.port;

  await apiRunner.startServer(API_PORT, {
    EMAIL_MODE: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: SMTP_PORT.toString(),
    SMTP_SECURE: 'false',
  });

  (config.email as any).mode = 'smtp';
  (config.email as any).smtpHost = '127.0.0.1';
  (config.email as any).smtpPort = SMTP_PORT;
  (config.email as any).smtpSecure = false;

  const pool = getDbPool();
  const smtpServer = new SimpleTestSmtpServer();

  try {
    try {
      await pool.execute('DELETE FROM rate_limits');
    } catch {}

    const timestamp = Date.now();

    console.log('1️⃣ Starting Local SMTP Test Server (Port 1025)...');
    await smtpServer.start();

  console.log('\n(a) Testing Signup -> Outbox -> SMTP Delivery -> Token Extraction -> Email Verification:');
  const emailA = `smtp_user_a_${timestamp}@example.com`;
  const signupA = await makeRequest('POST', '/api/auth/signup', { email: emailA, password: 'Password123!' });
  console.log(`   Signup A Status: ${signupA.status} (Expected 201)`);
  console.log(`   Signup A Body: ${JSON.stringify(signupA.body)}`);

  console.log('   Processing outbox batch via SMTP worker...');
  await processOutboxBatch();

  const [outboxA] = await pool.query<any[]>(`SELECT * FROM email_outbox WHERE recipient = ?`, [emailA]);
  console.log(`   Outbox Row A Status: ${outboxA[0]?.status} (Expected 'sent')`);
  console.log(`   SMTP Received Emails Count: ${smtpServer.receivedEmails.length}`);

  const rawMail = smtpServer.receivedEmails[0]?.data || '';
  const cleanMail = rawMail.replace(/=3D/gi, '=').replace(/=\r?\n/g, '').replace(/\r?\n/g, ' ');
  const tokenMatch = /token=([a-f0-9]{64})/i.exec(cleanMail);
  const token = tokenMatch ? tokenMatch[1] : '';
  console.log(`   Extracted Verification Token: ${token ? token.substring(0, 12) + '...' : 'MISSING'}`);

  console.log('   Verifying email using extracted token...');
  const verifyRes = await makeRequest('POST', '/api/auth/verify-email', { token });
  console.log(`   Verification Response: [${verifyRes.status}] "${verifyRes.body.message}"`);

  if (signupA.status !== 201 || outboxA[0]?.status !== 'sent' || verifyRes.status !== 200) {
    throw new Error('EMAIL DELIVERY TEST FAILED: Step (a) verification failed!');
  }
  console.log('   ✅ Step (a) PASSED: Email sent via SMTP and verified successfully.');

  console.log('\n(b) Testing SMTP Outage -> Signup Non-blocking -> Row Pending Retry:');
  console.log('   Stopping Local SMTP Test Server...');
  await smtpServer.stop();

  const emailB = `smtp_user_b_${timestamp}@example.com`;
  const signupB = await makeRequest('POST', '/api/auth/signup', { email: emailB, password: 'Password123!' });
  console.log(`   Signup B Status during outage: ${signupB.status} (Expected 201)`);
  console.log(`   Signup B Body: ${JSON.stringify(signupB.body)}`);

  console.log('   Processing outbox batch during SMTP outage...');
  await processOutboxBatch();

  const [outboxB] = await pool.query<any[]>(`SELECT * FROM email_outbox WHERE recipient = ?`, [emailB]);
  console.log(`   Outbox Row B Status during outage: ${outboxB[0]?.status} (Expected 'pending')`);
  console.log(`   Outbox Row B Attempts: ${outboxB[0]?.attempts} (Expected 1)`);
  console.log(`   Outbox Row B Last Error: "${outboxB[0]?.last_error}"`);

  if (signupB.status !== 201 || outboxB[0]?.status !== 'pending' || outboxB[0]?.attempts !== 1) {
    throw new Error('EMAIL DELIVERY TEST FAILED: Step (b) outage resilience failed!');
  }
  console.log('   ✅ Step (b) PASSED: Signup returned normally, outbox row kept pending for retry.');

  console.log('\n(c) Testing SMTP Recovery -> Outbox Delivery Success:');
  console.log('   Restarting Local SMTP Test Server...');
  await smtpServer.start();

  // Reset next_attempt_at so worker processes it immediately
  await pool.execute(`UPDATE email_outbox SET next_attempt_at = NOW() WHERE id = ?`, [outboxB[0].id]);

  console.log('   Processing outbox batch after SMTP recovery...');
  await processOutboxBatch();

  const [outboxBAfter] = await pool.query<any[]>(`SELECT * FROM email_outbox WHERE recipient = ?`, [emailB]);
  console.log(`   Outbox Row B Status after recovery: ${outboxBAfter[0]?.status} (Expected 'sent')`);
  console.log(`   Outbox Row B Sent At: ${outboxBAfter[0]?.sent_at}`);

  await smtpServer.stop();

  if (outboxBAfter[0]?.status !== 'sent') {
    throw new Error('EMAIL DELIVERY TEST FAILED: Step (c) recovery delivery failed!');
  }
  console.log('   ✅ Step (c) PASSED: Email delivered successfully after SMTP recovery.');

    console.log('\n================================================================');
    console.log('🎉 REAL SMTP EMAIL DELIVERY & RECOVERY TEST PASSED 100%');
    console.log('================================================================\n');
  } finally {
    try { await smtpServer.stop(); } catch {}
    await apiRunner.stopServer(API_PORT);
    try { const pool = getDbPool(); await pool.end(); } catch {}
  }
  process.exit(0);
}

runEmailDeliveryTest().catch(async (err) => {
  console.error('\n❌ EMAIL DELIVERY TEST FAILED:', err);
  process.exit(1);
});
