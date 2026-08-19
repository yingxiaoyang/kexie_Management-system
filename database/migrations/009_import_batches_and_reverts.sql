SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS import_batches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_uuid CHAR(36) NOT NULL,
  import_type ENUM('standard_workbook', 'simple_projects', 'project_field_update', 'project_participations', 'rollback') NOT NULL,
  mode VARCHAR(40) NOT NULL DEFAULT 'upsert',
  status ENUM('validated', 'committed', 'failed', 'rolled_back', 'rollback_partial') NOT NULL DEFAULT 'validated',
  original_file_name VARCHAR(255) NULL,
  original_file_path VARCHAR(500) NULL,
  file_sha256 CHAR(64) NULL,
  file_size BIGINT UNSIGNED NULL,
  summary_json JSON NOT NULL,
  errors_json JSON NULL,
  parent_batch_id BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  committed_by BIGINT UNSIGNED NULL,
  rolled_back_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at DATETIME NULL,
  rolled_back_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_import_batches_uuid (batch_uuid),
  KEY idx_import_batches_type_time (import_type, created_at),
  KEY idx_import_batches_status_time (status, created_at),
  KEY idx_import_batches_parent (parent_batch_id),
  CONSTRAINT fk_import_batches_created_by FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_import_batches_committed_by FOREIGN KEY (committed_by) REFERENCES users(id),
  CONSTRAINT fk_import_batches_rolled_back_by FOREIGN KEY (rolled_back_by) REFERENCES users(id),
  CONSTRAINT fk_import_batches_parent FOREIGN KEY (parent_batch_id) REFERENCES import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS import_batch_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_id BIGINT UNSIGNED NOT NULL,
  entity_type ENUM('project', 'person', 'participation', 'check_record', 'reimbursement', 'rollback') NOT NULL,
  entity_key VARCHAR(255) NOT NULL,
  target_table VARCHAR(80) NOT NULL,
  target_id BIGINT UNSIGNED NULL,
  operation_type ENUM('create', 'update', 'remove', 'skip', 'error', 'restore', 'conflict') NOT NULL,
  excel_row_number INT NULL,
  status ENUM('planned', 'applied', 'skipped', 'failed', 'conflict') NOT NULL DEFAULT 'planned',
  before_snapshot JSON NULL,
  after_snapshot JSON NULL,
  message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_import_records_batch (batch_id),
  KEY idx_import_records_entity (entity_type, entity_key),
  KEY idx_import_records_target (target_table, target_id),
  CONSTRAINT fk_import_records_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS import_batch_field_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  record_id BIGINT UNSIGNED NOT NULL,
  field_name VARCHAR(80) NOT NULL,
  before_value TEXT NULL,
  after_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_import_field_changes_record (record_id),
  CONSTRAINT fk_import_field_changes_record FOREIGN KEY (record_id) REFERENCES import_batch_records(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
