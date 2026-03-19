import type { ChapterStatus } from "@prisma/client";

export const OUTLINE_WORKSPACE_KEY = "outline_workspace";

export type OutlineScope = "story_spine" | "stage" | "chapter" | "structure" | "linking";

export type OutlineDiagnostic = {
  scope: OutlineScope;
  level: "warn" | "info";
  code: string;
  title: string;
  message: string;
  phase_no?: number | null;
  chapter_no?: number | null;
};

export type OutlineStateSnapshot = {
  protagonist_state: string | null;
  relationship_state: string | null;
  world_state: string | null;
};

export type OutlineProgressValue = {
  plot: number | null;
  relationship: number | null;
  information: number | null;
};

export type CharacterRoleAssignment = {
  character_id: string | null;
  character_name: string | null;
  role: string | null;
};

export type SeedLinkData = {
  seed_id: string | null;
  seed_name: string | null;
  introduce_in_stage: number | null;
  introduce_in_chapter: number | null;
  payoff_in_stage: number | null;
  payoff_in_chapter: number | null;
  current_status: string | null;
  link_type: string | null;
};

export type StorySpineData = {
  logline: string | null;
  main_conflict: string | null;
  protagonist_long_goal: string | null;
  external_pressure: string | null;
  internal_conflict: string | null;
  central_question: string | null;
  ending_direction: string | null;
  ending_cost: string | null;
  story_promise: string | null;
  theme_statement: string | null;
  non_drift_constraints: string[];
  source_snapshot: Record<string, unknown> | null;
};

export type StageMetaData = {
  stage_function: string | null;
  start_state: OutlineStateSnapshot;
  stage_goal: string | null;
  main_opponent: string | null;
  key_events: string[];
  midpoint_change: string | null;
  climax: string | null;
  ending_state: OutlineStateSnapshot;
  stage_cost: string | null;
  progress: OutlineProgressValue;
  completion_criteria: string | null;
  no_drift_constraints: string[];
  involved_character_ids: string[];
  character_role_assignments: CharacterRoleAssignment[];
  seed_links: SeedLinkData[];
};

export type ChapterOutlineMeta = {
  stage_no: number | null;
  stage_position: string | null;
  goal: string | null;
  chapter_function: string | null;
  core_conflict: string | null;
  key_events: string[];
  scene_progression: string[];
  key_takeaways: string[];
  relationship_changes: string[];
  character_change: string | null;
  information_reveal: string | null;
  strategy_judgment: string | null;
  ending_hook: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeStateSnapshot(value: unknown): OutlineStateSnapshot {
  const record = normalizeRecord(value);
  return {
    protagonist_state: asOptionalString(record.protagonist_state),
    relationship_state: asOptionalString(record.relationship_state),
    world_state: asOptionalString(record.world_state),
  };
}

function normalizeProgressValue(value: unknown): OutlineProgressValue {
  const record = normalizeRecord(value);
  return {
    plot: asInt(record.plot),
    relationship: asInt(record.relationship),
    information: asInt(record.information),
  };
}

function normalizeCharacterRoleAssignments(value: unknown): CharacterRoleAssignment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = normalizeRecord(item);
      const role = asOptionalString(record.role);
      const characterId = asOptionalString(record.character_id);
      const characterName = asOptionalString(record.character_name);
      if (!role && !characterId && !characterName) {
        return null;
      }
      return {
        character_id: characterId,
        character_name: characterName,
        role,
      } satisfies CharacterRoleAssignment;
    })
    .filter((item): item is CharacterRoleAssignment => item !== null);
}

function normalizeSeedLinks(value: unknown): SeedLinkData[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const record = normalizeRecord(item);
      const seedId = asOptionalString(record.seed_id);
      const seedName = asOptionalString(record.seed_name);
      if (!seedId && !seedName) {
        return null;
      }
      return {
        seed_id: seedId,
        seed_name: seedName,
        introduce_in_stage: asInt(record.introduce_in_stage),
        introduce_in_chapter: asInt(record.introduce_in_chapter),
        payoff_in_stage: asInt(record.payoff_in_stage),
        payoff_in_chapter: asInt(record.payoff_in_chapter),
        current_status: asOptionalString(record.current_status),
        link_type: asOptionalString(record.link_type),
      } satisfies SeedLinkData;
    })
    .filter((item): item is SeedLinkData => item !== null);
}

export function normalizeStorySpineData(value: unknown): StorySpineData {
  const record = normalizeRecord(value);
  return {
    logline: asOptionalString(record.logline),
    main_conflict: asOptionalString(record.main_conflict),
    protagonist_long_goal: asOptionalString(record.protagonist_long_goal),
    external_pressure: asOptionalString(record.external_pressure),
    internal_conflict: asOptionalString(record.internal_conflict),
    central_question: asOptionalString(record.central_question),
    ending_direction: asOptionalString(record.ending_direction),
    ending_cost: asOptionalString(record.ending_cost),
    story_promise: asOptionalString(record.story_promise),
    theme_statement: asOptionalString(record.theme_statement),
    non_drift_constraints: asStringArray(record.non_drift_constraints),
    source_snapshot: isRecord(record.source_snapshot) ? record.source_snapshot : null,
  };
}

export function normalizeStageMetaData(setupPayload: unknown, twistPayload: unknown): StageMetaData {
  const rootRecord = normalizeRecord(setupPayload);
  const workspaceRecord = normalizeRecord(rootRecord[OUTLINE_WORKSPACE_KEY]);
  const payload = Object.keys(workspaceRecord).length > 0 ? workspaceRecord : rootRecord;

  return {
    stage_function: asOptionalString(payload.stage_function),
    start_state: normalizeStateSnapshot(payload.start_state),
    stage_goal: asOptionalString(payload.stage_goal),
    main_opponent: asOptionalString(payload.main_opponent),
    key_events: asStringArray(payload.key_events).length > 0 ? asStringArray(payload.key_events) : asStringArray(twistPayload),
    midpoint_change: asOptionalString(payload.midpoint_change),
    climax: asOptionalString(payload.climax),
    ending_state: normalizeStateSnapshot(payload.ending_state),
    stage_cost: asOptionalString(payload.stage_cost),
    progress: normalizeProgressValue(payload.progress),
    completion_criteria: asOptionalString(payload.completion_criteria),
    no_drift_constraints: asStringArray(payload.no_drift_constraints),
    involved_character_ids: asStringArray(payload.involved_character_ids),
    character_role_assignments: normalizeCharacterRoleAssignments(payload.character_role_assignments),
    seed_links: normalizeSeedLinks(payload.seed_links),
  };
}

export function normalizeChapterOutlineMeta(notesPayload: unknown): ChapterOutlineMeta {
  const rootRecord = normalizeRecord(notesPayload);
  const workspaceRecord = normalizeRecord(rootRecord[OUTLINE_WORKSPACE_KEY]);
  const payload = Object.keys(workspaceRecord).length > 0 ? workspaceRecord : rootRecord;

  return {
    stage_no: asInt(payload.stage_no),
    stage_position: asOptionalString(payload.stage_position),
    goal: asOptionalString(payload.goal),
    chapter_function: asOptionalString(payload.chapter_function),
    core_conflict: asOptionalString(payload.core_conflict),
    key_events: asStringArray(payload.key_events),
    scene_progression: asStringArray(payload.scene_progression),
    key_takeaways: asStringArray(payload.key_takeaways),
    relationship_changes: asStringArray(payload.relationship_changes),
    character_change: asOptionalString(payload.character_change),
    information_reveal: asOptionalString(payload.information_reveal),
    strategy_judgment: asOptionalString(payload.strategy_judgment),
    ending_hook: asOptionalString(payload.ending_hook),
  };
}

export function normalizeChapterStoredTitle(chapterNo: number, title?: string | null) {
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) {
    return null;
  }

  const samePrefixPattern = new RegExp(`^第\\s*${chapterNo}\\s*章(?:\\s*[·.、\\-]\\s*|\\s+)?`, "i");
  const anyPrefixPattern = /^第\s*\d+\s*章(?:\s*[·.、\-]\s*|\s+)?/i;
  return trimmed.replace(samePrefixPattern, "").replace(anyPrefixPattern, "").trim() || null;
}

export function formatChapterDisplayTitle(chapterNo: number, title?: string | null) {
  const normalized = normalizeChapterStoredTitle(chapterNo, title);
  return normalized ? `第${chapterNo}章 · ${normalized}` : `第${chapterNo}章`;
}

export function mapDbStatusToOutlineStatus(status: ChapterStatus | string | null | undefined) {
  if (status === "final") return "approved";
  if (status === "blocked_review") return "needs_revision";
  if (status === "draft") return "draft";
  return "draft";
}

export function deriveStagePosition(index: number, total: number) {
  if (total <= 1 || index === 0) {
    return "开局章";
  }
  if (index === total - 1) {
    return total > 2 ? "高潮章" : "收束章";
  }
  if (index === Math.floor(total / 2)) {
    return "转折章";
  }
  return "推进章";
}

export function determineStageNo(
  chapterNo: number,
  ranges: Array<{
    phase_no: number;
    chapter_range_start?: number | null;
    chapter_range_end?: number | null;
    milestone_chapter_no?: number | null;
  }>,
  preferredStageNo?: number | null,
) {
  if (preferredStageNo && ranges.some((item) => item.phase_no === preferredStageNo)) {
    return preferredStageNo;
  }

  const byRange = ranges.find((item) => {
    const start = item.chapter_range_start ?? 1;
    const end = item.chapter_range_end ?? item.milestone_chapter_no ?? Number.MAX_SAFE_INTEGER;
    return chapterNo >= start && chapterNo <= end;
  });
  if (byRange) {
    return byRange.phase_no;
  }

  const byMilestone = ranges.find((item) => {
    const end = item.milestone_chapter_no ?? item.chapter_range_end ?? Number.MAX_SAFE_INTEGER;
    return chapterNo <= end;
  });
  return byMilestone?.phase_no ?? ranges.at(-1)?.phase_no ?? null;
}

export function collectStringsFromJson(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim().length > 0 ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringsFromJson(item));
  }
  if (isRecord(value)) {
    return Object.values(value).flatMap((item) => collectStringsFromJson(item));
  }
  return [];
}

export function tokenizeText(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      (value.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) ?? [])
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );
}

export function hasWeakTextOverlap(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = tokenizeText(left);
  const rightTokens = tokenizeText(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  return leftTokens.every((token) => !rightTokens.includes(token)) && rightTokens.every((token) => !leftTokens.includes(token));
}
