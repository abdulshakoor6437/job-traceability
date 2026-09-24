-- Migration 003: Email Outbox Table and User Settings Unique Constraint
-- Target Engines: MariaDB 10.4+ and MySQL 8.0+
-- Assumptions & Guidelines:
-- 1. email_outbox holds transactional emails queued for asynchronous processing.
-- 2. Ensures user_settings has UNIQUE constraint on user_id for atomic upserts.

CREATE TABLE IF NOT EXISTS email_outbox (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  payload TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE user_settings ADD CONSTRAINT UNIQUE (user_id);
