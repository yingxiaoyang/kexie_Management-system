SET NAMES utf8mb4;
SET time_zone = '+08:00';

ALTER TABLE users
  ADD COLUMN admin_level ENUM('super', 'limited') NULL AFTER role,
  ADD COLUMN active_super_admin_slot TINYINT
    GENERATED ALWAYS AS (
      CASE
        WHEN role = 'admin' AND admin_level = 'super' AND deleted_at IS NULL THEN 1
        ELSE NULL
      END
    ) STORED;

-- Preserve old administrator accounts: the initialized admin (normally username=admin)
-- becomes the sole super administrator and any other legacy administrators retain all
-- current business-module permissions as limited administrators.
UPDATE users
SET admin_level = CASE WHEN role = 'admin' THEN 'limited' ELSE NULL END;

UPDATE users
SET admin_level = 'super'
WHERE role = 'admin' AND deleted_at IS NULL
ORDER BY (username = 'admin') DESC, id ASC
LIMIT 1;

ALTER TABLE users
  ADD UNIQUE KEY uk_users_single_super_admin (active_super_admin_slot),
  ADD CONSTRAINT chk_users_admin_level CHECK (
    (role = 'admin' AND admin_level IS NOT NULL)
    OR (role <> 'admin' AND admin_level IS NULL)
  );

CREATE TABLE admin_permission_definitions (
  permission_key VARCHAR(80) NOT NULL,
  permission_name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admin_user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(80) NOT NULL,
  granted_by BIGINT UNSIGNED NOT NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_key),
  KEY idx_admin_permissions_key_user (permission_key, user_id),
  CONSTRAINT fk_admin_user_permission_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_admin_user_permission_definition FOREIGN KEY (permission_key) REFERENCES admin_permission_definitions(permission_key),
  CONSTRAINT fk_admin_user_permission_granter FOREIGN KEY (granted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE admin_permission_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NOT NULL,
  action ENUM('admin_created', 'permissions_changed', 'status_changed', 'password_reset', 'admin_deleted') NOT NULL,
  before_permissions JSON NOT NULL,
  after_permissions JSON NOT NULL,
  event_payload JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_permission_audit_target_time (target_user_id, created_at),
  KEY idx_admin_permission_audit_actor_time (actor_user_id, created_at),
  CONSTRAINT fk_admin_permission_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_admin_permission_audit_target FOREIGN KEY (target_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO admin_permission_definitions (permission_key, permission_name, description, sort_order)
VALUES
  ('project_management', '项目管理', '查看和维护项目及项目参与关系', 10),
  ('people_management', '人员管理', '查看和维护学生、教师人员库', 20),
  ('data_import', '数据导入', '校验、提交、回退和下载导入批次', 30),
  ('material_task', '材料任务', '创建、维护和发布材料收集任务', 40),
  ('material_review', '材料审核', '查看与审核项目材料；预留给后续审核分发', 50),
  ('application_management', '立项申请', '管理申请批次、校内审核、报送与学校结果', 60),
  ('archive_management', '归档管理', '配置归档模板并生成、下载整理包', 70),
  ('report_management', '报表管理', '设计、生成和下载数据报表', 80),
  ('participation_rules', '参与规则', '配置项目负责人、成员和指导教师参与规则', 90)
ON DUPLICATE KEY UPDATE
  permission_name = VALUES(permission_name),
  description = VALUES(description),
  sort_order = VALUES(sort_order);

INSERT INTO admin_user_permissions (user_id, permission_key, granted_by)
SELECT limited_admin.id, definition.permission_key, super_admin.id
FROM users limited_admin
JOIN users super_admin
  ON super_admin.role = 'admin'
 AND super_admin.admin_level = 'super'
 AND super_admin.deleted_at IS NULL
CROSS JOIN admin_permission_definitions definition
WHERE limited_admin.role = 'admin'
  AND limited_admin.admin_level = 'limited'
  AND limited_admin.deleted_at IS NULL;

DELIMITER $$
CREATE TRIGGER trg_users_preserve_super_admin BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.role = 'admin' AND OLD.admin_level = 'super' AND OLD.deleted_at IS NULL
     AND (NEW.role <> 'admin' OR NEW.admin_level <> 'super' OR NEW.deleted_at IS NOT NULL OR NEW.status <> 'enabled') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'the sole super administrator cannot be disabled, deleted, or demoted';
  END IF;
END$$

CREATE TRIGGER trg_users_no_delete_super_admin BEFORE DELETE ON users
FOR EACH ROW
BEGIN
  IF OLD.role = 'admin' AND OLD.admin_level = 'super' AND OLD.deleted_at IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'the sole super administrator cannot be deleted';
  END IF;
END$$

CREATE TRIGGER trg_admin_user_permissions_validate_insert BEFORE INSERT ON admin_user_permissions
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND role = 'admin' AND admin_level = 'limited' AND deleted_at IS NULL
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permissions may only be assigned to limited administrators';
  END IF;
END$$

CREATE TRIGGER trg_admin_user_permissions_validate_update BEFORE UPDATE ON admin_user_permissions
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND role = 'admin' AND admin_level = 'limited' AND deleted_at IS NULL
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permissions may only be assigned to limited administrators';
  END IF;
END$$

CREATE TRIGGER trg_admin_permission_audit_no_update BEFORE UPDATE ON admin_permission_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'administrator permission audit events are immutable'$$

CREATE TRIGGER trg_admin_permission_audit_no_delete BEFORE DELETE ON admin_permission_audit_events
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'administrator permission audit events are immutable'$$
DELIMITER ;
