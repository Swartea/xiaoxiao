# Novel Factory MVP v2

Novel Factory 是一个结构化记忆驱动的小说生产系统。

## StoryOS 增量重构（2026-03）

已新增 StoryOS 模块与可追踪多 Agent 架构，核心流程：

`Planner -> Context -> Prompt -> Generation -> Quality -> Director -> Fix -> Re-eval -> Version -> Experiment`

### 新增目录（核心）

```text
apps/api/src/storyos/
  orchestrator/
  engines/
  agents/
  controllers/
  dto/
packages/storyos-domain/
packages/storyos-prompts/
```

### 新增 API

- `POST /api/projects/:id/blueprint`
- `POST /api/projects/:id/arcs`
- `POST /api/chapters/:id/intent`
- `POST /api/chapters/:id/evaluate`
- `POST /api/chapters/:id/director-review`
- `POST /api/chapters/:id/experiment`
- `POST /api/chapters/:id/adapt/script`
- `POST /api/chapters/:id/adapt/storyboard`
- `GET /api/chapters/:id/diagnostics`
- `GET /api/style-presets`
- `GET /api/prompt-templates`
- `POST /api/prompt-templates`

### Prompt 与 Style 系统

- 默认内置 `webnovel / toutiao-fiction / short-drama` 三套 style preset。
- 新增 PromptTemplate + PromptTemplateVersion，可支持版本切换、A/B 变体与回滚。

### 可追踪字段

新增 `agent_runs` 表，记录：

- `project_id/chapter_id/run_id/agent_name/prompt_version/model/style_preset/retriever_strategy/context_hash/token_usage/quality_score/created_at`

并在 `chapter_versions.meta` 强化存储：

- `source_stage/prompt_template_version/model/style_preset/quality_score/manual_accepted`

## 已实现能力

- 后端（NestJS + Prisma + PostgreSQL）
  - 项目、圣经、章节、版本 CRUD
  - 生成流水线：`beats -> draft -> polish`
  - `fix` 语义完整支持：`replace_span | rewrite_section | rewrite_chapter`
  - 幂等与重入：`Idempotency-Key` + `generation_requests`
  - Memory Assembler 强制中间层
  - Retriever 审计字段：`k/query_entities/filters/ordering/ids_selected`
  - `generation_context_snapshots`（含 `context_hash/build_version`）
  - Extractor 回写：`chapter_memory/facts/seeds/timeline_events`
  - Continuity Checker：术语、年龄、能力边界、信息视角双层规则
  - 版本 diff / rollback

- 前端（Next.js + Tailwind + Monaco + React Flow）
  - 路由：
    - `/projects`
    - `/projects/[id]/dashboard`
    - `/projects/[id]/bible`
    - `/projects/[id]/outline`
    - `/projects/[id]/chapters`
    - `/projects/[id]/chapters/[no]/workspace`
    - `/projects/[id]/characters`
  - Workspace 三栏：
    - 左：GenerationContext + trace_map + retriever_meta + context_hash
    - 中：Monaco 编辑、版本切换、Diff
    - 右：一致性问题跳转、fix 策略、facts/seeds/timeline 状态确认

## Monorepo 结构

```text
novel-factory/
  apps/
    api/
    web/
  packages/
    shared/
    llm/
    memory/
  prisma/
    schema.prisma
    migrations/
  docker-compose.yml
```

## 快速开始

1. 安装依赖

```bash
pnpm install
```

2. 启动 PostgreSQL

```bash
docker compose up -d
```

3. 配置环境变量

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

### 使用 DeepSeek（可选）

编辑 `apps/api/.env`：

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

如果要用推理模型，可把 `MODEL_FIX` 或 `MODEL_POLISH` 改成 `deepseek-reasoner`。

4. 生成 Prisma Client + 执行迁移

```bash
PRISMA_GENERATE_SKIP_AUTOINSTALL=1 pnpm prisma generate --schema prisma/schema.prisma
pnpm prisma migrate dev --schema prisma/schema.prisma
```

5. 启动开发环境

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:3001/api`

## 核心接口

- 项目
  - `POST /api/projects`
  - `GET /api/projects`
  - `GET /api/projects/:id`
  - `PATCH /api/projects/:id`

- 圣经
  - `GET /api/projects/:id/bible`
  - `PATCH /api/projects/:id/bible`（仅结构化输入）
  - CRUD: `characters/relationships/entities/glossary/timeline`

- 章节与版本
  - `POST /api/projects/:id/chapters`
  - `GET /api/projects/:id/chapters`
  - `GET /api/chapters/:chapterId`
  - `GET /api/chapters/:chapterId/versions`
  - `GET /api/chapters/:chapterId/versions/diff?from=&to=`
  - `POST /api/chapters/:chapterId/rollback`

- 生成/检查/修复
  - `POST /api/chapters/:chapterId/generate/beats`
  - `POST /api/chapters/:chapterId/generate/draft`
  - `POST /api/chapters/:chapterId/generate/polish`
  - `POST /api/chapters/:chapterId/check/continuity`
  - `POST /api/chapters/:chapterId/fix`

- Workspace 聚合
  - `GET /api/chapters/:chapterId/workspace`

## `fix` 请求体

```json
{
  "base_version_id": "uuid",
  "mode": "replace_span",
  "span": { "from": 120, "to": 300 },
  "issue_ids": ["ISSUE-1"],
  "strategy_id": "strategy-1",
  "instruction": "可选，自由文本"
}
```

`mode = rewrite_section` 时使用：

```json
{
  "mode": "rewrite_section",
  "section": { "scene_index": 2 }
}
```

## 幂等规则

以下接口必须携带 `Idempotency-Key` Header：

- `generate/beats`
- `generate/draft`
- `generate/polish`
- `fix`

同 `chapter + stage + key + payload` 会回放同一结果。

## 测试

```bash
pnpm typecheck
pnpm test
pnpm build
```
