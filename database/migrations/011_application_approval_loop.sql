SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE users
  MODIFY COLUMN role ENUM('admin', 'applicant', 'project_owner') NOT NULL;

ALTER TABLE project_participations
  ADD COLUMN active_owner_project_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN role = 'owner' AND deleted_at IS NULL THEN project_id ELSE NULL END) STORED,
  ADD COLUMN active_owner_person_id BIGINT UNSIGNED
    GENERATED ALWAYS AS (CASE WHEN role = 'owner' AND deleted_at IS NULL THEN person_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_one_owner_per_project (active_owner_project_id),
  ADD UNIQUE KEY uk_one_project_per_owner (active_owner_person_id);

CREATE TABLE application_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_name VARCHAR(160) NOT NULL,
  application_year SMALLINT NOT NULL,
  approval_round ENUM('first', 'supplement') NOT NULL,
  status ENUM('draft', 'open', 'closed', 'reported', 'completed') NOT NULL DEFAULT 'draft',
  is_historical TINYINT(1) NOT NULL DEFAULT 0,
  starts_at DATETIME NULL,
  deadline_at DATETIME NULL,
  application_schema JSON NOT NULL,
  school_export_columns JSON NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_batch_name_year (application_year, batch_name),
  KEY idx_application_batches_round_status (application_year, approval_round, status),
  CONSTRAINT fk_application_batches_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_material_requirements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_batch_id BIGINT UNSIGNED NOT NULL,
  requirement_code VARCHAR(80) NOT NULL,
  requirement_name VARCHAR(160) NOT NULL,
  description VARCHAR(1000) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  allowed_extensions JSON NOT NULL,
  max_file_mb INT NOT NULL DEFAULT 20,
  sort_order INT NOT NULL DEFAULT 0,
  template_original_name VARCHAR(255) NULL,
  template_storage_path VARCHAR(500) NULL,
  template_file_size BIGINT NULL,
  template_sha256 CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_requirement_code (application_batch_id, requirement_code),
  CONSTRAINT fk_application_requirement_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_batch_id BIGINT UNSIGNED NOT NULL,
  applicant_user_id BIGINT UNSIGNED NOT NULL,
  applicant_person_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft', 'submitted', 'returned', 'eligible', 'frozen', 'school_approved', 'school_rejected', 'withdrawn', 'converted') NOT NULL DEFAULT 'draft',
  application_data JSON NOT NULL,
  submission_version INT UNSIGNED NOT NULL DEFAULT 0,
  submitted_at DATETIME NULL,
  internal_reviewed_by BIGINT UNSIGNED NULL,
  internal_reviewed_at DATETIME NULL,
  internal_review_reason VARCHAR(1000) NULL,
  frozen_at DATETIME NULL,
  school_result_at DATETIME NULL,
  school_result_remark VARCHAR(1000) NULL,
  project_id BIGINT UNSIGNED NULL,
  withdrawal_reason VARCHAR(1000) NULL,
  active_applicant_person_id BIGINT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN status IN ('draft','submitted','returned','eligible','frozen','school_approved') THEN applicant_person_id ELSE NULL END
  ) STORED,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_batch_person (application_batch_id, applicant_person_id),
  UNIQUE KEY uk_one_active_application_per_student (active_applicant_person_id),
  KEY idx_project_applications_status (application_batch_id, status),
  CONSTRAINT fk_project_application_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id),
  CONSTRAINT fk_project_application_user FOREIGN KEY (applicant_user_id) REFERENCES users(id),
  CONSTRAINT fk_project_application_person FOREIGN KEY (applicant_person_id) REFERENCES people(id),
  CONSTRAINT fk_project_application_reviewer FOREIGN KEY (internal_reviewed_by) REFERENCES users(id),
  CONSTRAINT fk_project_application_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_material_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_application_id BIGINT UNSIGNED NOT NULL,
  material_requirement_id BIGINT UNSIGNED NOT NULL,
  submission_version INT UNSIGNED NOT NULL,
  file_version INT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(120) NULL,
  sha256 CHAR(64) NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_material_version (project_application_id, material_requirement_id, file_version),
  KEY idx_application_material_submission (project_application_id, submission_version),
  CONSTRAINT fk_application_material_application FOREIGN KEY (project_application_id) REFERENCES project_applications(id),
  CONSTRAINT fk_application_material_requirement FOREIGN KEY (material_requirement_id) REFERENCES application_material_requirements(id),
  CONSTRAINT fk_application_material_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_material_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_application_id BIGINT UNSIGNED NOT NULL,
  submission_version INT UNSIGNED NOT NULL,
  review_result ENUM('eligible', 'returned') NOT NULL,
  review_reason VARCHAR(1000) NULL,
  reviewed_by BIGINT UNSIGNED NOT NULL,
  reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_submission_review (project_application_id, submission_version),
  CONSTRAINT fk_application_review_application FOREIGN KEY (project_application_id) REFERENCES project_applications(id),
  CONSTRAINT fk_application_review_user FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_export_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_batch_id BIGINT UNSIGNED NOT NULL,
  export_no VARCHAR(80) NOT NULL,
  status ENUM('building', 'ready', 'recalled', 'failed') NOT NULL DEFAULT 'building',
  application_count INT UNSIGNED NOT NULL DEFAULT 0,
  workbook_path VARCHAR(500) NULL,
  package_path VARCHAR(500) NULL,
  snapshot JSON NOT NULL,
  failure_reason VARCHAR(1000) NULL,
  recall_reason VARCHAR(1000) NULL,
  exported_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recalled_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_application_export_no (export_no),
  KEY idx_application_export_batch (application_batch_id, status),
  CONSTRAINT fk_application_export_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id),
  CONSTRAINT fk_application_export_user FOREIGN KEY (exported_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_export_items (
  application_export_id BIGINT UNSIGNED NOT NULL,
  project_application_id BIGINT UNSIGNED NOT NULL,
  submission_version INT UNSIGNED NOT NULL,
  PRIMARY KEY (application_export_id, project_application_id),
  CONSTRAINT fk_application_export_item_export FOREIGN KEY (application_export_id) REFERENCES application_export_records(id),
  CONSTRAINT fk_application_export_item_application FOREIGN KEY (project_application_id) REFERENCES project_applications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE school_result_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  application_batch_id BIGINT UNSIGNED NOT NULL,
  import_kind ENUM('application_result', 'historical_first') NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NULL,
  file_size BIGINT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  validation_status ENUM('valid', 'invalid', 'committed') NOT NULL,
  validation_summary JSON NOT NULL,
  normalized_rows JSON NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_by BIGINT UNSIGNED NULL,
  committed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_school_result_batch (application_batch_id, validation_status),
  CONSTRAINT fk_school_result_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id),
  CONSTRAINT fk_school_result_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id),
  CONSTRAINT fk_school_result_committer FOREIGN KEY (committed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_approval_sources (
  project_id BIGINT UNSIGNED NOT NULL,
  application_batch_id BIGINT UNSIGNED NOT NULL,
  project_application_id BIGINT UNSIGNED NULL,
  school_result_import_id BIGINT UNSIGNED NULL,
  source_type ENUM('application', 'historical_official_list') NOT NULL,
  historical_material_status ENUM('available', 'missing_historical', 'not_applicable') NOT NULL DEFAULT 'not_applicable',
  official_row_snapshot JSON NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id),
  UNIQUE KEY uk_project_source_application (project_application_id),
  CONSTRAINT fk_project_source_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_source_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id),
  CONSTRAINT fk_project_source_application FOREIGN KEY (project_application_id) REFERENCES project_applications(id),
  CONSTRAINT fk_project_source_import FOREIGN KEY (school_result_import_id) REFERENCES school_result_imports(id),
  CONSTRAINT fk_project_source_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE application_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_type VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  application_batch_id BIGINT UNSIGNED NULL,
  project_application_id BIGINT UNSIGNED NULL,
  project_id BIGINT UNSIGNED NULL,
  event_payload JSON NOT NULL,
  source_ip_hash CHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_application_audit_batch_time (application_batch_id, created_at),
  KEY idx_application_audit_application_time (project_application_id, created_at),
  CONSTRAINT fk_application_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_application_audit_batch FOREIGN KEY (application_batch_id) REFERENCES application_batches(id),
  CONSTRAINT fk_application_audit_application FOREIGN KEY (project_application_id) REFERENCES project_applications(id),
  CONSTRAINT fk_application_audit_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER trg_application_audit_no_update BEFORE UPDATE ON application_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application audit events are immutable';
CREATE TRIGGER trg_application_audit_no_delete BEFORE DELETE ON application_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application audit events are immutable';
CREATE TRIGGER trg_application_files_no_update BEFORE UPDATE ON application_material_files
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application material versions are immutable';
CREATE TRIGGER trg_application_files_no_delete BEFORE DELETE ON application_material_files
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'application material versions are immutable';
