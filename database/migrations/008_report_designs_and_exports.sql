SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS report_designs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  design_name VARCHAR(160) NOT NULL,
  design_config JSON NOT NULL,
  status ENUM('enabled', 'disabled') NOT NULL DEFAULT 'enabled',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_report_designs_status (status),
  CONSTRAINT fk_report_designs_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS report_export_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  export_user_id BIGINT UNSIGNED NOT NULL,
  report_design_id BIGINT UNSIGNED NULL,
  export_scope JSON NOT NULL,
  design_snapshot JSON NOT NULL,
  export_layout ENUM('continuous', 'sheets') NOT NULL DEFAULT 'continuous',
  export_file_path VARCHAR(500) NULL,
  export_summary JSON NULL,
  export_status ENUM('queued', 'processing', 'success', 'failed') NOT NULL DEFAULT 'queued',
  attempt_count INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  started_at DATETIME NULL,
  heartbeat_at DATETIME NULL,
  worker_id VARCHAR(120) NULL,
  failure_reason VARCHAR(1000) NULL,
  remark VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  file_cleanup_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_report_exports_status_created (export_status, created_at),
  KEY idx_report_exports_user_time (export_user_id, created_at),
  KEY idx_report_exports_cleanup (export_status, finished_at),
  CONSTRAINT fk_report_exports_user FOREIGN KEY (export_user_id) REFERENCES users(id),
  CONSTRAINT fk_report_exports_design FOREIGN KEY (report_design_id) REFERENCES report_designs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
