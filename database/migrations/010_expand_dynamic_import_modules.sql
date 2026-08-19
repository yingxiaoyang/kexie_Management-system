SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE import_batches
  MODIFY COLUMN import_type ENUM(
    'standard_workbook',
    'simple_projects',
    'project_field_update',
    'people_update',
    'project_participations',
    'check_record_update',
    'reimbursement_update',
    'rollback'
  ) NOT NULL;
