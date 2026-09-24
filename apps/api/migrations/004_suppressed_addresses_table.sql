-- Migration 004: Suppressed Addresses Table Schema Alignment
-- Target Engines: MariaDB 10.4+ and MySQL 8.0+
-- Assumptions & Guidelines:
-- 1. Ensures suppressed_addresses table exists for anti-bounce/complaint suppression checks.

CREATE TABLE IF NOT EXISTS suppressed_addresses (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  reason VARCHAR(100) NOT NULL DEFAULT 'bounce',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
