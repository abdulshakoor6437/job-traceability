import { Router, Response } from 'express';
import multer from 'multer';
import { requireAuth, AuthenticatedRequest } from '../middleware/authMiddleware';
import { fileStorage } from '../services/storage/fileStorage';
import { sniffFileType } from '../services/storage/fileSniffer';
import { extractCvText } from '../services/cv/textExtractor';
import { llmManager } from '../services/llm/llmProvider';
import { cvDal } from '../dal/cvDal';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB Limit
});

// POST /api/cv/upload
router.post('/upload', (req: AuthenticatedRequest, res: Response, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'Payload Too Large',
          code: 'LIMIT_FILE_SIZE',
          message: 'File size exceeds maximum allowed limit of 10 MB.',
        });
        return;
      }
      if (err instanceof multer.MulterError) {
        res.status(400).json({
          error: 'Bad Request',
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(500).json({ error: 'Internal Server Error', message: err.message || 'File upload failed.' });
      return;
    }
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ message: 'No file uploaded or file is empty.' });
      return;
    }

    const userId = req.userId!;
    const fileBuffer = file.buffer;
    const detectedType = sniffFileType(fileBuffer);

    // Item 1: Magic Byte Content Sniffing Verification
    if (detectedType === 'unknown') {
      res.status(400).json({
        message: 'Invalid file format. Content sniffing rejected file: only valid .pdf and .docx files are permitted.',
      });
      return;
    }

    // Save to disk using random UUID filename via IFileStorage
    const savedFile = await fileStorage.saveFile(fileBuffer, detectedType);

    // Text extraction
    const extraction = await extractCvText(fileBuffer);

    // Save file record in DB
    const dbFile = await cvDal.createCvFile(
      userId,
      file.originalname || `upload.${detectedType}`,
      savedFile.storageKey,
      file.mimetype || (detectedType === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      savedFile.fileSizeBytes,
      extraction.text
    );

    // LLM Parsing & Structuring
    let profileResult: any;
    try {
      const llmResult = await llmManager.parseCvWithFallback(extraction.text);
      profileResult = await cvDal.createCvProfile(
        userId,
        dbFile.id,
        llmResult.profile,
        llmResult.needsReview || extraction.isScanned,
        'completed',
        null
      );
    } catch (llmErr: any) {
      console.error('[CV UPLOADER] LLM structuring failed:', llmErr.message);

      // Item 3: Mark "parsing failed, retry later" rather than dropping
      const fallbackProfile = {
        contact_info: { full_name: '', email: '', phone: '', location: null, linkedin_url: null, website: null },
        summary: null,
        work_history: [],
        education: [],
        skills: [],
        certifications: [],
      };

      profileResult = await cvDal.createCvProfile(
        userId,
        dbFile.id,
        fallbackProfile,
        true,
        'failed',
        llmErr.message
      );
    }

    res.status(201).json({
      message: 'CV uploaded and processed successfully.',
      profile: profileResult,
    });
  } catch (error: any) {
    console.error('CV Upload error:', error);
    res.status(500).json({ message: error.message || 'CV upload failed.' });
  }
});

// GET /api/cv/active
router.get('/active', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const activeProfile = await cvDal.getActiveProfile(userId);

    if (!activeProfile) {
      res.status(404).json({ message: 'No active CV profile found for this user.' });
      return;
    }

    res.json({ profile: activeProfile });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve active CV profile.' });
  }
});

// GET /api/cv/versions
router.get('/versions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const versions = await cvDal.getProfilesByUserId(userId);
    res.json({ versions });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve CV versions.' });
  }
});

// GET /api/cv/versions/:id
router.get('/versions/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profileId = req.params.id;
    const profile = await cvDal.getProfileById(userId, profileId);

    if (!profile) {
      res.status(404).json({ message: 'CV profile version not found.' });
      return;
    }

    res.json({ profile });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to retrieve CV profile version.' });
  }
});

// POST /api/cv/versions/:id/activate
router.post('/versions/:id/activate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profileId = req.params.id;
    const success = await cvDal.setActiveProfile(userId, profileId);

    if (!success) {
      res.status(404).json({ message: 'CV profile version not found.' });
      return;
    }

    res.json({ message: 'Activated CV profile version successfully.' });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to activate CV profile version.' });
  }
});

// PUT /api/cv/versions/:id
router.put('/versions/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profileId = req.params.id;
    const updatedData = req.body;

    const updated = await cvDal.updateProfile(userId, profileId, updatedData);
    if (!updated) {
      res.status(404).json({ message: 'CV profile version not found.' });
      return;
    }

    res.json({ message: 'CV profile updated successfully.', profile: updated });
  } catch (error: any) {
    if (error.message?.includes('Non-active')) {
      res.status(400).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: 'Failed to update CV profile.' });
  }
});

// DELETE /api/cv/versions/:id
router.delete('/versions/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const profileId = req.params.id;

    const result = await cvDal.deleteCvProfile(userId, profileId);
    if (!result.success) {
      res.status(404).json({ message: 'CV profile version not found.' });
      return;
    }

    if (result.storageKey) {
      await fileStorage.deleteFile(result.storageKey);
    }

    res.json({ message: 'CV profile and physical file deleted successfully.' });
  } catch (error: any) {
    res.status(500).json({ message: 'Failed to delete CV profile.' });
  }
});

export default router;
