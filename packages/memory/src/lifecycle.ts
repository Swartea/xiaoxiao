import type {
  ExtractedMemoryValidationInput,
  ExtractedMemoryValidationResult,
  MemoryLifecycleStatus,
} from "./types";

const RETRIEVABLE_MEMORY_STATUSES: MemoryLifecycleStatus[] = ["confirmed"];

const CONTRADICTION_PAIRS = [
  { left: ["活着", "存活", "未死"], right: ["死了", "死亡", "身亡"] },
  { left: ["受伤", "伤重", "负伤"], right: ["痊愈", "恢复", "康复"] },
  { left: ["中毒"], right: ["解毒", "毒解"] },
  { left: ["昏迷"], right: ["清醒", "苏醒"] },
  { left: ["失去", "丢了"], right: ["拥有", "持有", "带着"] },
  { left: ["隐瞒", "保密"], right: ["公开", "暴露"] },
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、“”"'`~,.!?;:()（）【】\[\]<>《》]/g, "");
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return out;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectStrings(nested, out);
    }
  }

  return out;
}

function containsPairConflict(left: string, right: string) {
  return CONTRADICTION_PAIRS.some((pair) => {
    const leftHasA = pair.left.some((token) => left.includes(token));
    const leftHasB = pair.right.some((token) => left.includes(token));
    const rightHasA = pair.left.some((token) => right.includes(token));
    const rightHasB = pair.right.some((token) => right.includes(token));
    return (leftHasA && rightHasB) || (leftHasB && rightHasA);
  });
}

function sharedCharacterNames(texts: string[], characterNames: string[]) {
  return characterNames.filter((name) => name && texts.every((text) => text.includes(name)));
}

function conflictsWithReference(args: {
  candidate: string;
  reference: string;
  sharedNames: string[];
  timeMark?: string | null;
  referenceTimeMark?: string | null;
}) {
  if (normalizeText(args.candidate) === normalizeText(args.reference)) {
    return false;
  }

  const strongSubjectMatch =
    args.sharedNames.length > 0 ||
    (!!args.timeMark && !!args.referenceTimeMark && args.timeMark.trim() === args.referenceTimeMark.trim());

  if (!strongSubjectMatch) {
    return false;
  }

  return containsPairConflict(args.candidate, args.reference);
}

export function isRetrievableMemoryStatus(status: MemoryLifecycleStatus | string | null | undefined) {
  return status === "confirmed";
}

export function getRetrievableMemoryStatuses(): MemoryLifecycleStatus[] {
  return [...RETRIEVABLE_MEMORY_STATUSES];
}

export function validateExtractedMemoryLifecycle(
  input: ExtractedMemoryValidationInput,
): ExtractedMemoryValidationResult[] {
  const characterNames = input.characters.map((character) => character.name).filter(Boolean);
  const snapshotByCharacter = new Map<string, string[]>();

  for (const character of input.characters) {
    const snapshot = input.character_state_snapshot?.[character.id];
    snapshotByCharacter.set(character.name, [
      ...(character.current_status ? [character.current_status] : []),
      ...collectStrings(snapshot),
    ]);
  }

  return input.candidates.map((candidate) => {
    const reasons: string[] = [];

    const duplicateFact = input.confirmed_facts.find(
      (fact) => normalizeText(fact.content) === normalizeText(candidate.content),
    );
    if (duplicateFact) {
      return {
        id: candidate.id,
        kind: candidate.kind,
        status: "superseded",
        reasons: [`duplicate_confirmed_fact:${duplicateFact.id}`],
      };
    }

    const duplicateSeed = input.confirmed_seeds.find(
      (seed) => normalizeText(seed.content) === normalizeText(candidate.content),
    );
    if (duplicateSeed) {
      return {
        id: candidate.id,
        kind: candidate.kind,
        status: "superseded",
        reasons: [`duplicate_confirmed_seed:${duplicateSeed.id}`],
      };
    }

    const duplicateTimeline = input.confirmed_timeline.find(
      (event) =>
        normalizeText(`${event.time_mark}|${event.event}`) ===
        normalizeText(`${candidate.time_mark ?? ""}|${candidate.content}`),
    );
    if (duplicateTimeline) {
      return {
        id: candidate.id,
        kind: candidate.kind,
        status: "superseded",
        reasons: [`duplicate_confirmed_timeline:${duplicateTimeline.id}`],
      };
    }

    for (const rule of input.world_rules) {
      const sharedNames = sharedCharacterNames([candidate.content, rule], characterNames);
      if (conflictsWithReference({ candidate: candidate.content, reference: rule, sharedNames })) {
        reasons.push(`world_rule_conflict:${rule.slice(0, 32)}`);
      }
    }

    for (const fact of input.confirmed_facts) {
      const sharedNames = sharedCharacterNames([candidate.content, fact.content], characterNames);
      if (conflictsWithReference({ candidate: candidate.content, reference: fact.content, sharedNames })) {
        reasons.push(`confirmed_fact_conflict:${fact.id}`);
      }
    }

    for (const event of input.confirmed_timeline) {
      const reference = `${event.time_mark} ${event.event}`;
      const sharedNames = sharedCharacterNames([candidate.content, reference], characterNames);
      if (
        conflictsWithReference({
          candidate: candidate.content,
          reference,
          sharedNames,
          timeMark: candidate.time_mark,
          referenceTimeMark: event.time_mark,
        })
      ) {
        reasons.push(`timeline_conflict:${event.id}`);
      }
    }

    for (const character of input.characters) {
      if (!candidate.content.includes(character.name)) {
        continue;
      }

      const statusCandidates = snapshotByCharacter.get(character.name) ?? [];
      for (const statusText of statusCandidates) {
        if (
          conflictsWithReference({
            candidate: candidate.content,
            reference: `${character.name}${statusText}`,
            sharedNames: [character.name],
          })
        ) {
          reasons.push(`character_state_conflict:${character.id}`);
        }
      }
    }

    return {
      id: candidate.id,
      kind: candidate.kind,
      status: reasons.length > 0 ? "rejected" : "confirmed",
      reasons,
    };
  });
}
