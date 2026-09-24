-- Migration 002: Suppressed Emails Table
-- Target Engines: MariaDB 10.4+ and MySQL 8.0+
-- Assumptions & Guidelines:
-- 1. Holds email addresses that have bounced, reported complaints, or been manually suppressed.
-- 2. Checked before sending any email to prevent reputation damage.

CREATE TABLE IF NOT EXISTS suppressed_emails (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  reason VARCHAR(100) NOT NULL DEFAULT 'bounce',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
