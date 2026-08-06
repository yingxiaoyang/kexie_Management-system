ALTER TABLE users
  ADD COLUMN failed_login_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER token_version,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts,
  ADD COLUMN last_failed_login_at DATETIME NULL AFTER locked_until,
  ADD KEY idx_users_locked_until (locked_until);
