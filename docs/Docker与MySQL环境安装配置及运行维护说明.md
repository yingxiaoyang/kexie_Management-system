# Docker 与 MySQL 环境安装配置及运行维护说明

## 1. 文档用途

本文记录科研项目材料管理平台在当前 Windows 电脑上的 Docker Desktop、WSL 2 和 MySQL 环境，包括：

- 当前已验证的版本与安装位置
- 数据库连接参数
- 日常启动、停止和重启方法
- 从 GitHub 克隆项目后的首次初始化方法
- 后端连接时需要使用的环境变量
- 健康检查、日志、备份与常见问题处理

本文只负责运行环境，不包含业务数据表、后端接口或前端功能。

## 2. 当前电脑已验证环境

- WSL 默认版本：`2`
- Docker Engine：`29.6.2`
- Docker Desktop：`4.85.0`
- Docker 后端：WSL 2 / Linux containers
- Docker Desktop 程序：`D:\Docker\DockerDesktop`
- Docker 镜像与虚拟磁盘：`D:\Docker\DockerData`
- MySQL 镜像：`mysql:8.4`
- 实际验证的 MySQL 版本：`8.4.11`
- MySQL 容器：`kexie-mysql`
- MySQL 数据：`D:\kexiexitong\database\mysql-data`
- Compose 配置：`D:\kexiexitong\database\docker-compose.mysql.yml`
- 本地密码文件：`D:\kexiexitong\database\.env.mysql`

最终验证结果：容器状态为 `running`，健康检查为 `healthy`，停止、启动、重启和数据持久化测试均通过。

## 3. GitHub 中保留和排除的内容

应该提交到 GitHub：

- `database\docker-compose.mysql.yml`
- `database\mysql.env.example`
- 本说明文档

不应提交到 GitHub：

- `database\.env.mysql`：包含本机数据库密码
- `database\mysql-data`：本机 MySQL 实际数据文件
- `database\backups`：可能包含真实业务数据的数据库备份

这些本地内容已经由根目录 `.gitignore` 排除。

## 4. 数据库连接信息

- 主机：`127.0.0.1`
- 端口：`3306`
- 数据库：`kexie_db`
- 应用用户：`kexie_user`
- 应用密码：查看 `database\.env.mysql` 中的 `MYSQL_PASSWORD`
- root 密码：查看 `database\.env.mysql` 中的 `MYSQL_ROOT_PASSWORD`
- 字符集：`utf8mb4`
- 排序规则：`utf8mb4_0900_ai_ci`
- 时区：`Asia/Shanghai`

本机运行的 Node 后端使用：

```text
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=kexie_db
DB_USER=kexie_user
DB_PASSWORD=<读取 database\.env.mysql 中的 MYSQL_PASSWORD>
```

连接地址格式：

```text
mysql://kexie_user:<MYSQL_PASSWORD>@127.0.0.1:3306/kexie_db
```

如果以后把 Node 后端也放进与 MySQL 相同的 Docker Compose 网络，容器内不能再使用 `127.0.0.1`，应使用服务名：

```text
DB_HOST=mysql
DB_PORT=3306
```

## 5. 当前电脑日常启动与停止

先启动 Docker Desktop，并等待左下角显示 `Engine running`。

启动或创建 MySQL 容器：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml up -d
```

停止 MySQL但保留容器和数据：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml stop
```

重新启动已停止的 MySQL：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml start
```

直接重启 MySQL：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml restart
```

查看运行状态：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml ps
```

正常状态应包含 `Up` 和 `healthy`。

查看最近 100 行日志：

```powershell
docker compose -f D:\kexiexitong\database\docker-compose.mysql.yml logs --tail 100 mysql
```

进入 MySQL 命令行：

```powershell
docker exec -it kexie-mysql mysql -u kexie_user -p kexie_db
```

出现 `Enter password` 后，输入 `.env.mysql` 中的 `MYSQL_PASSWORD`。输入密码时终端不会显示字符，这是正常现象。

退出 MySQL 命令行：

```sql
exit
```

## 6. 从 GitHub 克隆后的首次初始化

GitHub 中不会包含 `.env.mysql` 和 `mysql-data`，这是正常且必要的安全设计。

在新电脑上完成 Docker Desktop 和 WSL 2 安装后，进入项目数据库目录：

```powershell
Set-Location D:\kexiexitong\database
```

复制环境变量示例：

```powershell
Copy-Item .\mysql.env.example .\.env.mysql
```

打开 `.env.mysql`，把两个占位密码替换为新的强密码：

```text
MYSQL_ROOT_PASSWORD=<新的 root 强密码>
MYSQL_DATABASE=kexie_db
MYSQL_USER=kexie_user
MYSQL_PASSWORD=<新的应用用户强密码>
TZ=Asia/Shanghai
```

然后首次启动：

```powershell
docker compose -f .\docker-compose.mysql.yml up -d
```

首次启动会创建空数据库 `kexie_db` 和用户 `kexie_user`。业务数据表仍需由后端的数据模型或迁移脚本创建。

如果项目放在其他目录，只需要进入那个项目的 `database` 目录执行相对路径命令，不需要沿用 `D:\kexiexitong`。

## 7. 数据安全与备份

不要手动编辑、剪切或删除 `database\mysql-data` 中的文件。不要把该目录复制到 GitHub。

重要数据导入、业务表迁移或大规模修改前，应先创建备份目录：

```powershell
New-Item -ItemType Directory -Force D:\kexiexitong\database\backups
```

备份命令模板如下，其中 `<ROOT_PASSWORD>` 替换为本机 `.env.mysql` 中的 root 密码：

```powershell
docker exec -e MYSQL_PWD=<ROOT_PASSWORD> kexie-mysql sh -c 'mysqldump -uroot kexie_db > /tmp/kexie_db.sql'
docker cp kexie-mysql:/tmp/kexie_db.sql D:\kexiexitong\database\backups\kexie_db.sql
docker exec kexie-mysql rm /tmp/kexie_db.sql
```

恢复备份前必须确认目标数据库和备份文件，避免覆盖有效数据。恢复命令模板：

```powershell
docker cp D:\kexiexitong\database\backups\kexie_db.sql kexie-mysql:/tmp/restore.sql
docker exec -e MYSQL_PWD=<ROOT_PASSWORD> kexie-mysql sh -c 'mysql -uroot kexie_db < /tmp/restore.sql'
docker exec kexie-mysql rm /tmp/restore.sql
```

## 8. 常见问题

### `docker` 无法识别

关闭当前终端并重新打开，然后运行：

```powershell
docker --version
```

如果仍然无法识别，确认 Docker Desktop 已启动，必要时重启 Windows。

### 无法连接 Docker Engine

打开 Docker Desktop，等待左下角显示 `Engine running`。Docker Desktop 没有启动时，MySQL 容器也无法启动。

### 端口 `3306` 被占用

运行：

```powershell
netstat -ano | findstr :3306
```

不要直接结束不明进程。先确认是否安装了另一套 MySQL，再决定关闭旧服务或修改 Compose 文件中端口映射左侧的主机端口。

### MySQL 容器启动失败或显示 unhealthy

运行：

```powershell
docker logs --tail 100 kexie-mysql
```

常见原因包括端口冲突、Docker Engine 尚未完成启动、`.env.mysql` 缺失或数据目录不可访问。

### 修改 `.env.mysql` 后密码没有变化

MySQL 镜像中的初始化变量只在空数据目录首次启动时生效。已有数据库不能通过直接修改 `.env.mysql` 改密码，应登录 MySQL 后使用 SQL 修改。

不要为了让新密码生效而随意删除 `mysql-data`，这会删除项目数据库。确需重建前必须先备份并再次确认。

### Docker Desktop 关闭后 MySQL 停止

这是正常现象。容器依赖 Docker Engine。再次启动 Docker Desktop 后，`restart: unless-stopped` 会让 MySQL 自动恢复；也可以手动执行启动命令。

### Windows 重启后是否需要手动启动

Docker Desktop 启动后，MySQL 通常会根据 `restart: unless-stopped` 自动恢复。如果 Docker Desktop 没有随 Windows 自动启动，应先手动启动 Docker Desktop。

## 9. 本任务边界

Docker 与 MySQL 环境已经完成。当前数据库是可连接的空业务数据库，尚未创建项目、人员、材料、审核等业务表。

后续由后端与数据库模型任务负责：

- 选择后端数据库驱动或 ORM
- 创建数据库迁移
- 创建业务数据表和索引
- 配置后端环境变量
- 实现数据库备份策略和正式部署方案
