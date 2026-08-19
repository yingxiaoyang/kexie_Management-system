SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE material_submissions
  ADD COLUMN assigned_to BIGINT UNSIGNED NULL AFTER submitted_at,
  ADD COLUMN assigned_by BIGINT UNSIGNED NULL AFTER assigned_to,
  ADD COLUMN assigned_at DATETIME NULL AFTER assigned_by,
  ADD COLUMN assignment_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER assigned_at,
  ADD KEY idx_submission_assignee_status (assigned_to, review_status, submitted_at),
  ADD CONSTRAINT fk_submission_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id),
  ADD CONSTRAINT fk_submission_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id);

CREATE TABLE material_review_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('assigned', 'reassigned', 'reviewed', 'returned') NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  from_assignee_user_id BIGINT UNSIGNED NULL,
  to_assignee_user_id BIGINT UNSIGNED NULL,
  assignment_version INT UNSIGNED NOT NULL,
  review_result ENUM('approved', 'returned') NULL,
  reason VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_material_review_audit_submission_time (submission_id, created_at),
  KEY idx_material_review_audit_project_time (project_id, created_at),
  KEY idx_material_review_audit_actor_time (actor_user_id, created_at),
  CONSTRAINT fk_material_review_audit_submission FOREIGN KEY (submission_id) REFERENCES material_submissions(id),
  CONSTRAINT fk_material_review_audit_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_material_review_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_material_review_audit_from_assignee FOREIGN KEY (from_assignee_user_id) REFERENCES users(id),
  CONSTRAINT fk_material_review_audit_to_assignee FOREIGN KEY (to_assignee_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_material_review_audit_no_update BEFORE UPDATE ON material_review_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'material review audit events are immutable'$$

CREATE TRIGGER trg_material_review_audit_no_delete BEFORE DELETE ON material_review_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'material review audit events are immutable'$$
DELIMITER ;
