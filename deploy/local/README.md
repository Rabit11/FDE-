# 本地部署

## 路径
- 配置模板：`deploy/local/env.example`
- 启动脚本：`deploy/local/start.ps1`
- 运行数据：`项目根目录/data/platform.json`
- 环境文件：`项目根目录/.env`（勿提交 Git）

## 启动
```powershell
cd C:\Users\81172\Desktop\敏捷管理平台
.\deploy\local\start.ps1
```

## 访问
http://localhost:3456

## 说明
- 与远程共用 `server/`、`public/` 源码
- 本地默认端口 **3456**，与远程 **8084** 互不冲突
