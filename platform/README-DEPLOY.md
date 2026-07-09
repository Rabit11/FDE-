# 科研项目信息化管理平台 — 部署指南

基于 **需求 V18** 与会话记忆包搭建的可部署系统，目标服务器：**10.90.111.114**

## 系统架构

```
浏览器 → 10.90.111.114:8084 → Nginx(:80) → 前端静态资源 (Vue3)
                    → /api → 后端 (Node.js + Express)
                                    ↓
                              PostgreSQL
```

## 功能覆盖（一期 MVP）

| 模块 | 说明 |
|------|------|
| 多角色登录 | 6 种身份：总部/领导/单位/主管/负责人/成员 |
| 项目台账 | 14 个示例项目，按角色数据范围过滤，支持导出 |
| 角色工作台 | 各角色差异化首页与菜单 |
| 项目档案 | 全生命周期详情、里程碑、经费、协作评价、留痕 |
| 四色预警 | 红/黄/蓝/绿风险看板 |
| 成果转化 | 转化台账 |
| 协作评价 | 五维度评分、黑名单标记 |
| 待办审批 | 分级审批演示 |
| 立项申报 | 层级→渠道联动、AI 抽取回填 |
| 智能助手 | 台账问答（带依据引用） |

## 需求 V18 关键口径已落实

- 四色状态：红 > 黄 > 蓝 > 绿，30 天临期
- 协作评价：验收后 30 日内
- 后评价：仅超 1 亿项目展示（档案页标注「不适用（未超1亿）」）
- 经费：两套体系独立，看板/档案标注「汇总观察口径」
- 13 个立项渠道字典已入库

## 前置条件（服务器 10.90.111.114）

- Docker 20+ 与 Docker Compose v2
- 开放 8084 端口
- SSH 访问权限（**用户名 + 密码或私钥**，见下方排错）

## SSH 登录失败排错

若出现 `Permission denied (publickey,password)`：

1. **不要默认用 root** — 很多内网机禁用了 root 密码登录，需向运维确认实际账号（常见：`deploy`、`ubuntu`、`admin` 或你的个人账号如 `yanghuiran`）。
2. **优先用密钥登录**（若运维发过 `.pem` / `id_ed25519`）：
   ```bash
   ssh -i ~/.ssh/你的私钥 用户名@10.90.111.114
   ```
3. **确认密码** — 三次 `Permission denied` 表示密码错误，不是指纹提示的问题；`yes` 接受主机指纹是正确的。
4. **有账号但无 root** — 可部署到用户目录，无需 root：
   ```bash
   export REMOTE_DIR=~/keyan-platform
   ./deploy.sh 10.90.111.114 你的用户名
   ```
   并在 `docker-compose.yml` 里把 nginx 的 `ports` 改成 `"8080:80"`，访问 `http://10.90.111.114:8080`（需运维放行 8080 或加入 docker 组）。
5. **加入 docker 组**（非 root 用户必做，只需运维执行一次）：
   ```bash
   sudo usermod -aG docker $USER
   # 重新登录 SSH 后生效
   ```

## 快速部署

### 方式一：一键脚本（Linux/macOS 或 Git Bash）

```bash
cd platform/deploy
chmod +x deploy.sh
./deploy.sh 10.90.111.114 root
```

### 方式二：手动部署

```bash
# 1. 将 platform 目录上传到服务器
scp -r platform root@10.90.111.114:/opt/keyan-platform

# 2. SSH 登录服务器
ssh root@10.90.111.114
cd /opt/keyan-platform

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，修改 DB_PASSWORD 和 JWT_SECRET

# 4. 启动
docker compose up -d --build

# 5. 查看状态
docker compose ps
docker compose logs -f
```

### 方式三：Windows PowerShell 本机构建后上传

```powershell
cd "d:\BeiyanCenter\预研项目管理平台\platform"
docker compose build
docker compose up -d
# 本地验证 http://localhost 后，再打包上传到服务器
```

## 访问地址

- 平台首页：http://10.90.111.114:8084
- API 健康检查：http://10.90.111.114:8084/api/health

## 演示账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 总部治理 | hq_admin | Keyan@2026 |
| 领导驾驶舱 | leader_li | Keyan@2026 |
| 单位治理 | dept_wang | Keyan@2026 |
| 项目主管 | pm_zhao | Keyan@2026 |
| 项目负责人 | owner_zhou | Keyan@2026 |
| 项目成员 | member_zhang | Keyan@2026 |

## 目录结构

```
platform/
├── docker-compose.yml      # 编排：postgres + backend + frontend + nginx
├── nginx/default.conf      # 反向代理，绑定 10.90.111.114
├── backend/                # API 服务
│   ├── prisma/schema.prisma
│   └── src/
├── frontend/               # Vue3 前端
└── deploy/deploy.sh        # 一键部署脚本
```

## 运维命令

```bash
docker compose logs -f backend    # 查看后端日志
docker compose restart backend    # 重启后端
docker compose down -v            # 停止并清除数据卷（慎用）
```

## 后续扩展建议

1. 对接 Flowable 工作流引擎（13 渠道差异化审批链）
2. 接入私有化大模型（替换 AI 模拟接口）
3. CMOS / 经费系统集成适配层
4. HTTPS 证书（Let's Encrypt 或内网 CA）
5. 将交互 Demo HTML 的列筛选、关系穿透等高级交互逐步迁移到 Vue 组件
