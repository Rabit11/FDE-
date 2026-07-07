# Cursor Skills 收藏清单（前端 / 后端 / 数据库）

> 整理日期：2026-07-07  
> 用途：为「科研项目信息化管理平台」（Vue3 + Express + PostgreSQL）选型与安装 Cursor Agent Skills  
> 安装位置：项目内 `.cursor/skills/` 或全局 `~/.cursor/skills/`

---

## 一、如何安装（三种方式）

### 方式 1：Cursor 设置导入（推荐，Cursor 2.4+）

1. `Cmd/Ctrl + Shift + J` → **Rules** 标签  
2. **Add Rule** → **Remote Rule (GitHub)**  
3. 填入仓库 URL，勾选需要的 skill  

示例仓库：`https://github.com/aussiegingersnap/cursor-skills`

### 方式 2：手动复制

```bash
git clone https://github.com/aussiegingersnap/cursor-skills /tmp/cursor-skills
cp -r /tmp/cursor-skills/skills/db-postgres .cursor/skills/
```

### 方式 3：CLI（Vercel skills 工具）

```bash
npx skills add vercel-labs/agent-skills
```

---

## 二、综合索引仓库（先收藏这些「库」）

| 仓库 | Stars 量级 | 说明 | URL |
|------|-----------|------|-----|
| **awesome-cursor-skills** | ~500+ | 最全 Cursor Skills 合集，含前后端/测试/DevOps | https://github.com/spencerpauly/awesome-cursor-skills |
| **aussiegingersnap/cursor-skills** | 精选 | UI/DB/API/Auth 分类清晰，支持 Cursor 远程导入 | https://github.com/aussiegingersnap/cursor-skills |
| **anthropics/skills** | 官方 | Anthropic 官方 skills（frontend-design、webapp-testing 等） | https://github.com/anthropics/skills |
| **vercel-labs/agent-skills** | 官方 | React/Next.js 最佳实践、Web 设计规范 | https://github.com/vercel-labs/agent-skills |
| **PatrickJS/awesome-cursorrules** | 40k+ | `.mdc` 规则（非 SKILL.md），按框架分类 | https://github.com/PatrickJS/awesome-cursorrules |
| **sanjeed5/awesome-cursor-rules-mdc** | 精选 | 现代 `.mdc` 规则 + 生成工具 | https://github.com/sanjeed5/awesome-cursor-rules-mdc |
| **DIBmaster/cursor-skills** | 商业向 | CMO/SEO/UX 评审类 skills | https://github.com/DIBmaster/cursor-skills |
| **yu-iskw/coding-agent-skills** | 规范 | SKILL.md 编写最佳实践 | https://github.com/yu-iskw/coding-agent-skills |
| **sbstjn/skills** | 工程化 | skills + rules + agents 分层（Codeberg） | https://codeberg.org/sbstjn/skills |
| **getsentry/skills** | Sentry | 代码审查、安全审查、Django 性能 | https://github.com/getsentry/skills |

### 在线目录（书签）

| 名称 | URL |
|------|-----|
| Cursor Skills 官方文档 | https://docs.cursor.com/agent/skills |
| Agent Skills 开放标准 | https://agentskills.io |
| skills.sh 排行榜 | https://skills.sh |
| AgentDepot 资源探索 | https://agentdepot.dev |
| Cursor Directory | https://cursor.directory |
| GitHub Topic: cursor-skills | https://github.com/topics/cursor-skills |

---

## 三、前端开发 Skills 清单

### 3.1 Vue / 通用 UI（与本项目最相关）

| Skill ID | 来源仓库 | 说明 | 路径/链接 |
|----------|----------|------|-----------|
| `using-ui-stack` | awesome-cursor-skills | 设计系统：8px 网格、色板、暗色模式 | `resources/using-ui-stack/SKILL.md` |
| `anthropic-frontend-design` | anthropics/skills | 生产级前端 UI、响应式布局 | `skills/frontend-design` |
| `shadcn-ui` | shadcn 官方 | 组件添加、样式、组合 | https://ui.shadcn.com/docs/skills |
| `converting-css-to-tailwind` | awesome-cursor-skills | CSS → Tailwind 迁移 | `resources/converting-css-to-tailwind/` |
| `ui-design-system` | aussiegingersnap | Linear/Notion 风格 UI 模式 | `skills/ui-design-system/` |
| `ui-principles` | aussiegingersnap | 极简 UI 原则 | `skills/ui-principles/` |
| `vercel-web-design-guidelines` | vercel-labs | 无障碍、UX、性能审计 | `skills/web-design-guidelines` |
| `accessibility-auditing` | awesome-cursor-skills | ARIA、对比度、键盘导航 | `resources/accessibility-auditing/` |
| `responsive-testing` | awesome-cursor-skills | 多视口截图回归 | `resources/responsive-testing/` |
| `dark-mode-testing` | awesome-cursor-skills | 明暗主题切换测试 | `resources/dark-mode-testing/` |
| `visual-qa-testing` | awesome-cursor-skills | Cursor 内置浏览器截图 QA | `resources/visual-qa-testing/` |
| `tools-artifacts` | aussiegingersnap | React + shadcn 构建 HTML 产物 | `skills/tools-artifacts/` |

### 3.2 React / Next.js（参考用，非本项目栈）

| Skill ID | 来源 | 说明 |
|----------|------|------|
| `vercel-react-best-practices` | vercel-labs/agent-skills | 40+ React/Next 性能规则 |
| `vercel-composition-patterns` | vercel-labs/agent-skills | 组件组合、RSC 边界 |
| `vercel-react-view-transitions` | vercel-labs/agent-skills | View Transitions API |
| `nextjs-16` | aussiegingersnap | Next.js 16 App Router |
| `state-tanstack` | aussiegingersnap | TanStack Query + Zustand |
| `react-native-patterns` | awesome-cursor-skills | React Native / Expo |

### 3.3 前端相关 Cursor Rules（.mdc，非 Skill）

PatrickJS/awesome-cursorrules 中可搜：

- `vue` / `vue3` / `nuxt`
- `typescript`
- `tailwind`
- `frontend`

仓库：https://github.com/PatrickJS/awesome-cursorrules/tree/main/rules

---

## 四、后端开发 Skills 清单

### 4.1 API / 服务层

| Skill ID | 来源仓库 | 说明 | 路径 |
|----------|----------|------|------|
| `api-rest` | aussiegingersnap | REST 约定 + Zod 校验 | `skills/api-rest/` |
| `adding-api-docs` | awesome-cursor-skills | OpenAPI/Swagger 文档 | `resources/adding-api-docs/` |
| `api-smoke-testing` | awesome-cursor-skills | 自动发现路由并冒烟测试 | `resources/api-smoke-testing/` |
| `anthropic-mcp-builder` | anthropics/skills | 构建 MCP Server | `skills/mcp-builder` |
| `feature-build` | aussiegingersnap | 完整功能开发生命周期 | `skills/feature-build/` |

### 4.2 认证 / 安全

| Skill ID | 来源 | 说明 |
|----------|------|------|
| `auth-better-auth` | aussiegingersnap | Better Auth 集成 |
| `auth-lucia` | aussiegingersnap | Lucia 认证模式 |
| `adding-auth` | awesome-cursor-skills | Auth.js OAuth + 会话 |
| `auditing-security` | awesome-cursor-skills | OWASP Top 10 审计 |
| `sentry-security-review` | getsentry/skills | 注入/XSS/越权审查 |

### 4.3 基础设施 / 部署（与本项目 Docker 相关）

| Skill ID | 来源 | 说明 |
|----------|------|------|
| `adding-docker` | awesome-cursor-skills | Dockerfile + compose |
| `infra-docker` | aussiegingersnap | 本地 Docker 开发 |
| `infra-railway` | aussiegingersnap | Railway 部署 |
| `infra-env` | aussiegingersnap | 环境变量模式 |
| `setting-up-ci` | awesome-cursor-skills | GitHub Actions CI/CD |
| `kubernetes-deploying` | awesome-cursor-skills | K8s 部署 |

### 4.4 后端相关 Cursor Rules（.mdc）

PatrickJS/awesome-cursorrules 中可搜：

- `node` / `express` / `nestjs`
- `python` / `fastapi`
- `go` / `rust`
- `graphql` / `rest-api`

---

## 五、数据库 Skills 清单（收藏）

| Skill ID | 来源 | 数据库/ORM | 说明 |
|----------|------|------------|------|
| **`db-postgres`** | aussiegingersnap | PostgreSQL + Drizzle | ⭐ 与本项目 PostgreSQL 最接近 |
| **`db-sqlite`** | aussiegingersnap | SQLite + Prisma | 含 Litestream 备份 |
| **`database-design`** | awesome-cursor-skills | 通用 | Schema 设计、索引、关系、ORM 选型 |
| `cockroachdb-sql-patterns` | Cursor Marketplace | CockroachDB | 分布式 SQL 模式 |
| `cockroachdb-app-patterns` | Cursor Marketplace | CockroachDB | 应用层模式 |

### 本项目技术栈推荐组合

```
本项目：Vue3 + Express + Prisma + PostgreSQL + Docker

推荐安装：
1. db-postgres          （或 database-design + 自行适配 Prisma）
2. api-rest
3. adding-docker
4. using-ui-stack / ui-design-system
5. visual-qa-testing
6. reviewing-code
```

---

## 六、测试 / 质量（前后端通用）

| Skill ID | 来源 | 说明 |
|----------|------|------|
| `writing-tests` | awesome-cursor-skills | 单元/集成测试 |
| `adding-e2e-tests` | awesome-cursor-skills | Playwright E2E |
| `anthropic-webapp-testing` | anthropics/skills | 浏览器自动化测试 |
| `python-tdd-with-uv` | awesome-cursor-skills | Python TDD |
| `reviewing-code` | awesome-cursor-skills | 代码审查 |
| `systematic-debugging` | awesome-cursor-skills | 结构化调试 |
| `grinding-until-pass` | awesome-cursor-skills | 循环修到测试通过 |

---

## 七、一键安装命令（复制即用）

### 收藏仓库到本地

```bash
mkdir -p ~/cursor-skills-cache
cd ~/cursor-skills-cache

git clone https://github.com/spencerpauly/awesome-cursor-skills.git
git clone https://github.com/aussiegingersnap/cursor-skills.git
git clone https://github.com/anthropics/skills.git
git clone https://github.com/vercel-labs/agent-skills.git
git clone https://github.com/PatrickJS/awesome-cursorrules.git
```

### 安装到本项目（示例）

```bash
cd "d:/BeiyanCenter/预研项目管理平台"
mkdir -p .cursor/skills

# 数据库 + API + Docker（后端）
cp -r ~/cursor-skills-cache/cursor-skills/skills/db-postgres .cursor/skills/
cp -r ~/cursor-skills-cache/cursor-skills/skills/api-rest .cursor/skills/
cp -r ~/cursor-skills-cache/cursor-skills/skills/infra-docker .cursor/skills/

# UI（前端）
cp -r ~/cursor-skills-cache/cursor-skills/skills/ui-design-system .cursor/skills/
cp -r ~/cursor-skills-cache/awesome-cursor-skills/resources/visual-qa-testing .cursor/skills/

# 通用
cp -r ~/cursor-skills-cache/cursor-skills/skills/feature-build .cursor/skills/
cp -r ~/cursor-skills-cache/awesome-cursor-skills/resources/database-design .cursor/skills/
```

安装后 **重启 Cursor**，skills 会自动被发现。

---

## 八、文件结构速查（SKILL 标准格式）

```
.cursor/skills/<skill-name>/
├── SKILL.md           # 必需：YAML frontmatter + 指令正文
├── scripts/           # 可选：可执行脚本
├── references/        # 可选：参考文档
└── assets/            # 可选：模板/静态资源
```

`SKILL.md` frontmatter 最少字段：

```yaml
---
name: skill-name
description: 第三人称描述：做什么、何时触发
---
```

---

## 九、与本项目已内置 Skills 对照

本机 Cursor 已安装（`~/.cursor/skills-cursor/`）：

| 已有 | 用途 |
|------|------|
| create-skill | 编写新 SKILL.md |
| create-rule | 编写 .cursor/rules |
| create-hook | 编写 hooks |
| update-cursor-settings | 修改 settings.json |
| sdk | Cursor SDK 集成 |

GitHub 收藏清单补充的是 **业务向** skills（Vue UI、Express API、PostgreSQL、Docker 部署等）。

---

## 十、维护记录

| 日期 | 操作 |
|------|------|
| 2026-07-07 | 初版：整理 awesome-cursor-skills、aussiegingersnap、vercel-labs、anthropics 等前后端/数据库 skills |

---

*本清单保存在仓库 `docs/CURSOR-SKILLS-收藏清单.md`，可随 Git 同步到 https://github.com/Rabit11/paltform*
