SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE projects
  MODIFY COLUMN status ENUM('draft', 'active', 'checking', 'completed', 'archived', 'stopped', 'terminated') NOT NULL DEFAULT 'active';

CREATE TABLE participation_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_id BIGINT UNSIGNED NOT NULL,
  restriction_year SMALLINT NOT NULL,
  trigger_reason ENUM('missing_required_material', 'project_terminated') NOT NULL,
  source_project_id BIGINT UNSIGNED NOT NULL,
  source_material_task_id BIGINT UNSIGNED NULL,
  source_material_task_key BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(source_material_task_id, 0)) STORED,
  status ENUM('active', 'released') NOT NULL DEFAULT 'active',
  triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  triggered_by_user_id BIGINT UNSIGNED NULL,
  trigger_source ENUM('business_event', 'scheduled_scan', 'manual_scan', 'manual_action') NOT NULL,
  released_at DATETIME NULL,
  released_by_user_id BIGINT UNSIGNED NULL,
  release_reason VARCHAR(1000) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_restriction_source_person_year
    (person_id, restriction_year, trigger_reason, source_project_id, source_material_task_key),
  KEY idx_restriction_active_year_person (status, restriction_year, person_id),
  KEY idx_restriction_project_task (source_project_id, source_material_task_id, trigger_reason),
  CONSTRAINT fk_restriction_person FOREIGN KEY (person_id) REFERENCES people(id),
  CONSTRAINT fk_restriction_project FOREIGN KEY (source_project_id) REFERENCES projects(id),
  CONSTRAINT fk_restriction_task FOREIGN KEY (source_material_task_id) REFERENCES material_tasks(id),
  CONSTRAINT fk_restriction_trigger_user FOREIGN KEY (triggered_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_restriction_release_user FOREIGN KEY (released_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_restriction_source CHECK (
    (trigger_reason = 'missing_required_material' AND source_material_task_id IS NOT NULL)
    OR (trigger_reason = 'project_terminated' AND source_material_task_id IS NULL)
  ),
  CONSTRAINT chk_restriction_release CHECK (
    (status = 'active' AND released_at IS NULL AND release_reason IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE participation_restriction_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  restriction_id BIGINT UNSIGNED NOT NULL,
  event_type ENUM('triggered', 'auto_released', 'manual_released', 'manual_restored') NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  actor_source ENUM('system', 'super_admin') NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  event_payload JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_restriction_event_time (restriction_id, created_at),
  CONSTRAINT fk_restriction_event_record FOREIGN KEY (restriction_id) REFERENCES participation_restrictions(id),
  CONSTRAINT fk_restriction_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_restriction_events_no_update BEFORE UPDATE ON participation_restriction_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'participation restriction events are immutable'$$

CREATE TRIGGER trg_restriction_events_no_delete BEFORE DELETE ON participation_restriction_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'participation restriction events are immutable'$$
DELIMITER ;
