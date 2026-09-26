import { z } from 'zod';

const str = z.unknown().transform((v) => {
  if (v === null || v === undefined) return '';
  return String(v);
});

const bool = z.unknown().transform((v) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  return false;
});

export const WorkHistorySchema = z.object({
  title: str,
  company: str,
  location: str,
  start_date: str,
  end_date: str,
  is_current: bool,
  bullet_points: z.array(str).default([]),
});

export const EducationSchema = z.object({
  institution: str,
  degree: str,
  field_of_study: str,
  start_date: str,
  end_date: str,
});

export const SkillSchema = z.object({
  skill_name: str,
  category: str,
});

export const CertificationSchema = z.object({
  name: str,
  issuing_organization: str,
  issue_date: str,
  expiration_date: str,
  credential_id: str,
});

export const CvStructuredProfileSchema = z.object({
  contact_info: z.object({
    full_name: str,
    email: str,
    phone: str,
    location: str,
    linkedin_url: str,
    website: str,
  }).default({}),
  summary: str,
  work_history: z.array(WorkHistorySchema).default([]),
  education: z.array(EducationSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
});

export type CvStructuredProfile = z.infer<typeof CvStructuredProfileSchema>;

export function validateAndCleanCvProfile(input: any): {
  profile: CvStructuredProfile;
  needsReview: boolean;
} {
  const parsed = CvStructuredProfileSchema.safeParse(input || {});
  const profile: CvStructuredProfile = parsed.success
    ? parsed.data
    : {
        contact_info: { full_name: '', email: '', phone: '', location: '', linkedin_url: '', website: '' },
        summary: '',
        work_history: [],
        education: [],
        skills: [],
        certifications: [],
      };

  // Flag needs_review = true if key fields are missing/blank
  let needsReview = false;
  if (!profile.contact_info.full_name || !profile.contact_info.email || !profile.contact_info.phone) {
    needsReview = true;
  }
  if (profile.work_history.length === 0) {
    needsReview = true;
  }

  return { profile, needsReview };
}
