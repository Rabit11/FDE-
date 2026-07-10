# AgileAI · AI赋能敏捷项目管理平台

面向 AI 赋能项目的现代化敏捷管理平台，替代传统 FDE 审批式工单流程，实现 **Sprint 节奏 + 流动看板 + AI 协作者** 的持续价值交付。

## 核心特性

| 模块 | 能力 |
|------|------|
| **流动看板** | Kanban 六列流转，WIP 上限告警，拖拽变更状态 |
| **Sprint 管理** | 2 周迭代节奏，燃尽进度，Sprint Backlog |
| **智能 Backlog** | Epic / Story / Task / Bug 层级，优先级排序 |
| **在线验收中心** | 平台内验收，打回反馈自动创建新 Story |
| **AI 需求拆分** | 自然语言需求 → Epic + Story + Task + 验收标准 |
| **AI 站会摘要** | 基于任务状态自动生成每日站会报告 |
| **AI 风险预警** | 阻塞检测、延期预测、Sprint 健康度分析 |
| **度量仪表盘** | Lead Time、吞吐量、状态分布、活动流 |

## 快速启动

```bash
npm install
npm start
```

访问 **http://localhost:3456**

GitHub: **https://github.com/Rabit11/ai-agile-platform**

## 角色与登录

| 角色 | 工号示例 | 密码 | 工作台 |
|------|---------|------|--------|
| 超级管理员 | 666666 | aiic@2026 | 全局管理 + 团队 + AI 指挥中心 |
| 管理员 | 600412 (曾锐) | 同左 | 审核分配 + Sprint + 验收 |
| 执行人员 | 600785 (赵立泽) | 同左 | 我的任务 + 提交需求 + AI 协作者 |

登录页: **http://localhost:3456/login.html**

## LLM 智能引擎（可选）

复制 `.env.example` 为 `.env`，配置 OpenAI 兼容 API Key 即可启用 LLM 增强：

```bash
cp .env.example .env
# 编辑 OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
```

未配置时自动使用本地规则引擎，配置后 AI 拆分/站会/风险/Copilot 全面升级为 LLM 驱动。

## 语音需求（国产 AI 全链路）

侧边栏 **🎙️ 语音需求** 支持：

1. **上传录音** 或 **浏览器现场录音**（MP3/WAV/M4A/WebM）
2. **阿里云 Paraformer** 语音转文字（国产 ASR）
3. **DeepSeek V3** 分析梳理生成 Markdown 需求文档
4. **自动拆解** Epic → Story → Task 并写入 Backlog

```env
DEEPSEEK_API_KEY=sk-xxx      # 大模型分析+拆任务
DASHSCOPE_API_KEY=sk-xxx     # 语音转写
```

## 技术栈

- **后端**: Node.js + Express + JSON 持久化存储
- **前端**: 原生 HTML/CSS/JS SPA
- **AI**: 内置智能引擎（需求拆分、风险分析、站会摘要、Retro 报告）

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/items` | 获取工作项列表 |
| POST | `/api/items` | 创建工作项 |
| PATCH | `/api/items/:id` | 更新工作项 |
| POST | `/api/items/:id/accept` | 在线验收 |
| GET | `/api/sprints` | 获取 Sprint 列表 |
| GET | `/api/metrics` | 获取度量数据 |
| POST | `/api/ai/split-requirement` | AI 需求拆分 |
| POST | `/api/ai/standup` | AI 站会摘要 |
| POST | `/api/ai/risks` | AI 风险扫描 |
| POST | `/api/ai/retro` | AI Sprint 回顾 |

## 与 FDE 旧流程对比

| FDE 旧流程 | AgileAI 新方案 |
|-----------|---------------|
| 多级审批表单 | 看板拖拽 + WIP 限制 |
| 确认需求卡（需求冻结） | Sprint 内持续调整 Backlog |
| 8-10 条手动日志 | 状态流转自动记录 + 活动流 |
| 线下需求方审核 | 在线验收中心，反馈自动回流 |
| 无 AI 能力 | AI 拆分/摘要/预警/Retro 四大能力 |

## License

MIT
