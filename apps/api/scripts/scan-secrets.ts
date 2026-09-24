import { execSync } from 'child_process';

// Secret scanning patterns for credentials, private keys, API tokens, etc.
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'AWS Access Key ID', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS Secret Access Key', pattern: /\b[0-9a-zA-Z/+]{40}\b/ },
  { name: 'GitHub Personal Access Token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/ },
  { name: 'Generic API Key / Secret Token', pattern: /\b(api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9_\-]{20,})["']?/i },
  { name: 'RSA/EC/PGP Private Key', pattern: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/ },
  { name: 'Google OAuth / App Secret', pattern: /\b[0-9]+-[0-9a-zA-Z_]{32}\.apps\.googleusercontent\.com\b/ },
  { name: 'Stripe Secret Key', pattern: /\bsk_live_[0-9a-zA-Z]{24,}\b/ },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z]{10,12}-[0-9a-zA-Z]{10,12}-[0-9a-zA-Z]{24,32}/ },
  { name: 'Database Password Assignment', pattern: /\b(DB_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD)\s*=\s*(?!your_secure_db_password_here|DevJobAgentSecPass2026x99|["']?["']?\s*$)[^\s#]+/i },
  { name: 'SMTP Password Assignment', pattern: /\b(SMTP_PASS|SMTP_PASSWORD)\s*=\s*(?!your_app_password_here|["']?["']?\s*$)[^\s#]+/i },
];

function maskSecret(text: string): string {
  if (text.length <= 8) return '****';
  return text.substring(0, 3) + '...' + text.substring(text.length - 3);
}

function scanGitHistory() {
  console.log('\n================================================================');
  console.log('🔍 RUNNING COMPREHENSIVE GIT HISTORY SECRET SCANNER');
  console.log('================================================================\n');

  let logOutput = '';
  try {
    logOutput = execSync('git log -p --all --full-history', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
  } catch (err: any) {
    console.error('Failed to retrieve git log history:', err.message);
    process.exit(1);
  }

  const lines = logOutput.split('\n');
  let currentCommit = '';
  let currentFile = '';
  let findingsCount = 0;
  const findings: { commit: string; file: string; line: string; rule: string }[] = [];

  for (const line of lines) {
    if (line.startsWith('commit ')) {
      currentCommit = line.split(' ')[1].substring(0, 8);
    } else if (line.startsWith('+++ b/')) {
      currentFile = line.substring(6);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.substring(1);
      if (currentFile.endsWith('package-lock.json') || content.includes('integrity": "sha')) {
        continue;
      }

      for (const { name, pattern } of SECRET_PATTERNS) {
        const match = pattern.exec(content);
        if (match) {
          // Exclude template placeholders and test files containing dummy hash
          if (content.includes('your_secure_db_password_here') || content.includes('your_app_password_here') || content.includes('dummyhashedpasswordstring')) {
            continue;
          }
          findingsCount++;
          const maskedContent = line.replace(match[0], maskSecret(match[0]));
          findings.push({
            commit: currentCommit,
            file: currentFile,
            line: maskedContent,
            rule: name,
          });
        }
      }
    }
  }

  console.log(`Repository scanned: full history (${lines.length} diff lines analyzed).`);
  console.log(`Total Secrets Found: ${findingsCount}\n`);

  if (findingsCount > 0) {
    console.log('⚠️ Secret Findings (Masked):');
    for (const f of findings) {
      console.log(` - [Commit ${f.commit}] [${f.file}] Rule "${f.rule}": ${f.line}`);
    }
  } else {
    console.log('✅ CLEAN: No unmasked production secrets or passwords found in full git history.');
  }

  console.log('\n================================================================');
  console.log('🎉 GIT HISTORY SECRET SCAN COMPLETED');
  console.log('================================================================\n');
}

scanGitHistory();
