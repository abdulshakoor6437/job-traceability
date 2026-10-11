import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import fs from 'fs';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';

const PORT = 4124;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem5() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'item5_limits.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 5 VERIFICATION: Unified Usage & Limits Panel');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    const email = `limits_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    print('1. Creating and logging in test user...');
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });

    const user = await authDal.findUserByEmail(email);
    await authDal.setUserVerified(user!.id);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookie = loginRes.headers.get('set-cookie') || '';

    print('\n2. Fetching GET /api/user/limits...');
    const limitsRes = await fetch(`${BASE_URL}/api/user/limits`, {
      headers: { ...HEADERS, Cookie: cookie },
    });
    const limitsBody = await limitsRes.json();

    print(`   HTTP Status: ${limitsRes.status}`);
    print(`   JSearch Quota: Used ${limitsBody.jsearch?.usedThisMonth} / ${limitsBody.jsearch?.monthlyLimit} (Remaining: ${limitsBody.jsearch?.remaining})`);
    print(`   SerpApi Quota: Used ${limitsBody.serpapi?.usedThisMonth} / ${limitsBody.serpapi?.monthlyLimit} (Remaining: ${limitsBody.serpapi?.remaining})`);
    print(`   Tailoring Daily Cap: Used ${limitsBody.tailoring?.usedToday} / ${limitsBody.tailoring?.dailyLimit} (Remaining: ${limitsBody.tailoring?.remaining})`);
    print(`   Background Job Status: ${limitsBody.backgroundJob?.status} (Interval: ${limitsBody.backgroundJob?.intervalHours}h, Throttled: ${limitsBody.backgroundJob?.isThrottled})`);

    if (
      limitsRes.status !== 200 ||
      limitsBody.jsearch?.monthlyLimit === undefined ||
      limitsBody.serpapi?.monthlyLimit === undefined ||
      limitsBody.tailoring?.dailyLimit === undefined ||
      !limitsBody.backgroundJob?.status
    ) {
      throw new Error('Test (g) FAILED: Limits endpoint output incomplete or malformed!');
    }

    print('\n================================================================');
    print('✅ ITEM 5 VERIFICATION PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf8');
    print(`Saved log evidence to ${logFile}`);
    process.exit(0);
  } catch (err: any) {
    print(`\n❌ ITEM 5 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf8');
    process.exit(1);
  }
}

testItem5();
