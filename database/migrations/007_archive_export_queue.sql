ALTER TABLE archive_export_records
  MODIFY COLUMN export_status ENUM('queued', 'processing', 'success', 'failed') NOT NULL DEFAULT 'queued',
  ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER export_status,
  ADD COLUMN max_attempts INT UNSIGNED NOT NULL DEFAULT 3 AFTER attempt_count,
  ADD COLUMN started_at DATETIME NULL AFTER created_at,
  ADD COLUMN heartbeat_at DATETIME NULL AFTER started_at,
  ADD COLUMN worker_id VARCHAR(120) NULL AFTER heartbeat_at,
  ADD COLUMN zip_cleanup_at DATETIME NULL AFTER finished_at,
  ADD KEY idx_archive_exports_queue (export_status, heartbeat_at, created_at),
  ADD KEY idx_archive_exports_cleanup (export_status, finished_at);
