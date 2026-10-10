-- Migration 010: User Job Applications & Status Tracking
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.
-- Multi-Tenant & Privacy Note: Every row requires user_id. Scoped strictly to req.userId.

CREATE TABLE IF NOT EXISTS user_applications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  job_id VARCHAR(36) NOT NULL,
  tailored_cv_id VARCHAR(36) NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'APPLIED',
  notes TEXT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_job_app (user_id, job_id),
  INDEX idx_apps_user (user_id),
  INDEX idx_apps_job (job_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES cached_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (tailored_cv_id) REFERENCES tailored_cvs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
