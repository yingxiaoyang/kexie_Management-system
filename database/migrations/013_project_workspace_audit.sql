SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE projects
  ADD COLUMN approval_batch VARCHAR(160) NULL AFTER approval_type;

CREATE TABLE project_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  source_module VARCHAR(80) NOT NULL,
  field_changes JSON NOT NULL,
  event_payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_audit_project_time (project_id, created_at),
  KEY idx_project_audit_type_time (event_type, created_at),
  CONSTRAINT fk_project_audit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_project_audit_no_update BEFORE UPDATE ON project_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project audit events are immutable'$$

CREATE TRIGGER trg_project_audit_no_delete BEFORE DELETE ON project_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project audit events are immutable'$$
DELIMITER ;
