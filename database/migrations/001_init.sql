SET NAMES utf8mb4;
SET time_zone = '+08:00';

CREATE TABLE IF NOT EXISTS people (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  person_type ENUM('student', 'teacher') NOT NULL,
  name VARCHAR(80) NOT NULL,
  student_no VARCHAR(40) NULL,
  teacher_no VARCHAR(40) NULL,
  college VARCHAR(120) NULL,
  unit VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  qq VARCHAR(40) NULL,
  email VARCHAR(120) NULL,
  title VARCHAR(120) NULL,
  account_status ENUM('none', 'enabled', 'disabled') NOT NULL DEFAULT 'none',
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_people_student_no (student_no),
  UNIQUE KEY uk_people_teacher_no (teacher_no),
  KEY idx_people_name (name),
  KEY idx_people_college (college),
  KEY idx_people_unit (unit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'project_owner') NOT NULL,
  status ENUM('enabled', 'disabled', 'locked') NOT NULL DEFAULT 'enabled',
  person_id BIGINT UNSIGNED NULL,
  password_reset_required TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_role (role),
  KEY idx_users_person_id (person_id),
  CONSTRAINT fk_users_person_id FOREIGN KEY (person_id) REFERENCES people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_year SMALLINT NOT NULL,
  project_group VARCHAR(80) NULL,
  project_code VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(120) NULL,
  approval_date DATE NULL,
  approval_type ENUM('first', 'supplement') NOT NULL DEFAULT 'first',
  status ENUM('draft', 'active', 'checking', 'completed', 'archived', 'stopped') NOT NULL DEFAULT 'active',
  remark VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_projects_code (project_code),
  KEY idx_projects_year_group (project_year, project_group),
  KEY idx_projects_status (status),
  KEY idx_projects_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_participations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  person_id BIGINT UNSIGNED NOT NULL,
  role ENUM('owner', 'member', 'advisor') NOT NULL,
  is_primary_owner TINYINT(1) NOT NULL DEFAULT 0,
  joined_at DATE NULL,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_project_person_role (project_id, person_id, role),
  KEY idx_participations_person_role (person_id, role),
  KEY idx_participations_project_role (project_id, role),
  CONSTRAINT fk_participations_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_participations_person FOREIGN KEY (person_id) REFERENCES people(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS participation_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_key VARCHAR(80) NOT NULL,
  rule_name VARCHAR(120) NOT NULL,
  limit_count INT NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_participation_rules_key (rule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_check_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  check_phase ENUM('midterm', 'stage') NOT NULL,
  research_log_count INT NOT NULL DEFAULT 0,
  rating VARCHAR(80) NULL,
  checked_at DATE NULL,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_check_project_phase (project_id, check_phase),
  KEY idx_check_phase_rating (check_phase, rating),
  CONSTRAINT fk_check_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reimbursement_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  budget_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  midterm_claim_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  midterm_actual_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stage_claim_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stage_actual_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  remaining_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reimbursement_project (project_id),
  CONSTRAINT fk_reimbursement_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_name VARCHAR(160) NOT NULL,
  task_description VARCHAR(1000) NULL,
  project_scope_type ENUM('all', 'year', 'group', 'custom') NOT NULL DEFAULT 'all',
  project_year SMALLINT NULL,
  project_group VARCHAR(80) NULL,
  deadline_at DATETIME NULL,
  allowed_extensions JSON NULL,
  max_file_mb INT NOT NULL DEFAULT 50,
  max_task_project_mb INT NOT NULL DEFAULT 500,
  has_template TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_material_tasks_status_deadline (status, deadline_at),
  KEY idx_material_tasks_scope (project_scope_type, project_year, project_group),
  CONSTRAINT fk_material_tasks_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_task_projects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_task_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_project (material_task_id, project_id),
  CONSTRAINT fk_task_projects_task FOREIGN KEY (material_task_id) REFERENCES material_tasks(id),
  CONSTRAINT fk_task_projects_project FOREIGN KEY (project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_task_id BIGINT UNSIGNED NOT NULL,
  category_name VARCHAR(120) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_category_name (material_task_id, category_name),
  CONSTRAINT fk_categories_task FOREIGN KEY (material_task_id) REFERENCES material_tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_template_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_task_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(120) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_task_template_task (material_task_id),
  CONSTRAINT fk_template_task FOREIGN KEY (material_task_id) REFERENCES material_tasks(id),
  CONSTRAINT fk_template_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_submissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  material_task_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  material_category_id BIGINT UNSIGNED NOT NULL,
  submitter_user_id BIGINT UNSIGNED NOT NULL,
  submission_status ENUM('not_submitted', 'submitted', 'returned', 'overdue') NOT NULL DEFAULT 'submitted',
  review_status ENUM('pending', 'approved', 'returned') NOT NULL DEFAULT 'pending',
  return_reason VARCHAR(1000) NULL,
  submitted_at DATETIME NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_submission_task_project (material_task_id, project_id),
  KEY idx_submission_review_status (review_status),
  CONSTRAINT fk_submission_task FOREIGN KEY (material_task_id) REFERENCES material_tasks(id),
  CONSTRAINT fk_submission_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_submission_category FOREIGN KEY (material_category_id) REFERENCES material_categories(id),
  CONSTRAINT fk_submission_submitter FOREIGN KEY (submitter_user_id) REFERENCES users(id),
  CONSTRAINT fk_submission_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS material_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(120) NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_material_files_submission (submission_id),
  CONSTRAINT fk_material_files_submission FOREIGN KEY (submission_id) REFERENCES material_submissions(id),
  CONSTRAINT fk_material_files_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS archive_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_name VARCHAR(160) NOT NULL,
  template_config JSON NOT NULL,
  status ENUM('enabled', 'disabled') NOT NULL DEFAULT 'enabled',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_archive_templates_status (status),
  CONSTRAINT fk_archive_templates_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS archive_export_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  export_user_id BIGINT UNSIGNED NOT NULL,
  archive_template_id BIGINT UNSIGNED NOT NULL,
  export_scope JSON NOT NULL,
  export_file_path VARCHAR(500) NULL,
  export_status ENUM('processing', 'success', 'failed') NOT NULL DEFAULT 'processing',
  remark VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_archive_exports_user_time (export_user_id, created_at),
  CONSTRAINT fk_archive_exports_user FOREIGN KEY (export_user_id) REFERENCES users(id),
  CONSTRAINT fk_archive_exports_template FOREIGN KEY (archive_template_id) REFERENCES archive_templates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO participation_rules (rule_key, rule_name, limit_count, enabled, remark)
VALUES
  ('max_owner_projects_per_person', '每人最多负责项目数', 1, 1, '第一版默认规则'),
  ('max_member_projects_per_person', '每人最多参与成员项目数', 2, 1, '第一版默认规则')
ON DUPLICATE KEY UPDATE
  rule_name = VALUES(rule_name),
  limit_count = VALUES(limit_count),
  enabled = VALUES(enabled),
  remark = VALUES(remark);
