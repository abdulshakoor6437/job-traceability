import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
process.env.DB_HOST = '127.0.0.1';
process.env.NODE_ENV = 'development';

import fs from 'fs';
import { apiRunner } from './test-helpers/apiRunner';
import { authDal } from '../src/dal/authDal';

const PORT = 3991;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'http://localhost:3000',
};

async function testItem1() {
  const outputDir = path.resolve(__dirname, '../test-output/module5_agent_control');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const logFile = path.join(outputDir, 'item1_search_preferences.txt');
  const logs: string[] = [];
  const print = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  print('================================================================');
  print('🧪 SCOPE ITEM 1 VERIFICATION: User Search Preferences Endpoint');
  print('================================================================');
  print('Flagged Addition: User search-preferences table (user_search_preferences) and endpoints added as a required addition.\n');

  try {
    await apiRunner.startServer(PORT);

    const email = `pref_user_${Date.now()}@example.com`;
    const password = 'StrongPassword123!';

    print(`1. Registering user ${email}...`);
    const regRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const regJson = await regRes.json();
    print(`   Signup Status: ${regRes.status}`);

    const user = await authDal.findUserByEmail(email);
    if (!user) {
      throw new Error(`Failed to find user by email ${email}`);
    }
    await authDal.setUserVerified(user.id);

    print(`2. Logging in...`);
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const cookieHeader = loginRes.headers.get('set-cookie') || '';
    print(`   Login Status: ${loginRes.status}`);

    print(`3. Fetching search preferences before setting (expect 404)...`);
    const getBeforeRes = await fetch(`${BASE_URL}/api/user/search-preferences`, {
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    print(`   GET Status: ${getBeforeRes.status}`);

    print(`4. Updating search preferences via PUT /api/user/search-preferences...`);
    const putRes = await fetch(`${BASE_URL}/api/user/search-preferences`, {
      method: 'PUT',
      headers: {
        ...HEADERS,
        Cookie: cookieHeader,
      },
      body: JSON.stringify({
        role: 'Senior Backend Engineer',
        location: 'Remote',
        filters: { remoteOnly: true, minSalary: 120000 },
      }),
    });
    const putData = await putRes.json();
    print(`   PUT Status: ${putRes.status}`);
    print(`   Saved Role: ${putData.preferences?.role}`);
    print(`   Saved Location: ${putData.preferences?.location}`);

    print(`5. Verifying stored preferences via GET /api/user/search-preferences...`);
    const getAfterRes = await fetch(`${BASE_URL}/api/user/search-preferences`, {
      headers: { ...HEADERS, Cookie: cookieHeader },
    });
    const getAfterData = await getAfterRes.json();
    print(`   GET Status: ${getAfterRes.status}`);
    print(`   Retrieved Role: ${getAfterData.preferences?.role}`);

    if (putRes.status === 200 && getAfterData.preferences?.role === 'Senior Backend Engineer') {
      print('\n✅ ITEM 1 VERIFICATION PASSED PERFECTLY!\n');
    } else {
      throw new Error('Assertion failed: status or retrieved role mismatch');
    }

    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    print(`Saved log output to ${logFile}`);
  } catch (err: any) {
    print(`❌ ITEM 1 VERIFICATION FAILED: ${err.message}`);
    fs.writeFileSync(logFile, logs.join('\n'), 'utf-8');
    process.exit(1);
  } finally {
    await apiRunner.stopServer(PORT);
    process.exit(0);
  }
}

testItem1();
