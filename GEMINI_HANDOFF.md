# Gemini Handoff - Novel Factory MVP v2

## Project Goal
A structured-memory-driven novel writing system.

Core rules:
1. All generation endpoints must go through `Retriever -> Memory Assembler -> LLM`.
2. Memory must be persisted (chapter summary/facts/seeds/state snapshot).
3. Each memory item must be traceable (source id/span/version).
4. SQL retrieval first, vector retrieval optional for future.
5. Frontend must display generation context package for auditability.

## Stack
- Backend: NestJS + Prisma + PostgreSQL
- Frontend: Next.js App Router + Tailwind + Monaco + React Flow
- Packages:
  - `packages/shared`: zod contracts/types
  - `packages/llm`: provider abstraction (OpenAI/DeepSeek/xAI)
  - `packages/memory`: retriever/assembler/extractor/checker

## Implemented Highlights
- Full CRUD for projects/bible/chapters/versions.
- Generation pipeline: beats/draft/polish + fix endpoint.
- Idempotency-key for generation/fix.
- Continuity checker with evidence offsets.
- Workspace page with 3-column layout.
- Chinese UI localization improvements and visual bible editor (form-first, JSON optional).

## Current API Notes
- `DELETE /api/projects/:id` exists.
- `GET /api/projects` returns all projects (used by dashboard to show project count).
- `POST /api/chapters/:chapterId/fix` supports:
  - `replace_span`
  - `rewrite_section` (scene_index)
  - `rewrite_chapter`

## Environment
Backend env in `apps/api/.env`:
- `LLM_PROVIDER=deepseek` (or openai/xai)
- `DEEPSEEK_API_KEY=...`
- `DATABASE_URL=...`

Frontend env in `apps/web/.env.local`:
- `NEXT_PUBLIC_API_BASE=http://localhost:3001/api`

## Useful Commands
```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build

# DB
cd apps/api
pnpm prisma generate --schema ../../prisma/schema.prisma
pnpm prisma migrate dev --schema ../../prisma/schema.prisma
```

## Suggested Frontend Improvements for Gemini
1. Replace remaining English labels in workspace and helper texts.
2. Make relationships fully visual-editable (not JSON fallback).
3. Better project-level overview cards and search/filter on `/projects`.
4. UX polish for bible form (validation, inline hints, autosave).
5. Add toasts for success/failure instead of plain text alerts.
6. Add e2e tests for critical UX paths.

## Important Constraints
- Keep backend behavior and API contracts stable.
- Do not bypass Memory Assembler in generation routes.
- Preserve idempotency semantics.
- Do not expose API keys to frontend.
