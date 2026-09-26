import assert from 'assert';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { getDbPool } from '../src/dal/db';
import { RowDataPacket } from 'mysql2/promise';

interface ColumnInfo extends RowDataPacket {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
}

async function runSchemaAudit() {
  console.log('\n================================================================');
  console.log('🧪 SCOPE ITEM 7 & ACCEPTANCE TEST (f): Job Cache Schema Privacy Audit');
  console.log('================================================================\n');

  const pool = getDbPool();
  const tablesToAudit = [
    'job_search_cache',
    'cached_jobs',
    'job_search_cache_entries',
    'provider_api_logs',
  ];

  console.log('▶ Inspecting database schema columns from INFORMATION_SCHEMA.COLUMNS...\n');

  for (const table of tablesToAudit) {
    const [columns] = await pool.query<ColumnInfo[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION ASC`,
      [table]
    );

    assert.ok(columns.length > 0, `Table '${table}' must exist in database`);

    const colNames = columns.map((c) => c.COLUMN_NAME);
    console.log(`📋 Table: [${table}] (${columns.length} columns)`);
    for (const c of columns) {
      console.log(`   - ${c.COLUMN_NAME.padEnd(20)} ${c.COLUMN_TYPE.padEnd(25)} Nullable: ${c.IS_NULLABLE}`);
    }

    // Strict assertions: NO user_id and NO user-identifying columns
    assert.strictEqual(
      colNames.includes('user_id'),
      false,
      `VIOLATION: Table '${table}' must NOT have a 'user_id' column!`
    );

    const forbiddenSubstrings = ['user_id', 'userid', 'account_id', 'email', 'phone', 'ssn', 'ip_address'];
    for (const col of colNames) {
      for (const forbidden of forbiddenSubstrings) {
        assert.ok(
          !col.toLowerCase().includes(forbidden),
          `VIOLATION: Table '${table}' contains forbidden identifying column '${col}'!`
        );
      }
    }

    console.log(`  ✅ Verified: Table '${table}' has ZERO user_id or personal identifying columns.\n`);
  }

  console.log('================================================================');
  console.log('🎉 SCOPE ITEM 7 & TEST (f) PASSED: Job cache is strictly shared/global data');
  console.log('================================================================\n');
  process.exit(0);
}

runSchemaAudit().catch((err) => {
  console.error('❌ Schema Audit Failed:', err);
  process.exit(1);
});
