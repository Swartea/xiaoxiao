# Novel Factory MVP v2

Novel Factory 是一个面向长篇网文生产的结构化记忆写作系统。项目以 `NestJS + Prisma + PostgreSQL` 为后端，`Next.js App Router` 为前端，围绕“项目初始化 -> 圣经维护 -> 大纲编排 -> 章节生成 -> 一致性检查 -> 修复与版本追踪”组织整套写作流程。

当前仓库已经包含两条可并行演进的能力线：

- 生产线：项目、圣经、章节、版本、工作台、记忆抽取与修复闭环
- StoryOS：可追踪的多 Agent / 多 Engine 编排层，用于蓝图、章节意图、质量评估、导演复审、实验与改编

## 当前能力

### 项目与初始化

- 项目列表、创建、删除、基础信息查询
- 项目 Dashboard 向导式开局
- `POST /api/projects/:projectId/bootstrap` 一次性生成：
  - 基础项目信息
  - 圣经初稿
  - 全局大纲骨架
  - 第一章 Beats
- `GET /api/projects/:projectId/bootstrap/status` 轮询长任务状态

### 圣经管理

- 角色、关系、设定实体、术语表、时间线 CRUD
- 表单优先的 Bible 编辑器，支持 JSON 兜底模式
- 自动保存
- 术语 canonical form 冲突提示
- 可直接跳转相关章节工作台

### 大纲工作台

- `Story Spine` 总纲字段维护
- 阶段大纲与章节细纲双视图
- 阶段/章节联动字段编辑
- 角色职责、伏笔链接、推进度、非漂移约束维护
- 结构诊断与联动诊断
- `GET/PATCH /api/projects/:projectId/outline/workspace`

### 章节与工作台

- 章节创建、章节列表、版本列表、版本 diff、版本回滚
- 支持导入已有章节：
  - 直接粘贴多章 TXT，按“第 N 章”拆分
  - 直接粘贴 JSON 数组
- Workspace 三栏工作区：
  - 左侧：生成上下文、trace map、retriever meta、context hash
  - 中间：Monaco 编辑、版本切换、Diff
  - 右侧：连续性问题、Fix 策略、记忆状态确认
- `fix preview` 预览
- `review block` 挂起 / 恢复

### 生成与记忆系统

- 章节流水线：`beats -> draft -> polish`
- Continuity Check
- `fix` 三种模式：
  - `replace_span`
  - `rewrite_section`
  - `rewrite_chapter`
- Memory Assembler 强制中间层
- 生成上下文快照与 `context_hash`
- 记忆抽取回写：
  - facts
  - seeds
  - timeline events
- 抽取状态生命周期：
  - `extracted`
  - `confirmed`
  - `rejected`
  - `superseded`
- 严重问题会将章节状态置为 `blocked_review`

### StoryOS 增量重构

- 项目级接口：
  - `POST /api/projects/:id/blueprint`
  - `POST /api/projects/:id/arcs`
  - `GET /api/projects/:id/book-structure`
  - `GET /api/style-presets`
  - `GET /api/prompt-templates`
  - `POST /api/prompt-templates`
  - `POST /api/prompt-templates/:id/rollback`
- 章节级接口：
  - `POST /api/chapters/:id/intent`
  - `POST /api/chapters/:id/evaluate`
  - `POST /api/chapters/:id/director-review`
  - `POST /api/chapters/:id/experiment`
  - `POST /api/chapters/:id/adapt/script`
  - `POST /api/chapters/:id/adapt/storyboard`
  - `GET /api/chapters/:id/diagnostics`
  - `GET /api/chapters/:id/context-brief`
  - `POST /api/chapters/:id/pipeline-run`
- 内置 style preset 与 prompt template versioning
- `agent_runs` / quality / director / fix / experiment 等可追踪运行记录

## 技术栈

- 后端：NestJS 11、Prisma、PostgreSQL
- 前端：Next.js 15、React 19、Tailwind CSS、Monaco、React Flow
- Monorepo：pnpm workspace + Turbo
- LLM Provider：OpenAI / DeepSeek / xAI

## 仓库结构

```text
.
├── apps
│   ├── api                    # NestJS API
│   └── web                    # Next.js Web
├── packages
│   ├── llm                    # Provider 抽象
│   ├── memory                 # retriever / assembler / extractor / checker
│   ├── shared                 # zod schema / shared contracts
│   ├── storyos-domain         # StoryOS 领域类型
│   └── storyos-prompts        # StoryOS Prompt 模板
├── prisma
│   ├── schema.prisma
│   └── migrations
├── tools
│   └── launcher               # 本地启动/停止辅助脚本
└── docker-compose.yml
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 PostgreSQL

```bash
docker compose up -d
```

默认数据库：

- host: `localhost:5432`
- db: `novel_factory`
- user: `novel`
- password: `novel`

### 3. 配置环境变量

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

后端最少需要：

```env
PORT=3001
DATABASE_URL=postgresql://novel:novel@localhost:5432/novel_factory?schema=public
LLM_PROVIDER=openai
OPENAI_API_KEY=
```

前端默认：

```env
NEXT_PUBLIC_API_BASE=http://localhost:3001/api
```

### 4. 生成 Prisma Client 并执行迁移

```bash
pnpm db:generate
pnpm db:migrate
```

### 5. 启动开发环境

```bash
pnpm dev
```

启动后：

- Web: `http://localhost:3000`
- API: `http://localhost:3001/api`

## LLM 配置

后端支持 `openai`、`deepseek`、`xai` 三类 provider。

### OpenAI

```env
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=
MODEL_BEATS=gpt-4.1-mini
MODEL_DRAFT=gpt-4.1-mini
MODEL_POLISH=gpt-4.1
MODEL_CHECK=gpt-4.1-mini
MODEL_EXTRACT=gpt-4.1-mini
MODEL_FIX=gpt-4.1
```

### DeepSeek

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
MODEL_BEATS=deepseek-chat
MODEL_DRAFT=deepseek-chat
MODEL_POLISH=deepseek-chat
MODEL_CHECK=deepseek-chat
MODEL_EXTRACT=deepseek-chat
MODEL_FIX=deepseek-chat
```

如果要使用推理模型，可将 `MODEL_FIX` 或 `MODEL_POLISH` 改成 `deepseek-reasoner`。

### xAI

```env
LLM_PROVIDER=xai
XAI_API_KEY=your_xai_api_key
XAI_BASE_URL=https://api.x.ai/v1
MODEL_BOOTSTRAP=grok-3-mini-beta
```

## 常用脚本

```bash
pnpm dev
pnpm build
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm db:push
```

可选维护脚本：

```bash
pnpm --filter @novel-factory/api exec tsx src/scripts/cleanup-facts.ts --dry-run
```

这个脚本会扫描已抽取 facts，把明显噪声标记为 `rejected`，把重复或已失效项标记为 `superseded`。

## 核心 API

### 项目

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`

### Bootstrap 与大纲

- `POST /api/projects/:projectId/bootstrap`
- `GET /api/projects/:projectId/bootstrap/status`
- `GET /api/projects/:projectId/outline`
- `GET /api/projects/:projectId/outline/workspace`
- `PATCH /api/projects/:projectId/outline`
- `PATCH /api/projects/:projectId/outline/workspace`

### Bible

- `GET /api/projects/:projectId/bible`
- `PATCH /api/projects/:projectId/bible`
- `GET|POST|PATCH|DELETE /api/projects/:projectId/characters`
- `GET|POST|PATCH|DELETE /api/projects/:projectId/relationships`
- `GET|POST|PATCH|DELETE /api/projects/:projectId/entities`
- `GET|POST|PATCH|DELETE /api/projects/:projectId/glossary`
- `GET|POST|PATCH|DELETE /api/projects/:projectId/timeline`

### 章节与版本

- `POST /api/projects/:projectId/chapters`
- `POST /api/projects/:projectId/chapters/second-template`
- `POST /api/projects/:projectId/chapters/import`
- `GET /api/projects/:projectId/chapters`
- `GET /api/chapters/:chapterId`
- `GET /api/chapters/:chapterId/versions`
- `GET /api/chapters/:chapterId/versions/:versionId`
- `GET /api/chapters/:chapterId/versions/diff?from=&to=`
- `POST /api/chapters/:chapterId/rollback`
- `PATCH /api/chapters/:chapterId/review-block`
- `GET /api/chapters/:chapterId/workspace`

### 生成 / 检查 / 修复

- `POST /api/chapters/:chapterId/generate/beats`
- `POST /api/chapters/:chapterId/generate/draft`
- `POST /api/chapters/:chapterId/generate/polish`
- `POST /api/chapters/:chapterId/check/continuity`
- `POST /api/chapters/:chapterId/fix`
- `POST /api/chapters/:chapterId/fix/preview`
- `PATCH /api/chapters/:chapterId/facts/:factId/status`
- `PATCH /api/chapters/:chapterId/seeds/:seedId/status`
- `PATCH /api/chapters/:chapterId/timeline/:eventId/status`

## 请求约束

以下接口应携带 `Idempotency-Key`：

- `POST /api/projects/:projectId/bootstrap`
- `POST /api/chapters/:chapterId/generate/beats`
- `POST /api/chapters/:chapterId/generate/draft`
- `POST /api/chapters/:chapterId/generate/polish`
- `POST /api/chapters/:chapterId/fix`

## 测试与校验

```bash
pnpm typecheck
pnpm test
pnpm build
```

仓库里已经补充了较多单测，重点覆盖：

- bootstrap 输入与流程
- chapters 导入 / review block
- generation blocked review 行为
- outline workspace
- StoryOS continuity / quality / fix
- memory lifecycle / sanitizer / snapshot / checker

## 备注

- API 默认前缀是 `/api`
- 生成能力依赖有效的 LLM API Key
- 当前 `lint` 不是完整质量门，建议以 `typecheck + test + build` 为主
