# Git 分支使用规则

本项目现在先用简单规则。

## 1. 分支是什么

分支可以理解成：

```text
从项目主线复制出来的一条工作路线
```

你可以在分支上改东西，确认没问题后，再合并回主线。

这样做的好处是：

- 不同任务不会互相影响。
- 出问题时更容易找原因。
- 多个人可以同时做不同任务。

## 2. main 分支

`main` 是项目主分支。

它代表：

```text
当前项目比较稳定、可以保留的版本
```

规则：

- 小改动、文档改动，可以先直接提交到 `main`。
- 大功能、多人协作任务，建议新建任务分支。
- 任务分支确认完成后，再合并回 `main`。

## 3. 当前建议分支

项目推进计划建议这些分支：

```text
setup/docker-mysql
setup/github-guide
setup/frontend-existing-cleanup
feature/backend-data-model
feature/submission-review
feature/archive-export
feature/portal-admin-ui
```

当前 GitHub 教程相关内容可以放在：

```text
setup/github-guide
```

## 4. 分支名字怎么理解

### setup/

表示环境、配置、教程类任务。

例如：

```text
setup/github-guide
setup/docker-mysql
```

### feature/

表示具体功能开发。

例如：

```text
feature/backend-data-model
feature/submission-review
```

### fix/

表示修复问题。

例如：

```text
fix/upload-error
```

## 5. GitHub Desktop 里怎么用分支

### 创建分支

点击顶部菜单：

```text
Branch -> New Branch
```

输入分支名，例如：

```text
setup/frontend-existing-cleanup
```

### 切换分支

点击顶部的当前分支名称。

比如现在显示：

```text
Current branch main
```

点它以后可以选择其他分支。

### 发布分支

如果看到：

```text
Publish branch
```

说明这个分支还没有上传到 GitHub。

点击后，这个分支就会出现在 GitHub 上。

## 6. 什么时候必须建新分支

建议这些情况建新分支：

- 开始做一个新功能。
- 修改很多文件。
- 不确定改动会不会成功。
- 多个对话或多个人同时推进项目。

这些情况可以先不建新分支：

- 改一小段文档。
- 补充教程。
- 修改一个很小的说明。

## 7. 推荐工作流程

简单版：

```text
建分支
改文件
Commit
Push
确认没问题
合并回 main
```

如果现在只有你一个人操作，可以先记住：

```text
main 是主线
分支是临时工作线
Commit 是本机保存
Push 是上传 GitHub
Pull 是从 GitHub 下载更新
```
