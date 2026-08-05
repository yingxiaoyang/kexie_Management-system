# Git 分支使用规则

本项目采用“一个任务一个分支”的方式推进。这样可以让 Docker、前端、后端、业务功能、界面优化等任务互不覆盖。

## 1. 主分支

### main

`main` 是稳定主分支。

规则：

- 只放已经确认可保留的成果。
- 不直接在 `main` 上做大改动。
- 每个任务分支完成后，再合并回 `main`。

## 2. 推荐任务分支

项目推进计划中建议使用以下分支：

- `setup/docker-mysql`
- `setup/github-guide`
- `setup/frontend-existing-cleanup`
- `feature/backend-data-model`
- `feature/submission-review`
- `feature/archive-export`
- `feature/portal-admin-ui`

当前对话负责：

- `setup/github-guide`

## 3. 分支命名规则

### 3.1 setup/

用于环境、配置、教程类任务。

示例：

```text
setup/github-guide
setup/docker-mysql
setup/frontend-existing-cleanup
```

### 3.2 feature/

用于具体业务功能。

示例：

```text
feature/backend-data-model
feature/submission-review
feature/archive-export
```

### 3.3 fix/

用于修复问题。

示例：

```text
fix/login-error
fix/upload-validation
```

### 3.4 docs/

用于纯文档调整。

示例：

```text
docs/update-run-guide
```

## 4. 每个分支的工作流程

### 4.1 从 main 创建任务分支

```powershell
git switch main
git pull
git switch -c setup/github-guide
```

### 4.2 在任务分支上修改并提交

```powershell
git status
git add .
git commit -m "docs: add github workflow guide"
```

### 4.3 推送任务分支到 GitHub

```powershell
git push -u origin setup/github-guide
```

### 4.4 合并回 main

任务确认完成后：

```powershell
git switch main
git pull
git merge setup/github-guide
git push
```

## 5. 多对话协作规则

- 每个对话只在自己的分支内工作。
- 不跨范围修改其他对话负责的核心文件。
- 如果必须改公共文件，先写清楚原因和影响。
- 合并前先确认本分支能正常运行或至少文档完整。
- 每次对话完成后，在交接记录里写明改了什么、怎么验证、还缺什么。

## 6. 冲突处理原则

如果 Git 提示冲突：

1. 先不要慌，也不要随便删除文件。
2. 打开冲突文件，找到 Git 标记的冲突位置。
3. 保留正确内容，删除冲突标记。
4. 执行：

```powershell
git add 冲突文件路径
git commit
```

冲突标记通常长这样：

```text
<<<<<<< HEAD
当前分支内容
=======
另一边分支内容
>>>>>>> 分支名
```

## 7. 当前项目建议

- `main`：只放稳定成果。
- `setup/github-guide`：保存 GitHub 教程、忽略规则、交接记录。
- 前端页面结构调整交给 `setup/frontend-existing-cleanup`。
- 后端和数据库模型交给 `feature/backend-data-model`。
- 材料提交审核交给 `feature/submission-review`。
- 归档导出交给 `feature/archive-export`。
