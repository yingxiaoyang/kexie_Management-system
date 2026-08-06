ALTER TABLE material_categories
  ADD COLUMN allowed_extensions JSON NULL AFTER task_description,
  ADD COLUMN max_file_mb INT NULL AFTER allowed_extensions,
  ADD COLUMN has_template TINYINT(1) NOT NULL DEFAULT 0 AFTER max_file_mb;

ALTER TABLE task_template_attachments
  ADD COLUMN material_category_id BIGINT UNSIGNED NULL AFTER material_task_id,
  ADD KEY idx_task_template_category (material_category_id),
  ADD CONSTRAINT fk_template_category FOREIGN KEY (material_category_id) REFERENCES material_categories(id);

UPDATE material_categories mc
JOIN material_tasks mt ON mt.id = mc.material_task_id
SET mc.allowed_extensions = mt.allowed_extensions,
    mc.max_file_mb = mt.max_file_mb,
    mc.has_template = mt.has_template;
