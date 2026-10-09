# PROJECT BRIEF: Multi-User Job-Hunting Assistant

We are building a multi-user job-hunting assistant. Each user uploads a CV once. While the user is logged in, the system finds matching jobs, tailors a CV and cover letter for each job, and puts them in a queue. The user opens a job, the application form is filled in seconds by a Chrome extension, and THE USER ALWAYS PRESSES SUBMIT THEMSELVES. When the user logs out or is inactive for about 30 minutes, all work for that user stops.

## TECH DECISIONS (fixed, do not change without asking)
- TypeScript everywhere: Next.js web app, Node API backend, Chrome extension (later).
- Database: MySQL 8+ / MariaDB 10.4 in development. Portable standard SQL only, no JSON functions or MariaDB-only features. Keep a header comment in each migration file listing assumptions. Database name: `job_agent_dev` with dedicated user `job_agent_user`. utf8mb4, versioned migrations kept in repo.
- Redis plus a background job queue (BullMQ). Redis is ONLY used for background jobs, NOT for auth. Worker fails loudly if Redis is unavailable (`[QUEUE WORKER ERROR] REDIS IS UNAVAILABLE!`).
- Job data comes only from the JSearch and SerpAPI APIs. No scraping.
- The system is multi-tenant from day one. Every table holding personal data has a user ID. The only exception is shared job cache tables, which must contain no personal data.
- MySQL cannot enforce row-level security, so ALL database access must go through one shared data-access layer.
  - (a) `authDal` for unauthenticated operations (signup, login, verification, password reset).
  - (b) `userScopedDal` requiring `userId` for every method.
  - ONLY the `dal` folder may import the database driver (`mysql2`) or db pool (`db.ts`). Enforced by automated check (`npm run check:dal`).
- MANDATORY TESTING RULE: Every new endpoint that accepts an ID, and every new user-owned table, must ship with a cross-user test in the same module.
- Sessions: Random opaque session tokens (NOT JWTs). Store SHA-256 hash of token in `user_sessions`. MySQL is single source of truth. Logout deletes/revokes session row immediately. Sliding 30-minute idle expiry, absolute 24-hour max lifetime. httpOnly, SameSite=Lax cookie (`secure` flag set whenever `NODE_ENV !== 'development'`).
- Idle Timeout & Reversed Activity Default: Requests MUST NOT extend `last_active_at` or idle timeout unless the route is on an explicit allowlist of activity routes (`POST /api/session/heartbeat`). `GET /api/auth/me` and `GET /api/user/active-signal` are NEVER on the list. Web app sends heartbeat only while tab is visible AND user interacted within the last 2 minutes.
- Auth Hardening & Security: Rate limiting on login, signup, password reset. Strict CORS allowing only `APP_URL` with credentials. State-changing requests protected against CSRF via Origin check plus SameSite cookie. Password min length: 10, max 72 bytes. Verification/reset tokens are SHA-256 hashed, single-use, expiring. Server-side gated dev helper (`NODE_ENV === 'development' AND EMAIL_MODE === 'console'`). Equal response messages and HTTP statuses for signup (new vs existing email) and password reset (existing vs non-existing email) to prevent email enumeration. No `SESSION_SECRET`. Note: Distributed password guessing against a single account from multiple IP addresses is a known security limitation of IP-based rate limiting until CAPTCHA is added.
- Email: Asynchronous MySQL outbox (`email_outbox` table). Auth flows insert outbox record and return immediately without blocking HTTP requests. Outbox worker processes batch sending via Nodemailer SMTP with exponential retry backoff. Pre-send suppression check against `suppressed_addresses` table. Provider webhook stub for bounces and complaints.
- Web UI: Plain and functional.
- No secrets in code. API keys live on the backend only, in environment variables (`.env`).
- Never store users' LinkedIn or Indeed passwords.

## MODULE 9: PRE-LAUNCH CHECKLIST (DO NOT BUILD NOW)
Before launching to production users, the following production readiness tasks must be executed and verified:
- [ ] Database Migration: Move off XAMPP MariaDB 10.4 to a supported database (e.g. MySQL 8.0+ or AWS Aurora MySQL) and rerun the complete test suite (`npm run test:all`).
- [ ] Outbox Concurrency: Implement atomic row claiming (`SELECT ... FOR UPDATE SKIP LOCKED` or status transition locking) before running more than one API worker instance.
- [ ] Scheduled Purge: Implement cron/scheduled background cleanup of expired user sessions and expired verification/reset tokens.
- [ ] SMTP Pooling: Configure pooled Nodemailer SMTP transport for persistent TCP connections under high volume.
- [ ] CAPTCHA Integration: Add CAPTCHA protection (e.g., Cloudflare Turnstile / reCAPTCHA) on signup and login endpoints.
- [ ] Anti-Distributed Guessing: Implement account-centric velocity locks to defend against distributed password guessing on a single account across multiple IPs.
- [ ] Database Backups: Configure automated daily database backups with point-in-time recovery, and execute a dry-run restoration test.
- [ ] Email Deliverability: Run live email deliverability tests validating DKIM signature alignment, SPF pass, and DMARC policy compliance.


## MODULE 0: FOUNDATION
Goal: a secure base that every later module sits on.
- Monorepo with three areas: web app (`apps/web`), API (`apps/api`), shared types (`packages/shared`). Empty folder for extension (`apps/extension`).
- Email and password signup and login, with email verification and password reset.
- Short-lived session tokens. Logout must invalidate the token immediately.
- The API exposes a "user is active" signal (last-activity time).
- MySQL connection (`job_agent_dev`), versioned migrations, `users`, `user_sessions`, `email_verifications`, `password_resets`, `user_settings`, `email_outbox`, and `suppressed_addresses` tables.
- Two-part DAL (`authDal` & `userScopedDal`) with automated driver import check.
- Redis connection & worker that fails loudly if Redis is down, leaving auth unaffected.
- Environment config (`.env.example` template).
- Protected web app page displaying logged-in user email and active session state.
- Comprehensive Test Suite (`npm run test:all`):
  - `npm run check:dal` (Strict DAL scope check)
  - `npm run test:acceptance` (Acceptance & isolation)
  - `npm run test:dal-isolation` (DAL unit isolation)
  - `npm run test:prod-security` (Production security & anti-enumeration)
  - `npm run test:offline-auth` (Auth suite with Redis stopped)
  - `npm run test:concurrency` (Atomic token consumption under concurrency)
  - `npm run test:heartbeat` (Session heartbeat extension & idle expiry)
  - `npm run test:outbox` (Email outbox, suppression, & SMTP retry recovery)

---

## DEPLOYMENT NOTES

### 1. Email Authentication & Deliverability (SPF, DKIM, DMARC)
For production email deliverability and domain reputation protection:
- **Sending Subdomain**: Use a dedicated subdomain for transactional emails (e.g. `mail.domain.com` or `mg.domain.com`). This isolates main domain reputation from transactional delivery signals.
- **SPF (Sender Policy Framework)**: Add a TXT record on the sending subdomain delegating authorized sending IP/hosts:
  `v=spf1 include:_spf.google.com include:mailgun.org ~all`
- **DKIM (DomainKeys Identified Mail)**: Configure a 2048-bit DKIM key pair via the email provider and publish the public key selector record:
  `k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgK...`
- **DMARC (Domain-based Message Authentication)**: Publish a DMARC record on the main domain to dictate handling for unaligned messages and receive aggregate reports:
  `v=DMARC1; p=reject; rua=mailto:dmarc-reports@domain.com; ruf=mailto:dmarc-forensics@domain.com; pct=100; adkim=r; aspf=r`

### 2. Staging & Production URLs
- **Public APP_URL**: For staging deployments, set `APP_URL` to the public HTTPS staging URL (e.g., `https://staging.jobassistant.com`) and `API_URL` to `https://staging-api.jobassistant.com`.
- **Email Links**: All generated verification and password reset links build URLs strictly dynamically using `APP_URL`.

### 3. Cookie Architecture for Web & API on Same Site
- **Unified Domain Architecture**: Deploy the Web Frontend and API Backend under the same parent domain (e.g. Frontend at `app.domain.com` and API at `api.domain.com`, or reverse proxied behind a single edge domain `domain.com`).
- **Cookie Security Attributes**:
  - `HttpOnly`: Enforced on all session cookies to eliminate XSS token theft.
  - `Secure`: Enforced automatically when `NODE_ENV !== 'development'`.
  - `SameSite=Lax`: Prevents CSRF attacks while allowing top-level navigation logins.
  - `Path=/`: Restricts scope to root path.

---

## KNOWN SYSTEM LIMITATIONS & CAPACITY CONSTRAINTS

### Job Sourcing Provider Quotas (Module 2)
- **JSearch Monthly Cap**: With JSearch hard-capped at 100 requests/month and shared database caching configured with an 8-hour TTL, the system supports approximately **3 distinct new searches per day system-wide** before JSearch monthly quota is exhausted.
- **SerpApi Monthly Cap**: SerpApi is capped at 250 searches/month (~8 distinct new searches per day system-wide).
- **Remotive**: Public open-access API with no monthly request limit.
- **Action Required Before User Onboarding**:
  This throughput constraint is a known limitation that must be revisited prior to onboarding real users. Recommended mitigations include:
  1. Upgrading JSearch and SerpApi subscription tiers.
  2. Extending shared cache TTL (e.g. from 8 hours to 24–48 hours).
  3. Rebalancing provider fallback strategy to rely more heavily on Remotive or SerpApi when JSearch nears its quota limit.

### Known Minor Issues (Non-blocking)
- **Module 5 Cosmetic Wording Bug**: Explanation wording for lower-scoring jobs occasionally includes `"based on verified expertise in ."` (dangling period when key skill parameter is empty). This issue does not affect scoring, matching, or exclusion correctness, and is logged to revisit later.

