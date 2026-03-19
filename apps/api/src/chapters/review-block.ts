import { ChapterStatus } from "@prisma/client";
import type { ContinuityReport as RawContinuityReport } from "@novel-factory/shared";
import type { ChapterEvaluation } from "@novel-factory/storyos-domain";
import { filterBlockingEvaluationContinuityDetails } from "../storyos/continuity-evaluation";

export type ReviewBlockSource = "continuity_fail" | "fix_exhaustion" | "quality_fail" | "manual";

export type ChapterReviewBlockMeta = {
  source: ReviewBlockSource;
  previous_status: ChapterStatus;
  version_id?: string | null;
  report_id?: string | null;
  director_review_id?: string | null;
  details?: string[];
  blocked_at: string;
};

const RESUMABLE_CHAPTER_STATUSES = new Set<ChapterStatus>([
  ChapterStatus.outline,
  ChapterStatus.draft,
  ChapterStatus.final,
]);

const SEVERE_CONTINUITY_PATTERNS = [
  "glossary_conflict",
  "ability_conflict",
  "time_conflict",
  "timeline",
  "character_ooc",
  "inventory_regression",
  "condition_regression",
  "ability_regression",
  "identity_regression",
  "allegiance_regression",
];

export function isBlockedReviewChapter(chapter: { status: ChapterStatus | string | null | undefined }) {
  return chapter.status === ChapterStatus.blocked_review || chapter.status === "blocked_review";
}

export function normalizeReviewBlockMeta(meta: unknown): ChapterReviewBlockMeta | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }

  const record = meta as Record<string, unknown>;
  const previousStatus = record.previous_status;
  if (typeof previousStatus !== "string" || !Object.values(ChapterStatus).includes(previousStatus as ChapterStatus)) {
    return null;
  }

  return {
    source:
      record.source === "continuity_fail" ||
      record.source === "fix_exhaustion" ||
      record.source === "quality_fail" ||
      record.source === "manual"
        ? record.source
        : "manual",
    previous_status: previousStatus as ChapterStatus,
    version_id: typeof record.version_id === "string" ? record.version_id : null,
    report_id: typeof record.report_id === "string" ? record.report_id : null,
    director_review_id: typeof record.director_review_id === "string" ? record.director_review_id : null,
    details: Array.isArray(record.details) ? record.details.filter((item): item is string => typeof item === "string") : [],
    blocked_at: typeof record.blocked_at === "string" ? record.blocked_at : new Date().toISOString(),
  };
}

export function resolveReviewResumeStatus(meta: unknown, fallback = ChapterStatus.draft) {
  const normalized = normalizeReviewBlockMeta(meta);
  if (normalized && RESUMABLE_CHAPTER_STATUSES.has(normalized.previous_status)) {
    return normalized.previous_status;
  }
  return fallback;
}

export function detectSevereConsistencyBlock(report: RawContinuityReport) {
  const severeIssues = report.issues.filter(
    (issue) =>
      issue.severity === "high" ||
      SEVERE_CONTINUITY_PATTERNS.some((pattern) => issue.type.toLowerCase().includes(pattern)),
  );

  if (severeIssues.length === 0) {
    return null;
  }

  return {
    source: "continuity_fail" as const,
    reason: `严重一致性冲突：${severeIssues[0].message}`,
    details: severeIssues.slice(0, 4).map((issue) => issue.message),
  };
}

export function detectSevereEvaluationContinuity(evaluation: ChapterEvaluation) {
  const details = filterBlockingEvaluationContinuityDetails([
    ...evaluation.continuity.world_rule_conflict,
    ...evaluation.continuity.timeline_conflict,
    ...evaluation.continuity.character_ooc,
  ].filter(Boolean));

  if (details.length === 0) {
    return null;
  }

  return {
    source: "continuity_fail" as const,
    reason: `严重 continuity 冲突：${details[0]}`,
    details: details.slice(0, 4),
  };
}

export function buildFixExhaustionBlock(args: {
  rounds: number;
  passThreshold: number;
  overallScore: number;
  summary: string;
  diagnostics?: Array<{ issue_type: string; reason: string }>;
}) {
  return {
    source: "fix_exhaustion" as const,
    reason: `自动修复已达 ${args.rounds} 轮，仍未通过阈值 ${args.passThreshold}。`,
    details: [
      `当前分数 ${args.overallScore.toFixed(2)} / 目标 ${args.passThreshold}`,
      args.summary,
      ...(args.diagnostics ?? []).slice(0, 2).map((item) => `${item.issue_type}: ${item.reason}`),
    ].filter(Boolean),
  };
}

export function buildQualityFailBlock(args: { summary: string; diagnostics?: Array<{ issue_type: string; reason: string }> }) {
  return {
    source: "quality_fail" as const,
    reason: "质量评审建议人工处理后再继续自动链路。",
    details: [args.summary, ...(args.diagnostics ?? []).slice(0, 3).map((item) => `${item.issue_type}: ${item.reason}`)].filter(Boolean),
  };
}
