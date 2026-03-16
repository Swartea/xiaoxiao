import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { SeedStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { StoryReferenceService } from "../story-resources/story-reference.service";
import { summarizeVersionMeta } from "../chapters/version-meta.util";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeContextBrief(latestStoryContext: {
  id: string;
  stage: string;
  tags: string[];
  context_hash: string;
  context_brief: unknown;
} | null, latestLegacySnapshot: {
  id: string;
  stage: string;
  context_hash: string;
  context: unknown;
} | null) {
  if (latestStoryContext) {
    return {
      snapshot_id: latestStoryContext.id,
      stage: latestStoryContext.stage,
      tags: latestStoryContext.tags,
      context_hash: latestStoryContext.context_hash,
      context_brief: latestStoryContext.context_brief,
      source: "storyos",
    };
  }

  const legacyContext = toRecord(latestLegacySnapshot?.context);
  if (!latestLegacySnapshot || !legacyContext) {
    return null;
  }

  const constraints = toArray<string>(legacyContext.constraints);
  const chapterMission =
    typeof legacyContext.chapter_goal === "string" && legacyContext.chapter_goal.trim().length > 0
      ? legacyContext.chapter_goal
      : "沿当前章节目标推进";
  const mustRemember = [
    typeof legacyContext.bible_summary === "string" ? legacyContext.bible_summary : "",
    ...toArray<Record<string, unknown>>(legacyContext.retrieved_chunks)
      .map((item) => {
        if (typeof item.text === "string") return item.text;
        if (typeof item.summary === "string") return item.summary;
        return "";
      })
      .filter(Boolean)
      .slice(0, 6),
  ];

  return {
    snapshot_id: latestLegacySnapshot.id,
    stage: latestLegacySnapshot.stage,
    tags: [] as string[],
    context_hash: latestLegacySnapshot.context_hash,
    context_brief: {
      chapter_mission: chapterMission,
      must_remember: mustRemember,
      must_not_violate: constraints,
      active_relationships: [] as string[],
      payoff_targets: [] as string[],
      danger_points: [] as string[],
    },
    source: "legacy_generation",
  };
}

function normalizeContinuityReport(
  latestContinuity: {
    id: string;
    report: unknown;
    overall_pass: boolean;
    created_at: Date;
    version_id: string;
  } | null,
  latestLegacyReport: {
    id: string;
    report: unknown;
    created_at: Date;
    version_id: string;
  } | null,
) {
  if (latestContinuity) {
    return latestContinuity;
  }

  if (!latestLegacyReport) {
    return null;
  }

  return {
    id: latestLegacyReport.id,
    report: {
      raw: latestLegacyReport.report,
    },
    overall_pass: false,
    created_at: latestLegacyReport.created_at,
    version_id: latestLegacyReport.version_id,
    source: "legacy_consistency",
  };
}

function extractRawContinuityPayload(continuityReport: { report?: unknown } | null) {
  const report = toRecord(continuityReport?.report);
  const raw = toRecord(report?.raw);
  return raw ?? report ?? null;
}

function buildRuleHits(continuityReport: { report?: unknown } | null) {
  const raw = extractRawContinuityPayload(continuityReport);
  const rawIssues = toArray<Record<string, unknown>>(raw?.issues);
  return rawIssues.filter((issue) =>
    ["sensitive_word_hit", "regex_rule_hit", "confirmed_reference_missing"].includes(String(issue.type ?? "")),
  );
}

function buildHotResources(chapterReferences: {
  references: Record<string, unknown[]>;
}) {
  return Object.entries(chapterReferences.references)
    .flatMap(([group, items]) =>
      toArray<Record<string, unknown>>(items).map((item) => ({
        group,
        item,
        total_hits: Number(toRecord(item.stats)?.total_hits ?? item.occurrence_count ?? 0),
      })),
    )
    .sort((a, b) => b.total_hits - a.total_hits)
    .slice(0, 6);
}

function toScore(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function truncateText(value: string, maxLength = 60) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 6) {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function buildPublishReadiness(args: {
  latestQuality: Record<string, unknown> | null;
  continuity: { overall_pass?: boolean; report?: unknown } | null;
  director: Record<string, unknown> | null;
  chapter: {
    goal?: string | null;
    conflict?: string | null;
    cliffhanger?: string | null;
  };
  latestIntent: {
    chapter_mission: string;
    advance_goal: string | null;
    conflict_target: string | null;
    hook_target: string | null;
    pacing_direction: string | null;
  } | null;
}) {
  if (!args.latestQuality) {
    return {
      status: "pending",
      label: "待评估",
      summary: "先运行主流程或质量评估，再判断这一章是否适合发布。",
      strongest_point: "暂无评估结果",
      top_actions: ["先完成主流程或质量评估", "补齐本章意图，避免生成目标漂移"],
      risk_notes: ["当前缺少可发布判断依据"],
      overall_score: null,
    };
  }

  const qualityPayload = toRecord(args.latestQuality.report);
  const qualityMap = toRecord(qualityPayload?.quality);
  const dimensions = [
    {
      key: "opening_hook",
      label: "开头钩子",
      score:
        toScore(toRecord(qualityMap?.opening_hook)?.score) ||
        toScore(args.latestQuality.opening_hook),
      reason: String(toRecord(qualityMap?.opening_hook)?.reason ?? ""),
    },
    {
      key: "conflict_strength",
      label: "冲突推进",
      score:
        toScore(toRecord(qualityMap?.conflict_strength)?.score) ||
        toScore(args.latestQuality.conflict_strength),
      reason: String(toRecord(qualityMap?.conflict_strength)?.reason ?? ""),
    },
    {
      key: "pacing",
      label: "节奏控制",
      score:
        toScore(toRecord(qualityMap?.pacing)?.score) ||
        toScore(args.latestQuality.pacing),
      reason: String(toRecord(qualityMap?.pacing)?.reason ?? ""),
    },
    {
      key: "dialogue_quality",
      label: "对白可读性",
      score:
        toScore(toRecord(qualityMap?.dialogue_quality)?.score) ||
        toScore(args.latestQuality.dialogue_quality),
      reason: String(toRecord(qualityMap?.dialogue_quality)?.reason ?? ""),
    },
    {
      key: "ending_hook",
      label: "结尾钩子",
      score:
        toScore(toRecord(qualityMap?.ending_hook)?.score) ||
        toScore(args.latestQuality.ending_hook),
      reason: String(toRecord(qualityMap?.ending_hook)?.reason ?? ""),
    },
  ];

  const overallScore = toScore(args.latestQuality.overall_score);
  const continuityPayload = extractRawContinuityPayload(args.continuity);
  const continuityIssues = toArray<Record<string, unknown>>(continuityPayload?.issues);
  const continuityLabels = uniqueStrings(
    continuityIssues.slice(0, 3).map((issue) => String(issue.message ?? "")),
    3,
  );
  const strongestDimension = dimensions
    .slice()
    .sort((a, b) => b.score - a.score)[0];
  const weakestDimensions = dimensions
    .filter((item) => item.score > 0)
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  let status = "revise";
  let label = "建议小修";
  if (
    overallScore >= 7 &&
    args.continuity?.overall_pass !== false &&
    String(args.director?.decision ?? "") === "accept"
  ) {
    status = "ready";
    label = "可发布";
  } else if (overallScore < 5.5) {
    status = "rework";
    label = "建议重做";
  }

  const topActions = uniqueStrings(
    [
      ...weakestDimensions.map((item) =>
        item.reason
          ? `优先补强${item.label}：${item.reason}`
          : `优先补强${item.label}`,
      ),
      typeof args.director?.hook_upgrade === "string" ? `总编建议：${args.director.hook_upgrade}` : "",
      typeof args.director?.arc_correction === "string" ? `主线修正：${args.director.arc_correction}` : "",
      typeof args.latestIntent?.conflict_target === "string" && args.latestIntent.conflict_target
        ? `对齐本章冲突目标：${args.latestIntent.conflict_target}`
        : "",
      continuityLabels[0] ? `先处理连续性问题：${continuityLabels[0]}` : "",
    ],
    3,
  );

  const riskNotes = uniqueStrings(
    [
      ...continuityLabels,
      typeof args.chapter.cliffhanger === "string" ? `章节尾悬念：${args.chapter.cliffhanger}` : "",
      typeof args.latestIntent?.hook_target === "string" && args.latestIntent.hook_target
        ? `既定钩子目标：${args.latestIntent.hook_target}`
        : "",
    ],
    4,
  );

  const summary =
    status === "ready"
      ? "这一章已经接近发布线，建议只做局部微调后进入下一章。"
      : status === "rework"
        ? "这章的核心爽点和推进力还不够，建议回到意图层重整再生成。"
        : "这章可读性已成型，但发布前最好集中修掉最影响追更欲的 2-3 处。";

  return {
    status,
    label,
    summary,
    strongest_point: strongestDimension
      ? `${strongestDimension.label}最强（${strongestDimension.score.toFixed(1)}分）`
      : "暂无突出卖点",
    top_actions:
      topActions.length > 0
        ? topActions
        : ["先补强冲突升级", "再检查结尾钩子", "最后清理一致性问题"],
    risk_notes: riskNotes,
    overall_score: overallScore,
  };
}

function buildRelationshipChanges(chapterReferences: {
  references: Record<string, unknown[]>;
}) {
  return uniqueStrings(
    toArray<Record<string, unknown>>(chapterReferences.references.relationships).map((item) => {
      const resource = toRecord(item.resource);
      const fromCharacter = toRecord(resource?.fromCharacter);
      const toCharacter = toRecord(resource?.toCharacter);
      const relationType = String(resource?.relation_type ?? "");
      const fromName = String(fromCharacter?.name ?? "");
      const toName = String(toCharacter?.name ?? "");
      if (!fromName && !toName) {
        return "";
      }
      return `${fromName || "角色A"}-${toName || "角色B"}${relationType ? `（${relationType}）` : ""}`;
    }),
    5,
  );
}

function buildHandoffBrief(args: {
  chapter: {
    chapter_no: number;
    goal?: string | null;
    conflict?: string | null;
    cliffhanger?: string | null;
  };
  latestMemory: {
    summary?: string | null;
  } | null;
  latestIntent: {
    chapter_mission: string;
    advance_goal: string | null;
    conflict_target: string | null;
    hook_target: string | null;
    pacing_direction: string | null;
  } | null;
  contextBrief: {
    context_brief?: unknown;
  } | null;
  activeSeeds: Array<{ content: string; planted_chapter_no: number; status: SeedStatus }>;
  chapterReferences: {
    references: Record<string, unknown[]>;
  };
  director: Record<string, unknown> | null;
}) {
  const brief = toRecord(args.contextBrief?.context_brief);
  const dangerPoints = toArray<string>(brief?.danger_points);
  const activeRelationships = toArray<string>(brief?.active_relationships);
  const unresolvedSeeds = args.activeSeeds
    .slice()
    .sort((a, b) => b.planted_chapter_no - a.planted_chapter_no)
    .map((seed) => truncateText(seed.content, 48));
  const relationshipChanges = uniqueStrings(
    [...activeRelationships, ...buildRelationshipChanges(args.chapterReferences)],
    5,
  );
  const chapterTakeaways = uniqueStrings(
    [
      args.latestMemory?.summary ?? "",
      args.latestIntent?.chapter_mission ?? "",
      args.latestIntent?.advance_goal ?? "",
      typeof args.chapter.goal === "string" ? args.chapter.goal : "",
      typeof args.chapter.conflict === "string" ? `本章冲突：${args.chapter.conflict}` : "",
    ],
    4,
  );
  const carryOverPressure = uniqueStrings(
    [
      typeof args.chapter.cliffhanger === "string" ? args.chapter.cliffhanger : "",
      args.latestIntent?.hook_target ?? "",
      typeof args.director?.arc_correction === "string" ? args.director.arc_correction : "",
      ...dangerPoints,
    ],
    4,
  );

  const nextOpeningOptions = uniqueStrings(
    [
      args.chapter.cliffhanger
        ? `开篇先承接“${truncateText(args.chapter.cliffhanger, 24)}”的即时后果，再推进新冲突。`
        : "",
      unresolvedSeeds[0] ? `用“${truncateText(unresolvedSeeds[0], 20)}”做开篇提醒，制造连续追更感。` : "",
      args.latestIntent?.conflict_target
        ? `下一章一开场就把压力拉向“${truncateText(args.latestIntent.conflict_target, 22)}”。`
        : "",
    ],
    3,
  );

  return {
    chapter_takeaways: chapterTakeaways,
    unresolved_seeds: unresolvedSeeds.slice(0, 5),
    relationship_changes: relationshipChanges,
    carry_over_pressure: carryOverPressure,
    next_opening_options: nextOpeningOptions,
  };
}

function stageFromAgentRun(run: Record<string, any>) {
  const agentName = String(run.agent_name ?? "");
  if (agentName === "QualityAgent") return "quality_eval";
  if (agentName === "DirectorAgent") return "director";
  if (agentName === "AdaptationAgent") return "adaptation";
  if (agentName === "FixAgent") return "fix";

  const version = toRecord(run.version);
  if (typeof version?.stage === "string" && version.stage.trim()) {
    return version.stage;
  }

  if (agentName === "BeatAgent") return "beats";
  if (agentName === "DraftAgent") return "draft";
  if (agentName === "PolishAgent") return "polish";
  return null;
}

function buildPromptTrace(agentRuns: Array<Record<string, any>>) {
  const traces: Array<Record<string, unknown>> = [];
  const seenStages = new Set<string>();

  for (const run of agentRuns) {
    const stage = stageFromAgentRun(run);
    if (!stage || seenStages.has(stage)) {
      continue;
    }
    seenStages.add(stage);

    const promptTemplateVersion = toRecord(run.promptTemplateVersion);
    const promptTemplate = toRecord(promptTemplateVersion?.promptTemplate);
    const inputPayload = toRecord(run.input_payload);
    traces.push({
      stage,
      agent_name: run.agent_name,
      prompt_name:
        typeof run.prompt_name === "string" && run.prompt_name.trim()
          ? run.prompt_name
          : typeof promptTemplate?.prompt_name === "string"
            ? promptTemplate.prompt_name
            : null,
      prompt_version: typeof run.prompt_version === "string" ? run.prompt_version : null,
      prompt_template_version_id:
        typeof run.prompt_template_version_id === "string" ? run.prompt_template_version_id : null,
      platform_variant: typeof run.platform_variant === "string" ? run.platform_variant : null,
      style_preset_name:
        typeof run.style_preset === "string" && run.style_preset.trim() ? run.style_preset : null,
      model: typeof run.model === "string" ? run.model : null,
      context_hash: typeof run.context_hash === "string" ? run.context_hash : null,
      input_summary: toRecord(inputPayload?.prompt_input_summary) ?? inputPayload?.prompt_input_summary ?? null,
      created_at: run.created_at ?? null,
    });
  }

  return traces;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryReferenceService) private readonly storyReferenceService: StoryReferenceService,
  ) {}

  async getWorkspace(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { project: true },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const [
      latestVersion,
      versions,
      latestLegacySnapshot,
      latestLegacyReport,
      latestMemory,
      qualityReports,
      latestDirector,
      recentFixTasks,
      latestStoryContext,
      latestContinuity,
      latestIntent,
      latestAgentRuns,
    ] = await Promise.all([
      this.prisma.chapterVersion.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
        select: {
          id: true,
          version_no: true,
          stage: true,
          created_at: true,
          parent_version_id: true,
          meta: true,
          text: true,
        },
      }),
      this.prisma.chapterVersion.findMany({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
        select: {
          id: true,
          version_no: true,
          stage: true,
          created_at: true,
          parent_version_id: true,
          meta: true,
        },
      }),
      this.prisma.generationContextSnapshot.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.consistencyReport.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.chapterMemory.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.qualityReport.findMany({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
        take: 3,
      }),
      this.prisma.directorReview.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.fixTask.findMany({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
        take: 8,
      }),
      this.prisma.contextSnapshot.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.continuityReport.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.chapterIntent.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
      }),
      this.prisma.agentRun.findMany({
        where: {
          chapter_id: chapterId,
          version_id: { not: null },
        },
        include: {
          version: {
            select: {
              stage: true,
              version_no: true,
            },
          },
          promptTemplateVersion: {
            include: {
              promptTemplate: {
                select: {
                  prompt_name: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: 24,
      }),
    ]);

    const sourceVersionId = latestVersion?.id;
    const versionSummaries = versions.map((version) => summarizeVersionMeta(version));
    const latestVersionSummary = latestVersion ? summarizeVersionMeta(latestVersion) : null;
    const normalizedContinuity = normalizeContinuityReport(latestContinuity, latestLegacyReport);
    const qualityTrend = qualityReports
      .slice()
      .reverse()
      .map((item) => ({ version_id: item.version_id, overall_score: item.overall_score }));

    const [facts, seeds, timeline, activeSeeds, resourceReferences] = await Promise.all([
      sourceVersionId
        ? this.prisma.fact.findMany({ where: { source_version_id: sourceVersionId }, orderBy: { content: "asc" } })
        : Promise.resolve([]),
      sourceVersionId
        ? this.prisma.seed.findMany({ where: { source_version_id: sourceVersionId }, orderBy: { content: "asc" } })
        : Promise.resolve([]),
      sourceVersionId
        ? this.prisma.timelineEvent.findMany({
            where: { source_version_id: sourceVersionId },
            orderBy: { chapter_no_ref: "asc" },
          })
        : Promise.resolve([]),
      this.prisma.seed.findMany({
        where: {
          project_id: chapter.project_id,
          status: { in: [SeedStatus.planted, SeedStatus.in_progress] },
        },
        orderBy: { planted_chapter_no: "desc" },
        take: 8,
      }),
      this.storyReferenceService.getChapterReferences(chapter.project_id, chapterId),
    ]);
    const contextBrief = normalizeContextBrief(latestStoryContext, latestLegacySnapshot);
    const hotResources = buildHotResources(resourceReferences);
    const latestQuality = qualityReports[0] ?? null;
    const promptTrace = buildPromptTrace(latestAgentRuns as unknown as Array<Record<string, any>>);
    const publishReadiness = buildPublishReadiness({
      latestQuality: latestQuality ? (latestQuality as unknown as Record<string, unknown>) : null,
      continuity: normalizedContinuity,
      director: latestDirector ? (latestDirector as unknown as Record<string, unknown>) : null,
      chapter,
      latestIntent: latestIntent
        ? {
            chapter_mission: latestIntent.chapter_mission,
            advance_goal: latestIntent.advance_goal,
            conflict_target: latestIntent.conflict_target,
            hook_target: latestIntent.hook_target,
            pacing_direction: latestIntent.pacing_direction,
          }
        : null,
    });
    const handoffBrief = buildHandoffBrief({
      chapter,
      latestMemory,
      latestIntent: latestIntent
        ? {
            chapter_mission: latestIntent.chapter_mission,
            advance_goal: latestIntent.advance_goal,
            conflict_target: latestIntent.conflict_target,
            hook_target: latestIntent.hook_target,
            pacing_direction: latestIntent.pacing_direction,
          }
        : null,
      contextBrief,
      activeSeeds,
      chapterReferences: resourceReferences,
      director: latestDirector ? (latestDirector as unknown as Record<string, unknown>) : null,
    });

    return {
      chapter,
      latest_version: latestVersionSummary,
      latest_version_text: latestVersion?.text ?? "",
      versions: versionSummaries,
      latest_intent: latestIntent,
      publish_readiness: publishReadiness,
      handoff_brief: handoffBrief,
      generation_context_snapshot: latestLegacySnapshot,
      story_context_snapshot: latestStoryContext,
      context_brief: contextBrief,
      continuity_report: normalizedContinuity,
      legacy_consistency_report: latestLegacyReport,
      quality_report: latestQuality,
      director_review: latestDirector,
      fix_tasks: recentFixTasks,
      quality_trend: qualityTrend,
      chapter_memory: latestMemory,
      resource_references: resourceReferences,
      resource_summary: resourceReferences.summary,
      prompt_trace: promptTrace,
      diagnostics: {
        chapter_id: chapter.id,
        latest_quality: latestQuality,
        quality_trend: qualityTrend,
        continuity: normalizedContinuity,
        rule_hits: buildRuleHits(normalizedContinuity),
        director: latestDirector,
        fix_actions: recentFixTasks,
        versions: versionSummaries.slice(0, 6),
        latest_intent: latestIntent,
        publish_readiness: publishReadiness,
        handoff_brief: handoffBrief,
        context_snapshot: contextBrief,
        resource_references: resourceReferences,
        resource_reference_summary: resourceReferences.summary,
        hot_resources: hotResources,
        prompt_trace: promptTrace,
      },
      extracted_items: {
        facts,
        seeds,
        timeline,
      },
    };
  }
}
