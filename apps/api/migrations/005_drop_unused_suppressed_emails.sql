-- Migration 005: Drop Unused Suppressed Emails Legacy Table
-- Target Engines: MariaDB 10.4+ and MySQL 8.0+
-- Assumptions & Guidelines:
-- 1. Migration 004 created suppressed_addresses which is the active table used by authDal.
-- 2. Legacy table suppressed_emails created in migration 002 is unused and is now safely dropped.

DROP TABLE IF EXISTS suppressed_emails;
