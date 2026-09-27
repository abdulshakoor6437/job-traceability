import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDbPool } from '../src/dal/db';
import { RowDataPacket } from 'mysql2/promise';

interface MigrationRow extends RowDataPacket {
  migration_name: string;
  checksum: string | null;
}

function calculateChecksum(content: string): string {
  return crypto.createHash('sha256').update(content.trim()).digest('hex');
}

async function runMigrations() {
  console.log('🔄 Running database migrations with checksum validation...');
  const pool = getDbPool();
  const migrationsDir = path.resolve(__dirname, '../migrations');

  // Ensure schema_migrations table exists with checksum column
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      checksum VARCHAR(64) NULL,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Ensure checksum column exists if table was created previously without it
  try {
    await pool.execute(`ALTER TABLE schema_migrations ADD COLUMN checksum VARCHAR(64) NULL`);
  } catch {
    // Column already exists
  }

  const [executedRows] = await pool.query<MigrationRow[]>(
    `SELECT migration_name, checksum FROM schema_migrations`
  );
  const executedMap = new Map<string, string | null>();
  for (const r of executedRows) {
    executedMap.set(r.migration_name, r.checksum);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const currentChecksum = calculateChecksum(sql);

    if (executedMap.has(file)) {
      const recordedChecksum = executedMap.get(file);

      if (recordedChecksum && recordedChecksum !== currentChecksum) {
        console.error(`\n❌ FATAL MIGRATION ERROR: Checksum mismatch for applied migration '${file}'!`);
        console.error(`   Recorded: ${recordedChecksum}`);
        console.error(`   Current:  ${currentChecksum}`);
        console.error(`   Editing applied migration files is forbidden. Create a new numbered migration instead.\n`);
        process.exit(1);
      }

      // Populate checksum for legacy records
      if (!recordedChecksum) {
        await pool.execute(`UPDATE schema_migrations SET checksum = ? WHERE migration_name = ?`, [
          currentChecksum,
          file,
        ]);
      }

      console.log(`  - ${file}: Already applied (Checksum OK)`);
      continue;
    }

    console.log(`  -> Applying migration: ${file} (Checksum: ${currentChecksum.substring(0, 12)}...)`);

    // Split SQL by semicolon for multi-statement execution
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      // Use query() not execute() — DDL (CREATE TABLE, ALTER TABLE) is not supported
      // by the prepared-statement protocol that execute() uses in some MySQL versions.
      await pool.query(statement);
    }

    await pool.execute(
      `INSERT INTO schema_migrations (migration_name, checksum) VALUES (?, ?)`,
      [file, currentChecksum]
    );
    console.log(`  ✅ Migration ${file} applied successfully.`);
  }

  console.log('🎉 Database migrations completed successfully.\n');
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
}
