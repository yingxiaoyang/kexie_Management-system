# GitHub 基础操作教程

本教程适用于当前项目目录：

`D:\kexiexitong`

本项目已经有前端代码和项目文档，版本管理的目标是把这些文件安全保存到 Git，并同步到 GitHub，方便后续多人协作、回看历史、按分支推进不同任务。

## 1. 先理解三个概念

### 1.1 Git

Git 是本机的版本记录工具。它会记录每次改了哪些文件、为什么改、是谁改的。

常用场景：

- 保存一个阶段成果
- 回看历史改动
- 对比两次修改
- 建分支做不同任务

### 1.2 GitHub

GitHub 是网上的代码仓库。可以把本机 Git 仓库同步上去，防止只存在本机，同时方便其他人查看和协作。

### 1.3 本地仓库和远程仓库

- 本地仓库：`D:\kexiexitong` 里的 Git 仓库
- 远程仓库：GitHub 网站上的仓库
- `origin`：通常用来表示默认的 GitHub 远程仓库

## 2. 每天常用流程

### 2.1 查看当前状态

```powershell
git status
```

用途：

- 看哪些文件改了
- 看哪些文件还没加入提交
- 看当前在哪个分支

### 2.2 保存本次修改

```powershell
git add .
git commit -m "说明这次做了什么"
```

建议提交说明写清楚，例如：

```powershell
git commit -m "docs: add github workflow guide"
```

常见提交说明前缀：

- `docs:` 文档
- `setup:` 环境或配置
- `feat:` 新功能
- `fix:` 修复问题
- `style:` 页面样式
- `refactor:` 代码整理

### 2.3 查看提交历史

```powershell
git log --oneline --graph --decorate --all
```

用途：

- 看项目保存过哪些阶段成果
- 看当前分支从哪里分出来
- 查找某次提交编号

### 2.4 同步到 GitHub

第一次推送：

```powershell
git push -u origin main
```

之后推送：

```powershell
git push
```

### 2.5 从 GitHub 拉取别人更新

```powershell
git pull
```

建议每天开始改代码前先执行一次，避免基于旧代码继续修改。

## 3. 第一次连接 GitHub

### 3.1 在 GitHub 网站创建远程仓库

1. 打开 GitHub。
2. 点击右上角 `+`。
3. 选择 `New repository`。
4. 仓库名建议使用：`kexiexitong`。
5. 可见性按需要选择 `Private` 或 `Public`。
6. 不要勾选自动创建 README、`.gitignore` 或 License，因为本地项目已经准备好这些内容。
7. 创建仓库。

### 3.2 连接本地仓库和远程仓库

把下面命令里的用户名替换成自己的 GitHub 用户名：

```powershell
git remote add origin https://github.com/你的用户名/kexiexitong.git
git push -u origin main
```

如果已经添加过远程地址，但地址不对，可以修改：

```powershell
git remote set-url origin https://github.com/你的用户名/kexiexitong.git
```

### 3.3 查看远程仓库地址

```powershell
git remote -v
```

如果看到 `origin` 后面跟着 GitHub 地址，说明本地和 GitHub 已经连接。

## 4. 常见问题

### 4.1 为什么不提交 node_modules

`node_modules` 是前端依赖目录，文件很多，也可以通过 `package-lock.json` 重新安装。提交它会让仓库变得巨大，协作时也容易出问题。

以后别人拿到项目后，在前端目录执行：

```powershell
npm.cmd install
```

就可以重新安装依赖。

### 4.2 为什么不提交 dist

`dist` 是构建结果，可以重新生成，不是源代码。通常提交源代码，不提交构建产物。

### 4.3 忘记先 pull 就改代码怎么办

先保存自己的修改：

```powershell
git add .
git commit -m "保存当前修改"
```

再拉取远程更新：

```powershell
git pull
```

如果出现冲突，需要按 Git 提示处理冲突文件，再重新提交。

## 5. 推荐习惯

- 每完成一个小阶段就提交一次。
- 提交说明写清楚，不写 `update`、`test` 这类看不出意义的描述。
- 改代码前先看 `git status`。
- 多人协作时，改代码前先 `git pull`。
- 不把密码、数据库账号、密钥写进 Git。
- 不把 `node_modules`、`dist`、上传文件、临时文件提交到 GitHub。
