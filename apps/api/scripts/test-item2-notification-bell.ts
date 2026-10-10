import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';
process.env.USE_MOCK_EMBEDDINGS = 'true';

import fs from 'fs';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';
import { createUserScopedDal } from '../src/dal/userScopedDal';

const PORT = 4121;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem2() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'item2_notification_bell.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 2 VERIFICATION: Dashboard Notification Bell & Polling UI API');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    const email = `bell_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });

    const user = await authDal.findUserByEmail(email);
    await authDal.setUserVerified(user!.id);
    const dal = createUserScopedDal(user!.id);

    // Seed 3 unread notifications
    await dal.createNotification('high_match', 'Job match #1 (90%)', 'job-001', null);
    await dal.createNotification('high_match', 'Job match #2 (87%)', 'job-002', null);
    await dal.createNotification('high_match', 'Job match #3 (95%)', 'job-003', null);

    print('1. Logging in user...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookie = loginRes.headers.get('set-cookie') || '';

    print('2. Component initial poll (fetch-on-load): GET /api/notifications...');
    const poll1 = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookie },
    });
    const body1 = await poll1.json();
    print(`   Unread Count Badge Value: ${body1.unreadCount} (Expected: 3)`);
    print(`   Total Items Rendered in List: ${body1.notifications?.length}`);

    if (body1.unreadCount !== 3) {
      throw new Error('Notification bell unread count badge computation failed!');
    }

    print('\n3. Simulating user clicking "Mark all read": PUT /api/notifications/read-all...');
    const markAllRes = await fetch(`${BASE_URL}/api/notifications/read-all`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookie },
    });
    const markAllBody = await markAllRes.json();
    print(`   Mark All Response: ${JSON.stringify(markAllBody)}`);

    print('\n4. Component periodic poll after marking all read: GET /api/notifications...');
    const poll2 = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookie },
    });
    const body2 = await poll2.json();
    print(`   Updated Unread Count Badge Value: ${body2.unreadCount} (Expected: 0)`);

    if (body2.unreadCount !== 0) {
      throw new Error('Unread count badge failed to clear to 0 after mark-all-read!');
    }

    print('\n================================================================');
    print('✅ ITEM 2 VERIFICATION PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log evidence to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 2 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
  }
}

if (require.main === module) {
  testItem2().then(() => process.exit(0));
}
