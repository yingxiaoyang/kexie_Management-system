# 科研项目材料管理平台后端服务

## 1. 服务位置

后端目录：

```text
D:\kexiexitong\server
```

第一版后端使用：

- Node.js
- Express
- MySQL 8.4
- mysql2
- JWT + HttpOnly Cookie 登录
- multer 本地文件上传

## 2. 本地启动

先确认 Docker Desktop 已启动，并且 MySQL 容器 `kexie-mysql` 处于运行状态。

复制环境变量示例：

```powershell
cd D:\kexiexitong\server
Copy-Item .\.env.example .\.env
```

修改 `server\.env`：

```text
DB_PASSWORD=<读取 D:\kexiexitong\database\.env.mysql 中的 MYSQL_PASSWORD>
JWT_SECRET=<替换成较长随机字符串>
INITIAL_ADMIN_PASSWORD=<替换成管理员初始密码>
```

安装依赖：

```powershell
npm.cmd install
```

初始化业务表和默认管理员：

```powershell
npm.cmd run db:init
```

启动开发服务：

```powershell
npm.cmd run dev
```

默认地址：

```text
http://127.0.0.1:3000
http://127.0.0.1:3000/api/health
```

## 3. 环境变量

```text
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=kexie_db
DB_USER=kexie_user
DB_PASSWORD=<数据库密码>
JWT_SECRET=<登录令牌密钥>
AUTH_COOKIE_NAME=kexie_session
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
TRUST_PROXY=false
REQUEST_BODY_LIMIT=256kb
LOGIN_RATE_LIMIT_WINDOW_MINUTES=15
LOGIN_RATE_LIMIT_MAX=20
ADMIN_LOGIN_RATE_LIMIT_MAX=10
ACCOUNT_LOCK_MINUTES=15
ADMIN_ACCOUNT_LOCK_MINUTES=30
UPLOAD_ROOT=../storage/uploads
MAX_UPLOAD_FILE_MB=50
MAX_TASK_PROJECT_UPLOAD_MB=500
ALLOWED_UPLOAD_EXTENSIONS=pdf,doc,docx,xls,xlsx,ppt,pptx,jpg,jpeg,png,zip
```

## 4. 账号与管理员权限规则

- 角色保留 `admin`、`applicant` 和 `project_owner`，兼容既有登录跳转与 API 角色判断。
- 指导老师只进入人员库和项目参与关系，第一版不登录。
- `admin` 内部区分唯一 `super` 超级管理员和多个 `limited` 小管理员；数据库唯一索引与触发器保护唯一超级管理员。
- 只有超级管理员可以创建、停用、删除、重置小管理员和配置权限；小管理员只能访问获授模块。
- 申请人注册和管理员新建负责人账号都强制使用标准化学号作为 `username`；既有账号不批量改名，仍可按原账号登录。
- 已有 student 人员记录无账号时会安全复用；已有绑定账号时拒绝重复创建。
- `password_reset_required=1` 表示首次登录或重置后必须改密。
- `token_version` 用于让停用、删除、改密、重置和退出前的旧会话立即失效。
- 连续输错密码 5 次后临时锁定；负责人默认 15 分钟，管理员默认 30 分钟，成功登录后清零。
- 登录接口按客户端 IP 限流；默认 15 分钟内普通账号最多 20 次，管理员最多 10 次。
- 负责人忘记密码时，由管理员重置密码。

迁移 `012_admin_permissions_and_student_accounts.sql` 会将既有初始化管理员设为唯一超级管理员；其他既有管理员迁为小管理员并授予现有全部业务模块，以保持升级兼容。初始化命令只执行尚未记录的迁移，不会清空业务表。

## 5. 生产安全配置

- 服务使用 Helmet 安全响应头，并将 JSON 和表单请求体默认限制为 `256kb`。
- 浏览器携带不在 `CORS_ORIGINS` 白名单中的 `Origin` 时，服务返回 `ORIGIN_NOT_ALLOWED`。
- 反向代理部署建议使用 `TRUST_PROXY=loopback`；不要在生产环境设置 `TRUST_PROXY=true`。
- `NODE_ENV=production` 时，JWT 密钥、数据库密码、初始管理员密码仍为示例值或过短，CORS 使用通配符、HTTP、本机地址，或代理信任配置过宽时，服务会拒绝启动。
- 日志只记录方法、路径、状态、错误码、客户端 IP、账号 ID、角色和失败原因等允许字段，不记录密码、Cookie、Authorization 或完整请求体。

真实安全闭环检查：

```powershell
npm.cmd run check:security
```

## 6. 文件上传

本地存储目录默认位于：

```text
D:\kexiexitong\storage\uploads
```

默认限制：

- 单文件最大 50MB。
- 单个项目在一个材料任务下累计上传最大 500MB。
- 允许扩展名：PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX、JPG、JPEG、PNG、ZIP。
- 管理员创建材料任务时可以在默认范围内进一步限制文件类型和大小。

## 7. 已有基础接口

- `GET /api/health`：健康检查。
- `POST /api/auth/login`：登录。
- `GET /api/auth/me`：当前登录用户。
- `POST /api/auth/change-password`：修改密码。
- `POST /api/auth/logout`：退出并使旧会话失效。
- `POST /api/uploads/task-templates`：管理员上传材料任务模板附件。
- `POST /api/uploads/submissions`：负责人上传材料。
- `GET /api/material-tasks/:taskId/templates`：查看任务模板附件。
- `GET /api/material-tasks/:taskId/templates/:attachmentId/download`：下载任务模板附件。
- `GET /api/import-templates/:type/download`：下载导入模板。

更完整的接口约定见：

```text
D:\kexiexitong\docs\接口契约\后端接口契约初稿.md
```
