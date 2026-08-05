# 科研项目材料管理平台前端

本目录是已有 Vue 3 + Vite + Element Plus 前端项目，当前已完成负责人端和管理员端的基础页面结构整理。

## 启动

```bash
npm.cmd install
npm.cmd run dev
```

默认访问：

- 入口页：`http://127.0.0.1:5173/`
- 项目负责人端：`http://127.0.0.1:5173/owner/dashboard`
- 管理员端：`http://127.0.0.1:5173/admin/dashboard`

## 构建检查

```bash
npm.cmd run build
```

## 接口地址

前端通过 `VITE_API_BASE_URL` 读取后端接口地址。

本机开发默认值：

```bash
VITE_API_BASE_URL=http://127.0.0.1:3000/api
```

可参考 `.env.example`。真实账号、密码、密钥不要写入前端仓库。
