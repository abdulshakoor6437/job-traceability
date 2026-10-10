-- Migration 014: Status History Precision & Ordering Fix
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.

ALTER TABLE application_status_history MODIFY COLUMN transitioned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
