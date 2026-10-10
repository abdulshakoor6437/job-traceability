-- Migration 013: Email Digest Settings & Application Status History Table
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.
-- Multi-Tenant & Privacy Note: Every row requires user_id. Scoped strictly to req.userId.

-- 1. Add email digest preference & last digest timestamp to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS email_digest_opt_out TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_digest_sent_at DATETIME NULL;

-- 2. Application Status Transition History Table (Module 8 Item 4 addition)
CREATE TABLE IF NOT EXISTS application_status_history (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  application_id VARCHAR(36) NOT NULL,
  from_status VARCHAR(50) NULL,
  to_status VARCHAR(50) NOT NULL,
  notes TEXT NULL,
  transitioned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status_hist_app (application_id),
  INDEX idx_status_hist_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES user_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
