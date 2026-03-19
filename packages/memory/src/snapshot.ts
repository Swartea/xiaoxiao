import type {
  CharacterStateSnapshot,
  ExtractedMemory,
  StateChangeEvent,
  StoryStateSnapshot,
} from "./types";

const STORY_STATE_KEY = "__story__";

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.filter((item): item is string => typeof item === "string"));
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeCharacterStateSnapshot(value: unknown): CharacterStateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return { current_status: value.trim(), condition_flags: [value.trim()] };
    }
    return {};
  }

  const record = value as Record<string, unknown>;
  const currentStatus = normalizeString(record.current_status ?? record.status ?? record.condition);

  return {
    current_status: currentStatus,
    items_owned: toStringArray(record.items_owned ?? record.inventory ?? record.items),
    items_missing: toStringArray(record.items_missing ?? record.lost_items ?? record.missing_items),
    condition_flags: uniqueStrings([
      currentStatus,
      ...toStringArray(record.condition_flags ?? record.conditions),
    ]),
    ability_flags: toStringArray(record.ability_flags ?? record.abilities_state),
    identity_flags: toStringArray(record.identity_flags ?? record.identities),
    allegiance: normalizeString(record.allegiance),
    previous_allegiance: normalizeString(record.previous_allegiance),
    resolved_seed_ids: toStringArray(record.resolved_seed_ids),
    resolved_seed_contents: toStringArray(record.resolved_seed_contents),
    last_updated_chapter_no:
      typeof record.last_updated_chapter_no === "number" ? record.last_updated_chapter_no : undefined,
    source_version_id: normalizeString(record.source_version_id) ?? undefined,
  };
}

function normalizeStoryStateSnapshot(value: unknown): StoryStateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  return {
    paid_off_seed_ids: toStringArray(record.paid_off_seed_ids),
    paid_off_seed_contents: toStringArray(record.paid_off_seed_contents),
    last_updated_chapter_no:
      typeof record.last_updated_chapter_no === "number" ? record.last_updated_chapter_no : undefined,
    source_version_id: normalizeString(record.source_version_id) ?? undefined,
  };
}

function mergeCharacterSnapshot(
  base: CharacterStateSnapshot,
  patch: CharacterStateSnapshot,
  chapterNo: number,
  versionId: string,
): CharacterStateSnapshot {
  const merged: CharacterStateSnapshot = {
    current_status: patch.current_status ?? base.current_status ?? undefined,
    items_owned: uniqueStrings([...(base.items_owned ?? []), ...(patch.items_owned ?? [])]),
    items_missing: uniqueStrings([...(base.items_missing ?? []), ...(patch.items_missing ?? [])]),
    condition_flags: uniqueStrings([...(base.condition_flags ?? []), ...(patch.condition_flags ?? [])]),
    ability_flags: uniqueStrings([...(base.ability_flags ?? []), ...(patch.ability_flags ?? [])]),
    identity_flags: uniqueStrings([...(base.identity_flags ?? []), ...(patch.identity_flags ?? [])]),
    allegiance: patch.allegiance ?? base.allegiance ?? undefined,
    previous_allegiance: patch.previous_allegiance ?? base.previous_allegiance ?? undefined,
    resolved_seed_ids: uniqueStrings([...(base.resolved_seed_ids ?? []), ...(patch.resolved_seed_ids ?? [])]),
    resolved_seed_contents: uniqueStrings([
      ...(base.resolved_seed_contents ?? []),
      ...(patch.resolved_seed_contents ?? []),
    ]),
    last_updated_chapter_no: chapterNo,
    source_version_id: versionId,
  };

  if (merged.items_owned?.length && merged.items_missing?.length) {
    const missing = new Set(merged.items_missing);
    merged.items_owned = merged.items_owned.filter((item) => !missing.has(item));
  }

  return merged;
}

function applyStateChange(
  snapshot: CharacterStateSnapshot,
  event: StateChangeEvent,
  chapterNo: number,
  versionId: string,
): CharacterStateSnapshot {
  const next = mergeCharacterSnapshot(snapshot, {}, chapterNo, versionId);
  const value = event.value.trim();

  if (event.category === "inventory") {
    if (event.action === "add" || event.action === "set") {
      next.items_owned = uniqueStrings([...(next.items_owned ?? []), value]);
      next.items_missing = (next.items_missing ?? []).filter((item) => item !== value);
    } else if (event.action === "remove") {
      next.items_missing = uniqueStrings([...(next.items_missing ?? []), value]);
      next.items_owned = (next.items_owned ?? []).filter((item) => item !== value);
    }
    return next;
  }

  if (event.category === "condition") {
    next.condition_flags =
      event.action === "set" ? [value] : uniqueStrings([...(next.condition_flags ?? []), value]);
    next.current_status = value;
    return next;
  }

  if (event.category === "ability") {
    next.ability_flags =
      event.action === "set" ? [value] : uniqueStrings([...(next.ability_flags ?? []), value]);
    return next;
  }

  if (event.category === "identity") {
    next.identity_flags =
      event.action === "set" ? [value] : uniqueStrings([...(next.identity_flags ?? []), value]);
    return next;
  }

  if (event.category === "allegiance") {
    next.previous_allegiance = event.from_value?.trim() || next.allegiance || undefined;
    next.allegiance = value;
    return next;
  }

  if (event.category === "seed" && event.action === "paid_off") {
    next.resolved_seed_ids = uniqueStrings([...(next.resolved_seed_ids ?? []), event.seed_id]);
    next.resolved_seed_contents = uniqueStrings([
      ...(next.resolved_seed_contents ?? []),
      event.seed_content,
      value,
    ]);
  }

  return next;
}

function resolveCharacterId(
  key: string | undefined,
  maps: {
    byId: Map<string, { id: string; name: string }>;
    byName: Map<string, { id: string; name: string }>;
    characters: Array<{ id: string; name: string }>;
  },
) {
  const normalized = key?.trim();
  if (!normalized) return null;
  if (maps.byId.has(normalized)) return maps.byId.get(normalized)?.id ?? null;
  if (maps.byName.has(normalized)) return maps.byName.get(normalized)?.id ?? null;
  return (
    maps.characters.find(
      (character) => character.name.includes(normalized) || normalized.includes(character.name),
    )?.id ?? null
  );
}

export function buildMergedCharacterStateSnapshot(input: {
  previousSnapshot?: Record<string, unknown> | null;
  characters: Array<{ id: string; name: string; current_status?: string | null }>;
  rawSnapshot?: Record<string, unknown>;
  characterStatusUpdates?: ExtractedMemory["character_status_updates"];
  stateChangeEvents?: StateChangeEvent[];
  chapterNo: number;
  versionId: string;
}): Record<string, unknown> {
  const byId = new Map(input.characters.map((character) => [character.id, character]));
  const byName = new Map(input.characters.map((character) => [character.name, character]));
  const state: Record<string, unknown> = {};

  for (const character of input.characters) {
    const legacy =
      input.previousSnapshot?.[character.id] ??
      input.previousSnapshot?.[character.name] ??
      (character.current_status ? { current_status: character.current_status } : {});
    state[character.id] = normalizeCharacterStateSnapshot(legacy);
  }

  state[STORY_STATE_KEY] = normalizeStoryStateSnapshot(input.previousSnapshot?.[STORY_STATE_KEY]);

  for (const [key, value] of Object.entries(input.rawSnapshot ?? {})) {
    const characterId = resolveCharacterId(key, { byId, byName, characters: input.characters });
    if (!characterId) {
      continue;
    }
    state[characterId] = mergeCharacterSnapshot(
      normalizeCharacterStateSnapshot(state[characterId]),
      normalizeCharacterStateSnapshot(value),
      input.chapterNo,
      input.versionId,
    );
  }

  for (const update of input.characterStatusUpdates ?? []) {
    const characterId =
      resolveCharacterId(update.character_id, { byId, byName, characters: input.characters }) ??
      resolveCharacterId(update.character_name, { byId, byName, characters: input.characters });
    if (!characterId || !update.to_status?.trim()) {
      continue;
    }

    state[characterId] = mergeCharacterSnapshot(
      normalizeCharacterStateSnapshot(state[characterId]),
      {
        current_status: update.to_status.trim(),
        condition_flags: [update.to_status.trim()],
      },
      input.chapterNo,
      input.versionId,
    );
  }

  for (const event of input.stateChangeEvents ?? []) {
    if (event.category === "seed" && event.action === "paid_off") {
      const story = normalizeStoryStateSnapshot(state[STORY_STATE_KEY]);
      state[STORY_STATE_KEY] = {
        paid_off_seed_ids: uniqueStrings([...(story.paid_off_seed_ids ?? []), event.seed_id]),
        paid_off_seed_contents: uniqueStrings([
          ...(story.paid_off_seed_contents ?? []),
          event.seed_content,
          event.value,
        ]),
        last_updated_chapter_no: input.chapterNo,
        source_version_id: input.versionId,
      } satisfies StoryStateSnapshot;
    }

    const characterId =
      resolveCharacterId(event.character_id, { byId, byName, characters: input.characters }) ??
      resolveCharacterId(event.character_name, { byId, byName, characters: input.characters });
    if (!characterId) {
      continue;
    }

    state[characterId] = applyStateChange(
      normalizeCharacterStateSnapshot(state[characterId]),
      event,
      input.chapterNo,
      input.versionId,
    );
  }

  return state;
}

export function deriveCurrentStatusFromStateSnapshot(snapshot: unknown): string | null {
  const normalized = normalizeCharacterStateSnapshot(snapshot);
  return normalized.current_status ?? normalized.condition_flags?.[0] ?? null;
}

export function flattenCharacterStateSnapshot(snapshot: unknown): string[] {
  const normalized = normalizeCharacterStateSnapshot(snapshot);
  return uniqueStrings([
    normalized.current_status,
    ...(normalized.items_owned ?? []),
    ...(normalized.items_missing ?? []).map((item) => `失去${item}`),
    ...(normalized.condition_flags ?? []),
    ...(normalized.ability_flags ?? []),
    ...(normalized.identity_flags ?? []),
    normalized.allegiance ? `效力于${normalized.allegiance}` : null,
    normalized.previous_allegiance ? `曾效力于${normalized.previous_allegiance}` : null,
    ...(normalized.resolved_seed_contents ?? []).map((item) => `已兑现:${item}`),
  ]);
}
