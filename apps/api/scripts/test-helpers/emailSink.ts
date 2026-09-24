import net from 'net';

export interface CapturedEmail {
  from: string;
  to: string;
  data: string;
}

export class EmailSinkHelper {
  private server: net.Server | null = null;
  public receivedEmails: CapturedEmail[] = [];

  start(port: number = 1025): Promise<void> {
    return new Promise((resolve, reject) => {
      this.receivedEmails = [];
      this.server = net.createServer((socket) => {
        let state = 'CONNECTED';
        let emailData = '';

        socket.write('220 127.0.0.1 ESMTP EmailSink\r\n');

        socket.on('data', (buffer) => {
          const lines = buffer.toString('utf-8').split('\r\n');

          for (const line of lines) {
            if (!line.trim() && state !== 'DATA') continue;

            if (state === 'DATA') {
              if (line === '.') {
                state = 'READY';
                this.receivedEmails.push({ from: 'sink', to: 'sink', data: emailData });
                emailData = '';
                socket.write('250 2.0.0 Ok: queued\r\n');
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
              socket.write('354 End data\r\n');
            } else if (cmd.startsWith('QUIT')) {
              socket.write('221 2.0.0 Bye\r\n');
              socket.end();
            }
          }
        });
      });

      this.server.on('error', (err) => reject(err));
      this.server.listen(port, '127.0.0.1', () => {
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

  clear() {
    this.receivedEmails = [];
  }

  extractTokenForRecipient(recipient: string): string {
    const target = this.receivedEmails.find((e) => e.data.toLowerCase().includes(recipient.toLowerCase()));
    if (!target) return '';
    const cleanMail = target.data.replace(/=3D/gi, '=').replace(/=\r?\n/g, '').replace(/\r?\n/g, ' ');
    const tokenMatch = /token=([a-f0-9]{64})/i.exec(cleanMail);
    return tokenMatch ? tokenMatch[1] : '';
  }
}

export const emailSink = new EmailSinkHelper();
