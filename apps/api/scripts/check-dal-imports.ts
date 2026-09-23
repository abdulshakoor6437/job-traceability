import fs from 'fs';
import path from 'path';

const srcDir = path.resolve(__dirname, '../src');
const dalDir = path.resolve(srcDir, 'dal');

let violations: string[] = [];

function checkDirectory(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (path.resolve(fullPath) === dalDir) {
        continue;
      }
      checkDirectory(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (
        content.includes("from 'mysql2'") ||
        content.includes('from "mysql2"') ||
        content.includes("require('mysql2')") ||
        content.includes('require("mysql2")') ||
        content.includes("from './db'") ||
        content.includes("from '../db'") ||
        content.includes("from './dal/db'") ||
        content.includes("from '../dal/db'") ||
        content.includes("getDbPool")
      ) {
        violations.push(fullPath);
      }
    }
  }
}

console.log('🔍 Running Strict Data Access Layer Architecture Check...');
checkDirectory(srcDir);

if (violations.length > 0) {
  console.error('\n❌ DAL ARCHITECTURE VIOLATION DETECTED!');
  console.error('The following files outside src/dal are illegally accessing database driver/connection:\n');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  console.error('\nAll database access MUST be routed strictly through authDal or userScopedDal. Please refactor.\n');
  process.exit(1);
} else {
  console.log('✅ DAL Check Passed: MySQL pool and db driver are completely unreachable outside src/dal.\n');
  process.exit(0);
}
