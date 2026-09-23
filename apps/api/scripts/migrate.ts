import fs from 'fs';
import path from 'path';
import { getDbPool } from '../src/dal/db';
import { RowDataPacket } from 'mysql2/promise';

interface MigrationRow extends RowDataPacket {
  migration_name: string;
}

async function runMigrations() {
  console.log('🔄 Running database migrations...');
  const pool = getDbPool();
  const migrationsDir = path.resolve(__dirname, '../migrations');

  // Ensure schema_migrations table exists
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [executedRows] = await pool.query<MigrationRow[]>(
    `SELECT migration_name FROM schema_migrations`
  );
  const executedSet = new Set(executedRows.map((r) => r.migration_name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (executedSet.has(file)) {
      console.log(`  - ${file}: Already applied`);
      continue;
    }

    console.log(`  -> Applying migration: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    // Split SQL by semicolon for multi-statement execution
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await pool.execute(statement);
    }

    await pool.execute(
      `INSERT INTO schema_migrations (migration_name) VALUES (?)`,
      [file]
    );
    console.log(`  ✅ Migration ${file} applied successfully.`);
  }

  console.log('🎉 Database migrations completed successfully.\n');
  process.exit(0);
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
