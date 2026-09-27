/**
 * tailoredCv.ts — Express router for POST /api/tailored-cv/*
 *
 * All routes require authentication (requireAuth middleware).
 * All DAL calls are fully user-scoped; no cross-user access is possible.
 * Export is ONLY triggered by an explicit user action — never automatically.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { cvDal } from '../dal/cvDal';
import { tailoredCvDal } from '../dal/tailoredCvDal';
import { jobDal } from '../dal/jobDal';
import { tailoringService } from '../services/tailoring/tailoringService';
import { exportToDocx, exportToPdf } from '../services/tailoring/exportService';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Daily generation cap (Item 6)
// ---------------------------------------------------------------------------
function getDailyGenerationCap(): number {
  const raw = process.env.TAILORED_CV_DAILY_CAP;
  const parsed = parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

// ---------------------------------------------------------------------------
// Item 7 / Scope 1: POST /api/tailored-cv/generate
// Body: { jobId: string }
// Returns the newly-generated tailored CV record.
// ---------------------------------------------------------------------------
router.post('/generate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { jobId } = req.body as { jobId?: string };

    if (!jobId || typeof jobId !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: '`jobId` (string) is required in the request body.' });
      return;
    }

    // Item 6: Enforce daily generation cap
    const cap = getDailyGenerationCap();
    const todayCount = await tailoredCvDal.getDailyGenerationCount(userId);
    if (todayCount >= cap) {
      res.status(429).json({
        error: 'Daily Limit Reached',
        message: `You have reached your daily tailored CV generation limit of ${cap}. Please try again tomorrow.`,
        dailyLimit: cap,
        usedToday: todayCount,
      });
      return;
    }

    // Resolve job from shared cached_jobs via jobDal (DAL-only rule)
    const job = await jobDal.getJobById(jobId);
    if (!job) {
      res.status(404).json({ error: 'Not Found', message: `Job '${jobId}' not found.` });
      return;
    }

    // Resolve user's active CV profile (user-scoped)
    const activeProfile = await cvDal.getActiveProfile(userId);
    if (!activeProfile) {
      res.status(422).json({
        error: 'Unprocessable Entity',
        message: 'No active CV profile found. Upload and parse a CV first.',
      });
      return;
    }

    // Build CvStructuredProfile from DB rows
    const sourceCv = {
      contact_info: {
        full_name: activeProfile.profile.full_name || '',
        email: activeProfile.profile.email || '',
        phone: activeProfile.profile.phone || '',
        location: activeProfile.profile.location || null,
        linkedin_url: activeProfile.profile.linkedin_url || null,
        website: activeProfile.profile.website || null,
      },
      summary: activeProfile.profile.summary || null,
      work_history: activeProfile.workHistory.map((w) => ({
        title: w.title,
        company: w.company || '',
        location: w.location || null,
        start_date: w.start_date || '',
        end_date: w.end_date || null,
        is_current: Boolean(w.is_current),
        bullet_points: (() => {
          try { return typeof w.bullet_points === 'string' ? JSON.parse(w.bullet_points) : (w.bullet_points || []); }
          catch { return []; }
        })(),
      })),
      education: activeProfile.education.map((e) => ({
        institution: e.institution,
        degree: e.degree || '',
        field_of_study: e.field_of_study || null,
        start_date: e.start_date || null,
        end_date: e.end_date || null,
      })),
      skills: activeProfile.skills.map((s) => ({ skill_name: s.skill_name, category: s.category || null })),
      certifications: activeProfile.certifications.map((c) => ({
        name: c.name,
        issuing_organization: c.issuing_organization || null,
        issue_date: c.issue_date || null,
        expiration_date: c.expiration_date || null,
        credential_id: c.credential_id || null,
      })),
    };

    // Increment quota BEFORE generation (fail-safe: if generation throws we still count)
    await tailoredCvDal.incrementDailyGenerationCount(userId);

    // Perform tailoring (with entity validation + one-retry)
    const tailoringResult = await tailoringService.tailorCv({
      sourceCv,
      jobTitle: job.title,
      jobDescription: job.description || job.title,
    });

    // Persist tailored CV record
    const stored = await tailoredCvDal.createTailoredCv({
      userId,
      sourceCvProfileId: activeProfile.profile.id,
      jobId: job.id,
      jobTitle: job.title,
      structuredData: tailoringResult.tailoredProfile,
      generationStatus: 'completed',
      validationStatus: tailoringResult.validationStatus,
      validationIssues: tailoringResult.validationIssues.length > 0
        ? JSON.stringify(tailoringResult.validationIssues)
        : null,
      regenerationCount: tailoringResult.regenerated ? 1 : 0,
    });

    const responsePayload: any = {
      message: 'Tailored CV generated successfully.',
      tailoredCv: stored,
      validationStatus: tailoringResult.validationStatus,
      regenerated: tailoringResult.regenerated,
      usedProvider: tailoringResult.usedProvider,
    };

    // Surface validation issues as a warning (never silently discard)
    if (tailoringResult.validationStatus === 'flagged') {
      responsePayload.warning =
        'This tailored CV was flagged: the LLM introduced entities not found in your source CV even after regeneration. Review the validationIssues before using this CV.';
      responsePayload.validationIssues = tailoringResult.validationIssues;
    }

    res.status(201).json(responsePayload);
  } catch (err: any) {
    console.error('[TAILORED CV] Generate error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message || 'Generation failed.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tailored-cv/job/:jobId  — list all versions for a job
// ---------------------------------------------------------------------------
router.get('/job/:jobId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { jobId } = req.params;
    const versions = await tailoredCvDal.listByJob(userId, jobId);
    res.json({ versions });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tailored-cv/job/:jobId/current  — get the current version
// ---------------------------------------------------------------------------
router.get('/job/:jobId/current', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { jobId } = req.params;
    const current = await tailoredCvDal.getCurrentByJob(userId, jobId);
    if (!current) {
      res.status(404).json({ message: 'No tailored CV found for this job.' });
      return;
    }
    res.json({ tailoredCv: current });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/tailored-cv/:id  — get a specific version by ID
// ---------------------------------------------------------------------------
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const record = await tailoredCvDal.getById(userId, id);
    if (!record) {
      res.status(404).json({ message: 'Tailored CV not found.' });
      return;
    }
    res.json({ tailoredCv: record });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tailored-cv/:id  — user edits (Item 4)
// Saves user edits. Sets is_user_edited=1 to distinguish from AI output.
// ---------------------------------------------------------------------------
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const updatedData = req.body;

    const updated = await tailoredCvDal.updateTailoredCv(userId, id, updatedData);
    if (!updated) {
      res.status(404).json({ message: 'Tailored CV not found.' });
      return;
    }
    res.json({
      message: 'Tailored CV updated. Edit saved and distinguished from original AI-generated version.',
      tailoredCv: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tailored-cv/:id/export/docx  — explicit DOCX export (Item 5)
// This endpoint is the ONLY trigger for DOCX generation.
// Never called automatically.
// ---------------------------------------------------------------------------
router.post('/:id/export/docx', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const record = await tailoredCvDal.getById(userId, id);
    if (!record) {
      res.status(404).json({ message: 'Tailored CV not found.' });
      return;
    }

    const buffer = await exportToDocx(record);
    const filename = `tailored-cv-${id}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err: any) {
    console.error('[TAILORED CV] DOCX export error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/tailored-cv/:id/export/pdf  — explicit PDF export (Item 5)
// This endpoint is the ONLY trigger for PDF generation.
// Never called automatically.
// ---------------------------------------------------------------------------
router.post('/:id/export/pdf', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;

    const record = await tailoredCvDal.getById(userId, id);
    if (!record) {
      res.status(404).json({ message: 'Tailored CV not found.' });
      return;
    }

    const pdfBytes = await exportToPdf(record);
    const filename = `tailored-cv-${id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err: any) {
    console.error('[TAILORED CV] PDF export error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
