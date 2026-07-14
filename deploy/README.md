# 部署目录说明

应用源码（`server/`、`public/`、`package.json`）在**项目根目录**，本地与远程共用同一份代码。

| 目录 | 用途 |
|------|------|
| [`local/`](local/) | 本机开发 / 本地运行（默认端口 **3456**） |
| [`remote/`](remote/) | 远程服务器 **10.90.111.114:8084** 部署（systemd 后台常驻） |

## 快速开始

**本地：**
```powershell
.\deploy\local\start.ps1
```
访问 http://localhost:3456

**远程：**
```powershell
.\deploy\remote\push-deploy.ps1
```
访问 http://10.90.111.114:8084
