import mysql from 'mysql2/promise';

async function recreateDatabase() {
  console.log('🔄 Recreating job_agent_dev database from zero...');
  const conn = await mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '',
  });

  await conn.query('DROP DATABASE IF EXISTS job_agent_dev');
  await conn.query('CREATE DATABASE job_agent_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  const dbPassword = process.env.DB_PASSWORD || '';
  if (!dbPassword) {
    console.log('Note: DB_PASSWORD not set in env, skipping GRANT statement.');
  } else {
    try {
      await conn.query(`GRANT ALL PRIVILEGES ON job_agent_dev.* TO 'job_agent_user'@'localhost' IDENTIFIED BY ?`, [dbPassword]);
      await conn.query('FLUSH PRIVILEGES');
    } catch (err: any) {
      console.log('Note on grant:', err.message);
    }
  }
  console.log('✅ Database job_agent_dev recreated successfully!');
  await conn.end();
}

recreateDatabase().catch((err) => {
  console.error('Failed to recreate database:', err);
  process.exit(1);
});
