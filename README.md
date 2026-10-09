# Multi-User Job-Hunting Assistant

A multi-tenant, AI-powered job application tracing and automation assistant. Users upload a single master CV, search and receive AI-tailored job matches, generate customized CVs and cover letters, track application statuses, and streamline form filing via a Chrome Extension — with strict security, cross-user data isolation, and a **zero auto-submit guarantee** (the user always reviews and submits applications manually).

---

## 🚀 Key Features & Architectural Modules

### 🔐 Module 0: Security & Auth Foundation
- **Multi-Tenant Architecture**: Strict row-level data isolation where every personal record is bound to a `user_id`.
- **Two-Part Data Access Layer (DAL)**: Separated into `authDal` (unauthenticated operations) and `userScopedDal` (requires explicit `userId`). Automated linting (`npm run check:dal`) prevents driver imports outside the DAL.
- **Session Management**: Random opaque tokens hashed with SHA-256 stored in MySQL. Features a sliding 30-minute idle expiry and absolute 24-hour max lifetime.
- **Asynchronous Email Outbox**: Non-blocking transactional email delivery via `email_outbox` table with suppression list and Nodemailer exponential backoff retries.
- **Resilient Infrastructure**: Redis/BullMQ handles background queues; if Redis is down, auth and core API routes continue operating without interruption.

### 📄 Module 1: CV Parsing & Profile Management
- Multi-format CV upload support (`PDF`, `DOCX`).
- LLM structured entity extraction (Contact info, Summary, Work history, Education, Skills, Certifications).
- User profile editing with explicit `is_user_edited` tracking to distinguish user edits from raw AI extractions.
- Single active profile enforcement per user.

### 🔍 Module 2: Job Sourcing & Shared Cache
- Multi-provider job integration (JSearch, SerpApi, Remotive).
- Non-personal shared job cache (`cached_jobs`, `job_cache_log`) with TTL to minimize API quota usage.
- Search query deduplication and location/remote filtering.

### 🎯 Module 3: Match Ranking & Semantic Scoring
- LLM match evaluation comparing job descriptions against user CV profiles.
- Detailed scoring output (0–100 match score, key match reasons, missing skills/gaps).
- Cached match results with user-driven exclusion toggles.

### ✍️ Module 4: CV & Cover Letter Tailoring
- AI-driven tailoring producing custom-fitted CV content for target job descriptions.
- **Anti-Hallucination Guardrails**: Mandatory validation checks preventing the AI from introducing unverified experiences or credentials not present in the user's source profile.
- Daily generation quota capping per user.
- Explicit document export triggers for `DOCX` and `PDF`.

### 📊 Module 5: Application Dashboard & Status Tracking
- Unified application status workflow: `Saved`, `Applying`, `Applied`, `Interviewing`, `Rejected`, `Offer`.
- Full user session lifecycle handling, activity heartbeat extension, and cross-tenant isolation enforcement.
- Automated end-to-end acceptance testing suite with screenshot evidence generation.

### 🧩 Module 6: Chrome Extension (Autofill Assistant - In Development)
- Manifest V3 Chrome Extension shell (`apps/extension`).
- Form detection and autofill for Greenhouse, Lever, and Ashby job application forms.
- Guided resume file-picker prompts.
- **Strict Zero Auto-Submit Policy**: No code path triggers form submission.

---

## 🛠️ Technology Stack

- **Monorepo Architecture**: npm workspaces
  - `apps/web`: Web Frontend (Next.js / TypeScript)
  - `apps/api`: REST API Backend (Express / Node.js / TypeScript)
  - `apps/extension`: Browser Extension (Manifest V3 / TypeScript)
  - `packages/shared`: Shared TypeScript types & validation schemas
- **Database**: MySQL 8+ / MariaDB 10.4 (Portable SQL dialect, utf8mb4)
- **Background Jobs & Queue**: Redis + BullMQ (optional worker process)
- **AI / LLM Integration**: Google Gemini API (`@google/genai`) & OpenAI API
- **Document Processing**: `pdf-parse`, `docx`, `mammoth`

---

## 📁 Repository Structure

```
├── apps/
│   ├── api/                  # Express REST API, DAL, services & migrations
│   │   ├── migrations/       # Versioned SQL migration files
│   │   ├── scripts/          # E2E test suites & evidence capture tools
│   │   ├── src/              # Application source code
│   │   │   ├── dal/          # Two-part isolated Data Access Layer
│   │   │   ├── middleware/   # Auth & rate-limiting middleware
│   │   │   ├── routes/       # API endpoints (auth, cv, jobs, matches, tailoredCv)
│   │   │   ├── services/     # Business logic, LLM providers & tailoring
│   │   │   └── worker.ts     # BullMQ background worker
│   │   └── test-output/      # Test output logs & screenshot evidence
│   ├── web/                  # Next.js frontend application
│   └── extension/            # Chrome Extension (Manifest V3)
├── packages/
│   └── shared/               # Shared TypeScript schemas and types
├── PROJECT_BRIEF.md          # Comprehensive architectural specification
├── package.json              # Root monorepo configuration
└── README.md                 # Project overview and documentation
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18.0.0+
- **npm**: v9.0.0+
- **MySQL**: 8.0+ or MariaDB 10.4+
- **Redis** (Optional): v6.0+ for background job queueing

### 1. Environment Setup

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Configure your environment variables in `.env`:
- Database connection settings (`DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`)
- LLM API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`)
- Email/SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`)
- Application URLs (`APP_URL`, `API_URL`)

### 2. Database Setup & Migration

Ensure MySQL is running and the database specified in `.env` exists, then run migrations:

```bash
npm run migrate
```

### 3. Running the Application

Start the backend API development server:
```bash
npm run dev:api
```

Start the background worker (optional):
```bash
npm run dev:worker
```

Start the web frontend:
```bash
npm run dev:web
```

---

## 🧪 Testing & Verification Suite

The project includes an extensive automated test suite enforcing security, multi-tenancy isolation, and operational guarantees.

Run all test suites:
```bash
npm run test:all
```

### Individual Test Commands

| Command | Purpose |
| :--- | :--- |
| `npm run check:dal` | Verifies strict DAL boundaries (prevents `mysql2` driver imports outside `/dal`) |
| `npm run test:acceptance` | Core user auth & profile isolation test suite |
| `npm run test:dal-isolation` | Validates strict cross-user data isolation at the database layer |
| `npm run test:prod-security` | Checks email non-enumeration, rate limits, and production security rules |
| `npm run test:offline-auth` | Validates full authentication workflow operating without Redis |
| `npm run test:concurrency` | Validates atomic single-use verification/reset token consumption under race conditions |
| `npm run test:heartbeat` | Tests sliding idle session extension and idle timeout revocation |
| `npm run test:outbox` | Verifies email outbox insertion, suppression, and retry backoff |

---

## 🔒 Security Architecture

1. **Cross-User Data Isolation**:
   All user queries pass through `userScopedDal` requiring `userId`. Automated static analysis (`npm run check:dal`) verifies no direct database queries bypass the DAL.
2. **Session Security**:
   - Random opaque tokens stored hashed (`SHA-256`).
   - `HttpOnly`, `SameSite=Lax`, and `Secure` cookie attributes.
   - Activity Heartbeat model (`POST /api/session/heartbeat`) prevents idle timeouts while active without extending session lifetime on background GET requests.
3. **Anti-Enumeration Protection**:
   Signup and password reset endpoints return identical HTTP responses regardless of whether an email exists in the system.
4. **Zero Auto-Submit Guarantee**:
   The application assistant and Chrome extension only autofill form inputs. They **never** programmatically click submit buttons or trigger form submission events.

---

## 📜 License

Private & Proprietary. All rights reserved.
