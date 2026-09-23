# PROJECT BRIEF: Multi-User Job-Hunting Assistant

We are building a multi-user job-hunting assistant. Each user uploads a CV once. While the user is logged in, the system finds matching jobs, tailors a CV and cover letter for each job, and puts them in a queue. The user opens a job, the application form is filled in seconds by a Chrome extension, and THE USER ALWAYS PRESSES SUBMIT THEMSELVES. When the user logs out or is inactive for about 30 minutes, all work for that user stops.

## TECH DECISIONS (fixed, do not change without asking)
- TypeScript everywhere: Next.js web app, Node API backend, Chrome extension (later).
- Database: MySQL 8+ / MariaDB 10.4 in development. Portable SQL only, no JSON functions. Database name: `job_agent_dev` with dedicated user `job_agent_user`. utf8mb4, versioned migrations kept in repo.
- Redis plus a background job queue (BullMQ). Redis is ONLY used for background jobs, NOT for auth. Worker fails loudly if Redis is unavailable (`[QUEUE WORKER ERROR] REDIS IS UNAVAILABLE!`).
- Job data comes only from the JSearch and SerpAPI APIs. No scraping.
- The system is multi-tenant from day one. Every table holding personal data has a user ID. The only exception is shared job cache tables, which must contain no personal data.
- MySQL cannot enforce row-level security, so ALL database access must go through one shared data-access layer.
  - (a) `authDal` for unauthenticated operations (signup, login, verification, password reset).
  - (b) `userScopedDal` requiring `userId` for every method.
  - ONLY the `dal` folder may import the database driver (`mysql2`) or db pool (`db.ts`). Enforced by automated check (`npm run check:dal`).
- Sessions: Random opaque session tokens (NOT JWTs). Store SHA-256 hash of token in `user_sessions`. MySQL is single source of truth. Logout deletes/revokes session row immediately. Sliding 30-minute idle expiry, absolute 24-hour max lifetime. httpOnly, SameSite=Lax cookie (`secure` flag set whenever `NODE_ENV !== 'development'`).
- Active Signal & Passive Polling: Only real user activity extends the session. Background polling sends `X-Passive-Request: true` header and does NOT extend `idle_expires_at` or update `last_active_at`. Web app sends explicit `POST /api/user/heartbeat` only when tab is visible and user interacted recently.
- Auth Hardening & Security: Rate limiting on login, signup, password reset. Strict CORS allowing only `APP_URL` with credentials. State-changing requests protected against CSRF via Origin check plus SameSite cookie. Password min length: 10. Verification/reset tokens are SHA-256 hashed, single-use, expiring. No unused `SESSION_SECRET`.
- Email: Logged to console in dev via interface (`IEmailService`), with direct verification helper in local dev UI.
- Web UI: Plain and functional.
- No secrets in code. API keys live on the backend only, in environment variables (`.env`).
- Never store users' LinkedIn or Indeed passwords.

## RULES FOR YOU
1. Build one module at a time. Do not start the next module until I confirm.
2. If anything is ambiguous, list the options and ask me. Do not guess.
3. Every external API call needs caching, retry, and rate limiting.
4. When finished with a module, give me a report with: what was built, the folder structure, the environment variables required, how to run and test it, and what is NOT finished.
5. Save this brief in the repo as PROJECT_BRIEF.md so it can be re-read at any time.

## MODULE 0: FOUNDATION (build only this)
Goal: a secure base that every later module sits on.
- Monorepo with three areas: web app (`apps/web`), API (`apps/api`), shared types (`packages/shared`). Empty folder for extension (`apps/extension`).
- Email and password signup and login, with email verification and password reset.
- Short-lived session tokens. Logout must invalidate the token immediately.
- The API exposes a "user is active" signal (last-activity time).
- MySQL connection (`job_agent_dev`), versioned migrations, `users`, `user_sessions`, `email_verifications`, `password_resets`, and `user_settings` tables.
- Two-part DAL (`authDal` & `userScopedDal`) with automated driver import check.
- Redis connection & worker that fails loudly if Redis is down, leaving auth unaffected.
- Environment config (`.env.example` template).
- Protected web app page displaying logged-in user email and active session state.
- Acceptance test script (`scripts/test-acceptance.ts`) demonstrating multi-tenant isolation with `user_settings` under arbitrary IDs, unverified login prevention, real email verification, passive idle timeout expiration, and immediate token revocation on logout.

## DATABASE CHECK (COMPLETED)
- Server: `10.4.32-MariaDB`
- Database: `job_agent_dev` created. Dedicated MySQL user `job_agent_user` configured.
