-- Migration 006: CV Files, Structured Profiles, and Child Data Tables
-- Target Engines: MariaDB 10.4+ and MySQL 8.0+

CREATE TABLE IF NOT EXISTS user_cv_files (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  storage_key VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes INT NOT NULL,
  raw_text LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cv_files_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cv_profiles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  cv_file_id VARCHAR(36) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  parsing_status VARCHAR(50) NOT NULL DEFAULT 'completed',
  parsing_error TEXT NULL,
  full_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  phone VARCHAR(100) NULL,
  location VARCHAR(255) NULL,
  linkedin_url VARCHAR(255) NULL,
  website VARCHAR(255) NULL,
  summary TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cv_profiles_user (user_id),
  INDEX idx_cv_profiles_user_active (user_id, is_active),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cv_file_id) REFERENCES user_cv_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cv_work_history (
  id VARCHAR(36) PRIMARY KEY,
  cv_profile_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  company VARCHAR(255) NULL,
  location VARCHAR(255) NULL,
  start_date VARCHAR(50) NULL,
  end_date VARCHAR(50) NULL,
  is_current TINYINT(1) NOT NULL DEFAULT 0,
  bullet_points JSON NULL,
  display_order INT NOT NULL DEFAULT 0,
  INDEX idx_work_history_profile (cv_profile_id),
  INDEX idx_work_history_user (user_id),
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cv_education (
  id VARCHAR(36) PRIMARY KEY,
  cv_profile_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  institution VARCHAR(255) NOT NULL,
  degree VARCHAR(255) NULL,
  field_of_study VARCHAR(255) NULL,
  start_date VARCHAR(50) NULL,
  end_date VARCHAR(50) NULL,
  display_order INT NOT NULL DEFAULT 0,
  INDEX idx_education_profile (cv_profile_id),
  INDEX idx_education_user (user_id),
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cv_skills (
  id VARCHAR(36) PRIMARY KEY,
  cv_profile_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  skill_name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NULL,
  display_order INT NOT NULL DEFAULT 0,
  INDEX idx_skills_profile (cv_profile_id),
  INDEX idx_skills_user (user_id),
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cv_certifications (
  id VARCHAR(36) PRIMARY KEY,
  cv_profile_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  issuing_organization VARCHAR(255) NULL,
  issue_date VARCHAR(50) NULL,
  expiration_date VARCHAR(50) NULL,
  credential_id VARCHAR(255) NULL,
  display_order INT NOT NULL DEFAULT 0,
  INDEX idx_certifications_profile (cv_profile_id),
  INDEX idx_certifications_user (user_id),
  FOREIGN KEY (cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
