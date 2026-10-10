-- Migration 012: User Notifications & High-Match Alerts Table
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.
-- Multi-Tenant & Privacy Note: Every row requires user_id. Scoped strictly to req.userId.

CREATE TABLE IF NOT EXISTS user_notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'high_match',
  message TEXT NOT NULL,
  related_job_id VARCHAR(255) NULL,
  related_tailored_cv_id VARCHAR(36) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user_unread (user_id, is_read),
  INDEX idx_notifications_user_created (user_id, created_at DESC),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
