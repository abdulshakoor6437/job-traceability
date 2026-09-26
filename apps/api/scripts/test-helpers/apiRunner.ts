import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';

export class ApiRunnerHelper {
  private child: ChildProcess | null = null;

  async startServer(port: number, envVars: Record<string, string>): Promise<void> {
    await this.stopServer();

    try {
      const { getDbPool } = require('../../src/dal/db');
      const pool = getDbPool();
      await pool.execute('DELETE FROM rate_limits');
    } catch {
      // Ignore if table does not exist yet
    }

    const mergedEnv = {
      ...process.env,
      PORT: port.toString(),
      ...envVars,
    };

    const entryScript = path.resolve(__dirname, '../../src/index.ts');
    const tsxCli = path.resolve(__dirname, '../../../../node_modules/tsx/dist/cli.mjs');

    this.child = spawn(process.execPath, [tsxCli, entryScript], {
      cwd: path.resolve(__dirname, '../..'),
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.child.stdout?.on('data', (d) => {
      console.log('[API RUNNER OUTPUT]', d.toString());
    });
    this.child.stderr?.on('data', (d) => {
      console.error('[API RUNNER STDERR]', d.toString());
    });

    // Poll /api/health until server is up (up to 15 seconds)
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      try {
        const isUp = await this.pingHealth(port);
        if (isUp) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`ApiRunner: Failed to start API server on port ${port} within timeout.`);
  }

  private pingHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  }

  stopServer(): Promise<void> {
    return new Promise((resolve) => {
      if (this.child && this.child.pid) {
        try {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            execSync(`taskkill /F /T /PID ${this.child.pid}`, { stdio: 'ignore' });
          } else {
            this.child.kill('SIGKILL');
          }
        } catch {
          // Already exited
        }
        this.child = null;
        setTimeout(resolve, 500);
      } else {
        resolve();
      }
    });
  }
}

export const apiRunner = new ApiRunnerHelper();
