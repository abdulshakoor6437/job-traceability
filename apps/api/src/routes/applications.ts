import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { applicationDal } from '../dal/applicationDal';
import { jobDal } from '../dal/jobDal';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/applications/mark-applied — Mark a job as applied (Item 7)
// Body: { jobId: string, tailoredCvId?: string, status?: string, notes?: string }
// ---------------------------------------------------------------------------
router.post('/mark-applied', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { jobId, tailoredCvId, status, notes } = req.body as {
      jobId?: string;
      tailoredCvId?: string;
      status?: string;
      notes?: string;
    };

    if (!jobId || typeof jobId !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: '`jobId` (string) is required.' });
      return;
    }

    // Verify job exists in cached_jobs
    const job = await jobDal.getJobById(jobId);
    if (!job) {
      res.status(404).json({ error: 'Not Found', message: `Job '${jobId}' not found.` });
      return;
    }

    const application = await applicationDal.markAsApplied({
      userId,
      jobId,
      tailoredCvId: tailoredCvId || null,
      status: status || 'APPLIED',
      notes: notes || null,
    });

    res.status(200).json({
      message: 'Job status updated to APPLIED successfully.',
      application,
    });
  } catch (err: any) {
    console.error('[APPLICATIONS ROUTE] Mark applied error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/applications/:id/status — Update status of an application
// Body: { status: string, notes?: string }
// ---------------------------------------------------------------------------
router.patch('/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { status, notes } = req.body as { status?: string; notes?: string };

    if (!status || typeof status !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: '`status` (string) is required.' });
      return;
    }

    const updated = await applicationDal.updateStatus(userId, id, status, notes);
    if (!updated) {
      res.status(404).json({ error: 'Not Found', message: 'Application record not found.' });
      return;
    }

    res.json({
      message: 'Application status updated successfully.',
      application: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/applications/job/:jobId — Get application record by jobId
// ---------------------------------------------------------------------------
router.get('/job/:jobId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { jobId } = req.params;

    const application = await applicationDal.getApplicationByJob(userId, jobId);
    if (!application) {
      res.status(404).json({ message: 'No application record found for this job.' });
      return;
    }

    res.json({ application });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/applications — List user's application records
// ---------------------------------------------------------------------------
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const applications = await applicationDal.listByUser(userId);
    res.json({ applications });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
