-- Migration 008: Job & CV Embeddings, User Match Cache, and Ranked Matches
-- Assumptions: MariaDB 10.4+ / MySQL 8.0+, InnoDB, utf8mb4_unicode_ci.
-- Multi-Tenant & Privacy Note:
-- - job_embeddings: Shared job cache data (FK to cached_jobs). Explicitly ZERO user_id or personal data columns.
-- - cv_profile_embeddings, user_match_cache, user_job_matches: USER-SPECIFIC tables. Every row requires user_id.

-- 1. Shared Job Embeddings (one per cached job, zero user_id)
CREATE TABLE IF NOT EXISTS job_embeddings (
  id VARCHAR(36) PRIMARY KEY,
  job_id VARCHAR(36) NOT NULL UNIQUE,
  text_hash VARCHAR(64) NOT NULL,
  embedding_vector MEDIUMTEXT NOT NULL,
  dimensions INT NOT NULL,
  model VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_job_emb_job (job_id),
  FOREIGN KEY (job_id) REFERENCES cached_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. User CV Profile Embeddings (user-scoped)
CREATE TABLE IF NOT EXISTS cv_profile_embeddings (
  id VARCHAR(36) PRIMARY KEY,
  cv_profile_id VARCHAR(36) NOT NULL UNIQUE,
  user_id VARCHAR(36) NOT NULL,
  text_hash VARCHAR(64) NOT NULL,
  embedding_vector MEDIUMTEXT NOT NULL,
  dimensions INT NOT NULL,
  model VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cv_emb_user (user_id),
  INDEX idx_cv_emb_profile (cv_profile_id),
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. User Match Cache (user-scoped cache entry invalidated on CV change or job pool refresh)
CREATE TABLE IF NOT EXISTS user_match_cache (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  cv_profile_id VARCHAR(36) NOT NULL,
  job_pool_version VARCHAR(64) NOT NULL,
  filters_hash VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_match_cache_user (user_id),
  INDEX idx_user_match_cache_lookup (user_id, cv_profile_id, job_pool_version, filters_hash),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. User Job Matches (user-scoped ranked results)
CREATE TABLE IF NOT EXISTS user_job_matches (
  id VARCHAR(36) PRIMARY KEY,
  match_cache_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  job_id VARCHAR(36) NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  label VARCHAR(50) NOT NULL,
  is_excluded TINYINT(1) NOT NULL DEFAULT 0,
  excluded_reason VARCHAR(255) NULL,
  explanation TEXT NULL,
  rank_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_matches_user (user_id),
  INDEX idx_user_matches_cache (match_cache_id),
  INDEX idx_user_matches_job (job_id),
  FOREIGN KEY (match_cache_id) REFERENCES user_match_cache(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES cached_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
