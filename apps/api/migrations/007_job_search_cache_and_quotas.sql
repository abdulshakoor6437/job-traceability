-- Migration 007: Job Search Shared Cache, Deduplicated Jobs, and Provider Quota Logs
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.
-- Design Note: These tables store shared/global job search data and external provider metrics.
-- Per architectural rules and project requirements, these tables contain NO personal or user-identifying data
-- and explicitly have NO user_id column.

CREATE TABLE IF NOT EXISTS job_search_cache (
  id VARCHAR(36) PRIMARY KEY,
  cache_key VARCHAR(64) NOT NULL UNIQUE,
  query VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  filters_json TEXT NULL,
  result_count INT NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_job_search_cache_key (cache_key),
  INDEX idx_job_search_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cached_jobs (
  id VARCHAR(36) PRIMARY KEY,
  dedup_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  location VARCHAR(255) NULL,
  remote TINYINT(1) NOT NULL DEFAULT 0,
  salary_min DECIMAL(12,2) NULL,
  salary_max DECIMAL(12,2) NULL,
  salary_currency VARCHAR(10) NULL,
  description LONGTEXT NULL,
  apply_url TEXT NULL,
  posted_date DATETIME NULL,
  fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_providers TEXT NOT NULL,
  external_ids TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cached_jobs_dedup (dedup_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_search_cache_entries (
  id VARCHAR(36) PRIMARY KEY,
  search_cache_id VARCHAR(36) NOT NULL,
  job_id VARCHAR(36) NOT NULL,
  rank_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cache_entries_search (search_cache_id),
  INDEX idx_cache_entries_job (job_id),
  FOREIGN KEY (search_cache_id) REFERENCES job_search_cache(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES cached_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_api_logs (
  id VARCHAR(36) PRIMARY KEY,
  provider VARCHAR(50) NOT NULL,
  query VARCHAR(255) NOT NULL,
  response_count INT NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  status_code INT NOT NULL DEFAULT 200,
  is_success TINYINT(1) NOT NULL DEFAULT 1,
  error_message TEXT NULL,
  called_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_provider_logs_called (provider, called_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
