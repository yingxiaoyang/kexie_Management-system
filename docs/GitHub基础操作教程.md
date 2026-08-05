# GitHub 基础操作教程

本教程只讲当前项目最常用的 GitHub 操作。

项目文件夹：

`D:\kexiexitong`

GitHub 仓库地址：

`https://github.com/yingxiaoyang/kexie_Management-system.git`

## 1. 先记住一句话

Git 是本机的保存历史。

GitHub 是网上的备份仓库。

GitHub Desktop 是图形界面工具，可以用按钮操作 Git 和 GitHub。

## 2. main 分支是什么意思

`main` 是项目的主分支。

你可以把它理解成：

```text
项目的正式主线版本
```

它的作用是保存大家都认可的、比较稳定的成果。

比如：

- 当前项目基础代码
- 已确认的文档
- 已完成并检查过的功能

平时小任务可以先在其他分支做，确认没问题后再合并到 `main`。

如果现在只有你一个人学习和维护项目，也可以先在 `main` 上提交。等项目变复杂、多人一起做时，再严格使用任务分支。

## 3. 本地仓库和 GitHub 仓库

当前有两个位置：

```text
D:\kexiexitong
```

这是你电脑上的本地仓库。

```text
https://github.com/yingxiaoyang/kexie_Management-system.git
```

这是 GitHub 网站上的远程仓库。

本地仓库负责记录你电脑上的修改。

远程仓库负责把修改同步到 GitHub，方便备份和协作。

## 4. origin 是什么

`origin` 是远程仓库的默认名字。

它不是一个新仓库，只是 Git 给这个 GitHub 地址取的简称。

比如：

```text
origin = https://github.com/yingxiaoyang/kexie_Management-system.git
```

以后看到 `Push origin`，意思就是：

```text
把本地提交推送到这个 GitHub 仓库
```

看到 `Pull origin`，意思就是：

```text
从这个 GitHub 仓库拉取最新内容到本机
```

## 5. GitHub Desktop 应该怎么打开这个项目

当前项目已经在本机存在，所以不要重新 Clone 一份。

在 GitHub Desktop 中选择：

```text
Add an Existing Repository from your local drive...
```

然后选择：

```text
D:\kexiexitong
```

不要优先点：

```text
Clone yingxiaoyang/kexie_Management-system
```

因为 Clone 会重新下载一份项目，容易和现在的 `D:\kexiexitong` 混淆。

## 6. GitHub Desktop 常用按钮

### Changes

这里会显示你改了哪些文件。

如果显示：

```text
0 changed files
```

说明现在没有未保存的修改。

### Summary

这里填写本次提交说明。

比如：

```text
docs: update github guide
```

### Commit to main

把这次修改保存到本机 Git 历史。

注意：Commit 只是保存到本机，还没有上传到 GitHub。

### Push origin

把本机已经提交的内容上传到 GitHub。

### Publish branch

第一次把某个本地分支上传到 GitHub 时，会显示这个按钮。

你现在看到的 `Publish branch`，意思是：

```text
main 分支已经在本机有内容，但还没有发布到 GitHub
```

可以点击它，把 `main` 分支上传到 GitHub。

### Pull origin

把 GitHub 上的新内容拉到本机。

多人协作时，开始改文件前建议先点一次。

## 7. 日常使用顺序

最常用的顺序是：

```text
改文件
看 Changes
写 Summary
点 Commit
点 Push
```

也就是：

1. 先修改项目文件。
2. 回到 GitHub Desktop 看 `Changes`。
3. 在 `Summary` 写一句这次做了什么。
4. 点 `Commit to main`。
5. 点 `Push origin` 或 `Publish branch`。

## 8. 什么时候用命令

如果你主要用 GitHub Desktop，可以先少用命令。

下面这些命令只是帮助你理解按钮背后的意思：

```powershell
git status
```

查看现在改了什么。

```powershell
git add .
git commit -m "提交说明"
```

保存一次本地提交。

```powershell
git push
```

上传到 GitHub。

```powershell
git pull
```

从 GitHub 拉取最新内容。

## 9. 不要提交哪些东西

不要提交这些内容：

- `node_modules`
- `dist`
- `.env`
- 上传文件
- 临时文件
- 密码、密钥、数据库账号

这些已经写进 `.gitignore`，Git 会自动忽略大部分不该提交的文件。
