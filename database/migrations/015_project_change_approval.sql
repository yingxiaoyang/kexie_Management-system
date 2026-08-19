SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE material_tasks
  ADD COLUMN task_type ENUM('standard', 'project_change') NOT NULL DEFAULT 'standard' AFTER task_description,
  ADD COLUMN change_phase ENUM('midterm', 'stage') NULL AFTER task_type,
  ADD COLUMN change_scope JSON NULL AFTER change_phase;

CREATE TABLE project_change_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_task_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  initiated_by BIGINT UNSIGNED NOT NULL,
  initiator_type ENUM('owner', 'forced_admin') NOT NULL DEFAULT 'owner',
  status ENUM('draft', 'submitted', 'returned', 'approved') NOT NULL DEFAULT 'draft',
  current_version INT UNSIGNED NOT NULL DEFAULT 0,
  proposed_changes JSON NOT NULL,
  forced_reason VARCHAR(1000) NULL,
  return_reason VARCHAR(1000) NULL,
  latest_submission_id BIGINT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  effective_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  active_task_project_key VARCHAR(180)
    GENERATED ALWAYS AS (
      CASE WHEN status IN ('draft', 'submitted', 'returned')
        THEN CONCAT(material_task_id, ':', project_id) ELSE NULL END
    ) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_change_active_task_project (active_task_project_key),
  UNIQUE KEY uk_change_latest_submission (latest_submission_id),
  KEY idx_change_project_status (project_id, status, updated_at),
  KEY idx_change_task_status (material_task_id, status, updated_at),
  CONSTRAINT fk_change_task FOREIGN KEY (material_task_id) REFERENCES material_tasks(id),
  CONSTRAINT fk_change_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_change_initiator FOREIGN KEY (initiated_by) REFERENCES users(id),
  CONSTRAINT fk_change_latest_submission FOREIGN KEY (latest_submission_id) REFERENCES material_submissions(id),
  CONSTRAINT fk_change_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT chk_change_forced_reason CHECK (
    (initiator_type = 'owner' AND forced_reason IS NULL)
    OR (initiator_type = 'forced_admin' AND forced_reason IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_change_draft_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  change_request_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(120) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_change_draft_files_request (change_request_id, deleted_at),
  CONSTRAINT fk_change_draft_file_request FOREIGN KEY (change_request_id) REFERENCES project_change_requests(id),
  CONSTRAINT fk_change_draft_file_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_change_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  change_request_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  material_submission_id BIGINT UNSIGNED NOT NULL,
  before_snapshot JSON NOT NULL,
  proposed_changes JSON NOT NULL,
  submitted_by BIGINT UNSIGNED NOT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_change_request_version (change_request_id, version_no),
  UNIQUE KEY uk_change_version_submission (material_submission_id),
  CONSTRAINT fk_change_version_request FOREIGN KEY (change_request_id) REFERENCES project_change_requests(id),
  CONSTRAINT fk_change_version_submission FOREIGN KEY (material_submission_id) REFERENCES material_submissions(id),
  CONSTRAINT fk_change_version_submitter FOREIGN KEY (submitted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE project_change_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  change_request_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  version_no INT UNSIGNED NOT NULL,
  event_type ENUM('draft_created', 'draft_saved', 'proof_uploaded', 'submitted', 'returned', 'approved') NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  material_submission_id BIGINT UNSIGNED NULL,
  event_payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_change_audit_request_time (change_request_id, created_at),
  KEY idx_change_audit_project_time (project_id, created_at),
  CONSTRAINT fk_change_audit_request FOREIGN KEY (change_request_id) REFERENCES project_change_requests(id),
  CONSTRAINT fk_change_audit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_change_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_change_audit_submission FOREIGN KEY (material_submission_id) REFERENCES material_submissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_project_change_versions_no_update BEFORE UPDATE ON project_change_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project change versions are immutable'$$

CREATE TRIGGER trg_project_change_versions_no_delete BEFORE DELETE ON project_change_versions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project change versions are immutable'$$

CREATE TRIGGER trg_project_change_audit_no_update BEFORE UPDATE ON project_change_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project change audit events are immutable'$$

CREATE TRIGGER trg_project_change_audit_no_delete BEFORE DELETE ON project_change_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project change audit events are immutable'$$
DELIMITER ;
