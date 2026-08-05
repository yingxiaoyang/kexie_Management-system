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
- JWT 登录
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
CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173
UPLOAD_ROOT=../storage/uploads
MAX_UPLOAD_FILE_MB=50
MAX_TASK_PROJECT_UPLOAD_MB=500
ALLOWED_UPLOAD_EXTENSIONS=pdf,doc,docx,xls,xlsx,ppt,pptx,jpg,jpeg,png,zip
```

## 4. 第一版账号规则

- 只保留 `admin` 管理员和 `project_owner` 项目负责人。
- 指导老师只进入人员库和项目参与关系，第一版不登录。
- 管理员账号可以有多个，第一版管理员权限一致。
- 项目负责人账号由管理员创建，并生成初始密码。
- `password_reset_required=1` 表示首次登录或重置后必须改密。
- 负责人忘记密码时，由管理员重置密码。

## 5. 文件上传

本地存储目录默认位于：

```text
D:\kexiexitong\storage\uploads
```

默认限制：

- 单文件最大 50MB。
- 单个项目在一个材料任务下累计上传最大 500MB。
- 允许扩展名：PDF、DOC、DOCX、XLS、XLSX、PPT、PPTX、JPG、JPEG、PNG、ZIP。
- 管理员创建材料任务时可以在默认范围内进一步限制文件类型和大小。

## 6. 已有基础接口

- `GET /api/health`：健康检查。
- `POST /api/auth/login`：登录。
- `GET /api/auth/me`：当前登录用户。
- `POST /api/auth/change-password`：修改密码。
- `POST /api/uploads/task-templates`：管理员上传材料任务模板附件。
- `POST /api/uploads/submissions`：负责人上传材料。
- `GET /api/material-tasks/:taskId/templates`：查看任务模板附件。
- `GET /api/material-tasks/:taskId/templates/:attachmentId/download`：下载任务模板附件。
- `GET /api/import-templates/:type/download`：下载导入模板。

更完整的接口约定见：

```text
D:\kexiexitong\docs\接口契约\后端接口契约初稿.md
```
