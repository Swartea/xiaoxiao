# Story Resources

## Goal

`story_resources` is the unified resource layer for StoryOS.

It makes characters, glossary terms, timeline events, relationships, sensitive words, and regex rules available to:

- chapter reference tracking
- StoryOS retrieval and context assembly
- continuity checks
- workspace diagnostics

## Data Model

Prisma additions:

- `ResourceType`
- `ResourceReferenceState`
- `ResourceReferenceOrigin`
- `SensitiveWord`
- `RegexRule`
- `ResourceReference`

Reference tracking is implemented as a polymorphic ledger:

- `project_id`
- `chapter_id`
- `version_id`
- `resource_type`
- `resource_id`
- `state`
- `origin`
- `confidence`
- `occurrence_count`
- `evidence_json`

Typed resources remain in their original canonical tables:

- `Character`
- `GlossaryTerm`
- `TimelineEvent`
- `Relationship`

## Migrations

Applied migrations:

- `0005_story_resources_phase1`
- `0006_story_resources_backfill`

Backfill behavior:

- scans latest chapter versions
- creates initial `character` and `glossary` references
- is safe to re-run because it uses the chapter/type/resource unique key

## API

Compatibility endpoint:

- `GET /projects/:projectId/bible`
- `PATCH /projects/:projectId/bible`

Resource CRUD:

- `GET/POST/PATCH/DELETE /projects/:projectId/characters`
- `GET/POST/PATCH/DELETE /projects/:projectId/glossary`
- `GET/POST/PATCH/DELETE /projects/:projectId/timeline`
- `GET/POST/PATCH/DELETE /projects/:projectId/relationships`
- `GET/POST/PATCH/DELETE /projects/:projectId/rules/sensitive-words`
- `GET/POST/PATCH/DELETE /projects/:projectId/rules/regex`

Reference and stats:

- `GET /projects/:projectId/chapters/:chapterId/references`
- `PATCH /projects/:projectId/chapters/:chapterId/references`
- `POST /projects/:projectId/chapters/:chapterId/references/rebuild`
- `GET /projects/:projectId/:collection/:id/references`
- `GET /projects/:projectId/:collection/:id/stats`

Collection query params:

- `q`
- `limit`
- `offset`
- `chapter_id`
- `include=stats,references`

## Pipeline Integration

### Generation

`GenerationService.retrieveMemory()` now prioritizes:

1. confirmed references
2. inferred references
3. project-level fallback retrieval

Returned memory package now includes:

- `sensitiveWords`
- `regexRules`
- `referencedResources`

### Context Assembly

`buildGenerationContext()` now adds:

- `safety_rules`
- `referenced_resources`

Rules are also folded into `constraints`.

### Reference Rebuild

After generation and fix:

- extracted memory is saved
- chapter references are rebuilt with `origin = generation`
- continuity runs against the refreshed reference set

### Continuity

New issue types:

- `sensitive_word_hit`
- `regex_rule_hit`
- `confirmed_reference_missing`

## StoryOS

Updated engines and services:

- `ContextEngine`
- `QualityEngine`
- `ContinuityEvaluatorEngine`
- `WorkspaceService`
- `StoryosService.buildDiagnostics`

Diagnostics now include:

- current chapter references
- reference state summary
- hot resources
- rule hits

## Web

New project pages:

- `/projects/[id]/characters`
- `/projects/[id]/glossary`
- `/projects/[id]/timeline`
- `/projects/[id]/relationships`
- `/projects/[id]/rules`

Workspace updates:

- right-side `Resources` card
- confirm / ignore / restore reference actions
- rebuild reference scan action
- rule hit visibility

## Validation

Verified locally with:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm --filter @novel-factory/api db:migrate`
