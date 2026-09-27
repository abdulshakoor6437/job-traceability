CREATE TABLE IF NOT EXISTS tailored_cvs (
  id                   VARCHAR(36) PRIMARY KEY,
  user_id              VARCHAR(36) NOT NULL,
  source_cv_profile_id VARCHAR(36) NOT NULL,
  job_id               VARCHAR(36) NOT NULL,
  job_title            VARCHAR(255) NOT NULL,
  version_number       INT NOT NULL DEFAULT 1,
  is_current           TINYINT(1) NOT NULL DEFAULT 1,
  generation_status    VARCHAR(50) NOT NULL DEFAULT 'pending',
  validation_status    VARCHAR(50) NOT NULL DEFAULT 'pending',
  validation_issues    TEXT NULL,
  regeneration_count   INT NOT NULL DEFAULT 0,
  full_name            VARCHAR(255) NULL,
  email                VARCHAR(255) NULL,
  phone                VARCHAR(100) NULL,
  location             VARCHAR(255) NULL,
  linkedin_url         TEXT NULL,
  website              TEXT NULL,
  summary              TEXT NULL,
  is_user_edited       TINYINT(1) NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tailored_cvs_user (user_id),
  INDEX idx_tailored_cvs_job  (user_id, job_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_cv_profile_id) REFERENCES cv_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tailored_cv_work_history (
  id               VARCHAR(36) PRIMARY KEY,
  tailored_cv_id   VARCHAR(36) NOT NULL,
  user_id          VARCHAR(36) NOT NULL,
  title            VARCHAR(255) NOT NULL DEFAULT '',
  company          VARCHAR(255) NULL,
  location         VARCHAR(255) NULL,
  start_date       VARCHAR(20) NULL,
  end_date         VARCHAR(20) NULL,
  is_current       TINYINT(1) NOT NULL DEFAULT 0,
  bullet_points    LONGTEXT NULL,
  display_order    INT NOT NULL DEFAULT 0,
  INDEX idx_tailored_wh_cv (tailored_cv_id),
  FOREIGN KEY (tailored_cv_id) REFERENCES tailored_cvs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tailored_cv_education (
  id             VARCHAR(36) PRIMARY KEY,
  tailored_cv_id VARCHAR(36) NOT NULL,
  user_id        VARCHAR(36) NOT NULL,
  institution    VARCHAR(255) NOT NULL DEFAULT '',
  degree         VARCHAR(255) NULL,
  field_of_study VARCHAR(255) NULL,
  start_date     VARCHAR(20) NULL,
  end_date       VARCHAR(20) NULL,
  display_order  INT NOT NULL DEFAULT 0,
  INDEX idx_tailored_edu_cv (tailored_cv_id),
  FOREIGN KEY (tailored_cv_id) REFERENCES tailored_cvs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tailored_cv_skills (
  id             VARCHAR(36) PRIMARY KEY,
  tailored_cv_id VARCHAR(36) NOT NULL,
  user_id        VARCHAR(36) NOT NULL,
  skill_name     VARCHAR(255) NOT NULL DEFAULT '',
  category       VARCHAR(255) NULL,
  display_order  INT NOT NULL DEFAULT 0,
  INDEX idx_tailored_skills_cv (tailored_cv_id),
  FOREIGN KEY (tailored_cv_id) REFERENCES tailored_cvs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tailored_cv_certifications (
  id                   VARCHAR(36) PRIMARY KEY,
  tailored_cv_id       VARCHAR(36) NOT NULL,
  user_id              VARCHAR(36) NOT NULL,
  name                 VARCHAR(255) NOT NULL DEFAULT '',
  issuing_organization VARCHAR(255) NULL,
  issue_date           VARCHAR(20) NULL,
  expiration_date      VARCHAR(20) NULL,
  credential_id        VARCHAR(255) NULL,
  display_order        INT NOT NULL DEFAULT 0,
  INDEX idx_tailored_certs_cv (tailored_cv_id),
  FOREIGN KEY (tailored_cv_id) REFERENCES tailored_cvs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tailored_cv_generation_log (
  id         VARCHAR(36) PRIMARY KEY,
  user_id    VARCHAR(36) NOT NULL,
  log_date   DATE NOT NULL,
  count      INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_date (user_id, log_date),
  INDEX idx_gen_log_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
