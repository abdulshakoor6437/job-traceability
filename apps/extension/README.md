# Job Application Assistant — Chrome Extension (Manifest V3)

A Chrome Extension for automated job application form detection, tailored CV selection, guided resume file pickers, and single-click application status tracking.

## Key Features & Security Architecture

1. **Manifest V3 Specification**: Modern, secure Manifest V3 architecture (`manifest.json`) using service worker background scripts (`background.js`) and background-to-content message passing.
2. **Supported ATS Job Boards**:
   - Greenhouse (`boards.greenhouse.io`, `job-boards.greenhouse.io`)
   - Lever (`jobs.lever.co`)
   - Ashby (`jobs.ashbyhq.com`)
3. **Form Field Detection & Autofill**:
   - Detects First Name, Last Name, Full Name, Email, Phone, Location, LinkedIn URL, Portfolio Website, and Cover Letter text fields.
   - Populates inputs and dispatches native `input`, `change`, and `blur` events so React/Vue component states update automatically.
   - Displays a guided resume upload prompt banner highlighting the file picker element on screen.
4. **Tailored CV Selection Dropdown**:
   - Integrates with API `GET /api/tailored-cv/list` to populate dropdown with user's current job-tailored CVs (e.g. `"Senior Backend Engineer @ Acme Corp — v2"`).
5. **Unsupported Page Protection**:
   - On non-ATS pages or unsupported sites, displays clear warning: `"No supported application form detected on this page (supports Greenhouse, Lever, Ashby)."`
6. **Zero Auto-Submit Guarantee**:
   - **STRICT SAFETY POLICY**: No code path calls `.submit()`, `form.submit()`, or programmatically clicks submit buttons.
   - Verified by static code review audit script (`npm run test:module6`).
7. **"Mark as Applied" Status Update**:
   - Updates target job status to `'APPLIED'` in MySQL database via `POST /api/applications/mark-applied`.
