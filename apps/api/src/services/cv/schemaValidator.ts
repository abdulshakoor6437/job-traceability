import { z } from 'zod';

export const WorkHistorySchema = z.object({
  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  start_date: z.string().default(''),
  end_date: z.string().default(''),
  is_current: z.boolean().default(false),
  bullet_points: z.array(z.string()).default([]),
});

export const EducationSchema = z.object({
  institution: z.string().default(''),
  degree: z.string().default(''),
  field_of_study: z.string().default(''),
  start_date: z.string().default(''),
  end_date: z.string().default(''),
});

export const SkillSchema = z.object({
  skill_name: z.string().default(''),
  category: z.string().default(''),
});

export const CertificationSchema = z.object({
  name: z.string().default(''),
  issuing_organization: z.string().default(''),
  issue_date: z.string().default(''),
  expiration_date: z.string().default(''),
  credential_id: z.string().default(''),
});

export const CvStructuredProfileSchema = z.object({
  contact_info: z.object({
    full_name: z.string().default(''),
    email: z.string().default(''),
    phone: z.string().default(''),
    location: z.string().default(''),
    linkedin_url: z.string().default(''),
    website: z.string().default(''),
  }).default({}),
  summary: z.string().default(''),
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
