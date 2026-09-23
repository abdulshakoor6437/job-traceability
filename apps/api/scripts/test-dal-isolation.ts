import { createUserScopedDal } from '../src/dal/userScopedDal';
import { authDal } from '../src/dal/authDal';
import { getDbPool } from '../src/dal/db';

async function runDalIsolationTest() {
  console.log('\n================================================================');
  console.log('🧪 RUNNING DATA LAYER ISOLATION & ID INJECTION UNIT TESTS');
  console.log('================================================================\n');

  const pool = getDbPool();
  const timestamp = Date.now();
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  const emailA = `dal_user_a_${timestamp}@example.com`;
  const emailB = `dal_user_b_${timestamp}@example.com`;

  // Create User A and User B directly in DB
  await authDal.createUser(idA, emailA, '$2a$10$hashedpasswordstringforuserA');
  await authDal.createUser(idB, emailB, '$2a$10$hashedpasswordstringforuserB');

  const dalA = createUserScopedDal(idA);
  const dalB = createUserScopedDal(idB);

  // Set User B settings to 'Asia/Tokyo'
  await dalB.updateSettings('Asia/Tokyo');
  const settingsB_initial = await dalB.getSettings();
  console.log(`   User B Initial Settings: ID=${settingsB_initial?.id}, Timezone=${settingsB_initial?.timezone}`);

  console.log('\n1️⃣ Testing userScopedDal Methods Isolation:');

  // Test getProfile
  const profileA = await dalA.getProfile();
  console.log(`   dalA.getProfile() Returned Email: ${profileA?.email}`);
  if (profileA?.id !== idA) {
    throw new Error('DAL ISOLATION FAILURE: dalA.getProfile() returned non-owner user!');
  }

  // Test getSettings
  await dalA.updateSettings('America/Los_Angeles');
  const settingsA = await dalA.getSettings();
  console.log(`   dalA.getSettings() Returned Timezone: ${settingsA?.timezone}`);
  if (settingsA?.user_id !== idA) {
    throw new Error('DAL ISOLATION FAILURE: dalA.getSettings() returned User B settings!');
  }

  // Test dalA updateSettings does NOT alter User B settings
  await dalA.updateSettings('America/Chicago');
  const settingsB_after = await dalB.getSettings();
  console.log(`   dalB.getSettings() After dalA update: Timezone=${settingsB_after?.timezone}`);

  if (settingsB_after?.timezone !== 'Asia/Tokyo') {
    throw new Error('DAL ISOLATION FAILURE: dalA mutated User B settings record!');
  }
  console.log('   ✅ DAL Unit Test PASSED: dalA cannot read or mutate User B data.');

  console.log('\n2️⃣ Testing Direct SQL Verification of User B Record Un-mutated:');
  const [dbRows] = await pool.query<any[]>(`SELECT * FROM user_settings WHERE user_id = ?`, [idB]);
  if (dbRows.length === 0 || dbRows[0].timezone !== 'Asia/Tokyo') {
    throw new Error('DB VERIFICATION FAILURE: User B record in MySQL was compromised!');
  }
  console.log('   ✅ Direct MySQL Table Check PASSED: User B row remains untouched in DB.');

  console.log('\n================================================================');
  console.log('🎉 DATA LAYER ISOLATION UNIT TESTS PASSED PERFECTLY!');
  console.log('================================================================\n');

  process.exit(0);
}

runDalIsolationTest().catch((err) => {
  console.error('\n❌ DAL ISOLATION TEST FAILED:', err);
  process.exit(1);
});
