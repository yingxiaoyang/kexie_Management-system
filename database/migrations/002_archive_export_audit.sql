ALTER TABLE archive_export_records
  ADD COLUMN template_snapshot JSON NULL AFTER export_scope,
  ADD COLUMN export_summary JSON NULL AFTER export_file_path,
  ADD COLUMN failure_reason VARCHAR(1000) NULL AFTER export_status,
  ADD KEY idx_archive_exports_status_time (export_status, created_at);
