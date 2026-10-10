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

const PORT = 4120;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem1() {
  const outputDir = path.resolve(__dirname, '../test-output/module8');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const logFile = path.join(outputDir, 'item1_notifications.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 1 VERIFICATION: User Notifications Table & Endpoints');
  print('================================================================\n');

  try {
    await apiRunner.startServer(PORT, { USE_MOCK_EMBEDDINGS: 'true' });

    // Create User A & User B
    const emailA = `notif_user_a_${Date.now()}@example.com`;
    const emailB = `notif_user_b_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });

    const userA = await authDal.findUserByEmail(emailA);
    const userB = await authDal.findUserByEmail(emailB);
    await authDal.setUserVerified(userA!.id);
    await authDal.setUserVerified(userB!.id);

    const dalA = createUserScopedDal(userA!.id);
    const dalB = createUserScopedDal(userB!.id);

    print('1. Creating notifications for User A directly via DAL...');
    const notif1 = await dalA.createNotification(
      'high_match',
      'High job match found: Senior Staff DevOps Engineer at CloudCorp (92% match)',
      'job-101',
      null
    );
    const notif2 = await dalA.createNotification(
      'high_match',
      'High job match found: Lead Infrastructure Architect at TechScale (88% match)',
      'job-102',
      null
    );

    print(`   Created Notif 1 ID: ${notif1.id}, type: ${notif1.type}, is_read: ${notif1.is_read}`);
    print(`   Created Notif 2 ID: ${notif2.id}, type: ${notif2.type}, is_read: ${notif2.is_read}`);

    print('\n2. Testing GET /api/notifications for User A via HTTP API...');
    const loginResA = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailA, password }),
    });
    const cookieA = loginResA.headers.get('set-cookie') || '';

    const getResA = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const getBodyA = await getResA.json();

    print(`   HTTP Status: ${getResA.status}`);
    print(`   Unread Count: ${getBodyA.unreadCount}`);
    print(`   Notifications Returned: ${getBodyA.notifications?.length}`);

    if (getResA.status !== 200 || getBodyA.unreadCount !== 2 || getBodyA.notifications.length !== 2) {
      throw new Error('GET /api/notifications failed or returned incorrect unread count!');
    }

    print('\n3. Testing PUT /api/notifications/:id/read for User A...');
    const markReadRes = await fetch(`${BASE_URL}/api/notifications/${notif1.id}/read`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieA },
    });
    print(`   Mark Read HTTP Status: ${markReadRes.status}`);

    const getResA2 = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieA },
    });
    const getBodyA2 = await getResA2.json();
    print(`   Updated Unread Count: ${getBodyA2.unreadCount} (Expected: 1)`);

    if (getBodyA2.unreadCount !== 1) {
      throw new Error('Mark notification read failed to update unread count!');
    }

    print('\n4. Testing Cross-User Isolation (User B cannot access or mutate User A notification)...');
    const loginResB = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: emailB, password }),
    });
    const cookieB = loginResB.headers.get('set-cookie') || '';

    const getResB = await fetch(`${BASE_URL}/api/notifications`, {
      headers: { ...HEADERS, Cookie: cookieB },
    });
    const getBodyB = await getResB.json();
    print(`   User B Unread Count: ${getBodyB.unreadCount} (Expected: 0)`);
    print(`   User B Notifications Count: ${getBodyB.notifications?.length} (Expected: 0)`);

    const mutateBRes = await fetch(`${BASE_URL}/api/notifications/${notif2.id}/read`, {
      method: 'PUT',
      headers: { ...HEADERS, Cookie: cookieB },
    });
    print(`   User B Cross-Mutate Attempt Status: ${mutateBRes.status} (Expected: 404)`);

    if (getBodyB.notifications?.length !== 0 || mutateBRes.status !== 404) {
      throw new Error('Cross-user DAL isolation failed on notifications endpoint!');
    }

    print('\n================================================================');
    print('✅ ITEM 1 VERIFICATION PASSED PERFECTLY!');
    print('================================================================\n');

    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log evidence to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 1 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
  }
}

if (require.main === module) {
  testItem1().then(() => process.exit(0));
}
