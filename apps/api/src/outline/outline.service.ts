import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { sha256FromCanonicalJson } from "@novel-factory/memory";
import { PrismaService } from "../prisma.service";
import { DEFAULT_CHAPTER_WORD_TARGET } from "../chapters/chapter-length";
import {
  ChapterOutlineWorkspaceItemDto,
  PatchOutlineDto,
  PatchOutlineWorkspaceDto,
  StageOutlineWorkspaceItemDto,
  StorySpineDto,
} from "./dto";
import {
  OUTLINE_WORKSPACE_KEY,
  determineStageNo,
  deriveStagePosition,
  formatChapterDisplayTitle,
  hasWeakTextOverlap,
  normalizeChapterOutlineMeta,
  normalizeChapterStoredTitle,
  normalizeRecord,
  normalizeStageMetaData,
  normalizeStorySpineData,
  type OutlineDiagnostic,
} from "./outline-workspace";

const ROLE_OPTIONS = ["mentor", "rival", "antagonist", "gatekeeper", "ally", "burden"] as const;
const CHAPTER_POSITION_OPTIONS = ["开局章", "推进章", "转折章", "高潮章", "收束章"] as const;

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function dedupeStrings(items: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
}

function tokenizeInlineText(value: string | null | undefined) {
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

function hasTextOverlap(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = tokenizeInlineText(left);
  const rightTokens = tokenizeInlineText(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }
  return leftTokens.some((token) => rightTokens.includes(token));
}

function hasTextOverlapWithList(value: string | null | undefined, items: string[]) {
  return items.some((item) => hasTextOverlap(value, item));
}

function formatNumberedInline(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join(" ");
}

@Injectable()
export class OutlineService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const found = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!found) {
      throw new NotFoundException("Project not found");
    }
    return found;
  }

  private sanitizeString(value?: string | null) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private sanitizeStringArray(value?: string[] | null) {
    return dedupeStrings(value ?? []);
  }

  private pickLatestByKey<T>(items: T[], keyOf: (item: T) => string) {
    const map = new Map<string, T>();
    for (const item of items) {
      const key = keyOf(item);
      if (!map.has(key)) {
        map.set(key, item);
      }
    }
    return map;
  }

  private readOutlineWorkspaceRoot(value: unknown) {
    const record = normalizeRecord(value);
    return normalizeRecord(record[OUTLINE_WORKSPACE_KEY]);
  }

  private readStorySpineFromBlueprint(blueprint: {
    world_rule_map: Prisma.JsonValue | null;
    main_conflict: string | null;
    core_suspense: string | null;
    book_positioning: string | null;
    selling_points: string[];
  } | null) {
    const outlineRoot = this.readOutlineWorkspaceRoot(blueprint?.world_rule_map);
    const saved = normalizeStorySpineData(outlineRoot.story_spine);
    return {
      logline: saved.logline,
      main_conflict: saved.main_conflict ?? blueprint?.main_conflict ?? null,
      protagonist_long_goal: saved.protagonist_long_goal,
      external_pressure: saved.external_pressure,
      internal_conflict: saved.internal_conflict,
      central_question: saved.central_question ?? blueprint?.core_suspense ?? null,
      ending_direction: saved.ending_direction,
      ending_cost: saved.ending_cost,
      story_promise: saved.story_promise ?? blueprint?.book_positioning ?? blueprint?.selling_points?.[0] ?? null,
      theme_statement: saved.theme_statement,
      non_drift_constraints: saved.non_drift_constraints,
      source_snapshot: saved.source_snapshot,
    };
  }

  private buildSettingSourceSnapshot(args: {
    project: { genre: string | null; target_platform: string | null };
    firstCharacter?: { motivation: string | null; personality: string | null; personality_tags: string | null } | null;
    rules: Array<{ name: string; constraints: string | null; description: string | null }>;
    blueprint: {
      book_positioning: string | null;
      selling_points: string[];
    } | null;
  }) {
    return {
      genre: args.project.genre ?? null,
      protagonist_goal: args.firstCharacter?.motivation ?? null,
      tone: dedupeStrings([args.blueprint?.book_positioning ?? null, ...(args.blueprint?.selling_points ?? [])]).join(" / ") || null,
      protagonist_tension:
        dedupeStrings([args.firstCharacter?.personality_tags ?? null, args.firstCharacter?.personality ?? null]).join(" / ") || null,
      world_rules: dedupeStrings(
        args.rules.map((item) => [item.name, item.constraints ?? item.description ?? ""].filter(Boolean).join("：")),
      ),
    };
  }

  private buildSettingImpacts(args: {
    savedSnapshot: Record<string, unknown> | null;
    currentSnapshot: Record<string, unknown>;
    stages: Array<{ phase_no: number }>;
    chapters: Array<{ chapter_no: number }>;
  }) {
    if (!args.savedSnapshot) {
      return [] as Array<{
        key: string;
        label: string;
        previous: string | null;
        current: string | null;
        affected_stage_nos: number[];
        affected_chapter_nos: number[];
      }>;
    }

    const labels: Record<string, string> = {
      genre: "题材类型",
      protagonist_goal: "主角目标",
      tone: "风格基调",
      protagonist_tension: "主角状态约束",
      world_rules: "世界规则",
    };

    const impacts: Array<{
      key: string;
      label: string;
      previous: string | null;
      current: string | null;
      affected_stage_nos: number[];
      affected_chapter_nos: number[];
    }> = [];

    for (const key of Object.keys(labels)) {
      const previousValue = args.savedSnapshot[key];
      const currentValue = args.currentSnapshot[key];
      const previous = Array.isArray(previousValue) ? previousValue.join(" / ") : typeof previousValue === "string" ? previousValue : null;
      const current = Array.isArray(currentValue) ? currentValue.join(" / ") : typeof currentValue === "string" ? currentValue : null;
      if ((previous ?? "") === (current ?? "")) {
        continue;
      }
      impacts.push({
        key,
        label: labels[key],
        previous,
        current,
        affected_stage_nos: args.stages.map((item) => item.phase_no),
        affected_chapter_nos: args.chapters.map((item) => item.chapter_no),
      });
    }

    return impacts;
  }

  private deriveStageRanges<T extends { phase_no: number; chapter_range_start: number | null; chapter_range_end: number | null; milestone_chapter_no: number | null }>(
    stages: T[],
    maxChapterNo: number,
  ) {
    return stages.map((stage, index) => {
      const previous = stages[index - 1];
      const next = stages[index + 1];
      const start = stage.chapter_range_start ?? (previous?.chapter_range_end ? previous.chapter_range_end + 1 : 1);
      const fallbackEnd = stage.chapter_range_end ?? stage.milestone_chapter_no ?? (next?.chapter_range_start ? next.chapter_range_start - 1 : null);
      const nextMilestone = next?.milestone_chapter_no ?? null;
      const end =
        fallbackEnd ??
        (nextMilestone && nextMilestone > start ? nextMilestone - 1 : index === stages.length - 1 ? maxChapterNo || start : start);

      return {
        ...stage,
        chapter_range_start: start,
        chapter_range_end: end && end >= start ? end : start,
      };
    });
  }

  private buildDiagnostics(args: {
    storySpine: ReturnType<OutlineService["readStorySpineFromBlueprint"]>;
    stages: Array<{
      phase_no: number;
      stage_function: string | null;
      stage_goal: string | null;
      ending_state: { protagonist_state: string | null; relationship_state: string | null; world_state: string | null };
      stage_cost: string | null;
      no_drift_constraints: string[];
      chapter_count: number;
      midpoint_change: string | null;
      climax: string | null;
      completion_criteria: string | null;
      assigned_chapter_nos: number[];
      title: string;
    }>;
    chapters: Array<{
      chapter_no: number;
      goal: string | null;
      chapter_function: string | null;
      core_conflict: string | null;
      key_events: string[];
      scene_progression: string[];
      key_takeaways: string[];
      relationship_changes: string[];
      ending_hook: string | null;
      character_change: string | null;
      information_reveal: string | null;
      strategy_judgment: string | null;
      stage_no: number | null;
      stage_goal: string | null;
      stage_conflict: string | null;
      stage_position: string | null;
    }>;
    settingImpacts: Array<{ key: string; label: string; affected_stage_nos: number[]; affected_chapter_nos: number[] }>;
  }) {
    const diagnostics: OutlineDiagnostic[] = [];

    if (!args.storySpine.main_conflict) {
      diagnostics.push({
        scope: "story_spine",
        level: "warn",
        code: "story-main-conflict-missing",
        title: "主线冲突缺失",
        message: "故事总纲还没有明确主线冲突，后续阶段容易只剩局部事件。",
      });
    }
    if (!args.storySpine.protagonist_long_goal) {
      diagnostics.push({
        scope: "story_spine",
        level: "warn",
        code: "story-goal-missing",
        title: "长期目标不明确",
        message: "主角长期目标尚未定义，阶段推进会缺乏连续牵引。",
      });
    }
    if (!args.storySpine.ending_direction && !args.storySpine.ending_cost) {
      diagnostics.push({
        scope: "story_spine",
        level: "warn",
        code: "story-ending-missing",
        title: "终局方向缺失",
        message: "故事总纲未写终局方向或终局代价，后续大纲难以闭环。",
      });
    }
    if (!args.storySpine.story_promise || args.storySpine.story_promise.length < 8) {
      diagnostics.push({
        scope: "story_spine",
        level: "warn",
        code: "story-promise-weak",
        title: "故事承诺偏弱",
        message: "故事承诺还比较模糊，建议写清读者会持续期待什么。",
      });
    }

    const stageFunctionMap = new Map<string, number[]>();
    for (const stage of args.stages) {
      const normalizedFunction = stage.stage_function?.trim();
      if (normalizedFunction) {
        stageFunctionMap.set(normalizedFunction, [...(stageFunctionMap.get(normalizedFunction) ?? []), stage.phase_no]);
      }
      if (!normalizedFunction) {
        diagnostics.push({
          scope: "stage",
          level: "warn",
          code: "stage-function-missing",
          title: `阶段 ${stage.phase_no} 缺少阶段功能`,
          message: "阶段功能未定义，章节很难判断这一阶段在整书中的职责。",
          phase_no: stage.phase_no,
        });
      }
      if (!stage.stage_goal || stage.stage_goal.length < 6 || /待补|推进主线|待定/.test(stage.stage_goal)) {
        diagnostics.push({
          scope: "stage",
          level: "warn",
          code: "stage-goal-weak",
          title: `阶段 ${stage.phase_no} 目标偏空`,
          message: "阶段目标还不够具体，建议补到可以检验是否完成的程度。",
          phase_no: stage.phase_no,
        });
      }
      if (!stage.ending_state.protagonist_state && !stage.ending_state.relationship_state && !stage.ending_state.world_state) {
        diagnostics.push({
          scope: "stage",
          level: "warn",
          code: "stage-ending-state-missing",
          title: `阶段 ${stage.phase_no} 终态缺失`,
          message: "阶段结尾状态未定义，后续很难判断这个阶段是否真正收束。",
          phase_no: stage.phase_no,
        });
      }
      if (!stage.stage_cost) {
        diagnostics.push({
          scope: "stage",
          level: "warn",
          code: "stage-cost-missing",
          title: `阶段 ${stage.phase_no} 代价缺失`,
          message: "阶段代价未填写，容易出现主角连续推进却没有损耗。",
          phase_no: stage.phase_no,
        });
      }
      if (stage.no_drift_constraints.length === 0) {
        diagnostics.push({
          scope: "stage",
          level: "info",
          code: "stage-constraint-missing",
          title: `阶段 ${stage.phase_no} 禁止项缺失`,
          message: "建议补充阶段禁止偏移项，避免章节在中途失控。",
          phase_no: stage.phase_no,
        });
      }
      if (stage.chapter_count < 1) {
        diagnostics.push({
          scope: "structure",
          level: "warn",
          code: "stage-without-chapter",
          title: `阶段 ${stage.phase_no} 暂无章节`,
          message: "当前阶段还没有任何章节归属，结构推进会出现断层。",
          phase_no: stage.phase_no,
        });
      }
      if (stage.chapter_count > 8) {
        diagnostics.push({
          scope: "structure",
          level: "info",
          code: "stage-chapter-heavy",
          title: `阶段 ${stage.phase_no} 章节偏多`,
          message: "这个阶段章节数偏多，建议检查是否存在重复推进或信息注水。",
          phase_no: stage.phase_no,
        });
      }
    }

    for (const [stageFunction, phaseNos] of stageFunctionMap.entries()) {
      if (phaseNos.length > 1) {
        diagnostics.push({
          scope: "stage",
          level: "warn",
          code: "stage-function-duplicate",
          title: "阶段功能重复",
          message: `阶段 ${phaseNos.join("、")} 的阶段功能都写成了“${stageFunction}”，建议区分职责层次。`,
        });
      }
    }

    for (const chapter of args.chapters) {
      if (!chapter.goal) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-goal-missing",
          title: `第 ${chapter.chapter_no} 章目标缺失`,
          message: "本章目标未定义，生成时很容易只剩场景切换。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.core_conflict) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-conflict-missing",
          title: `第 ${chapter.chapter_no} 章冲突缺失`,
          message: "本章核心冲突未定义，推进会缺少对抗张力。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (chapter.key_events.length < 3) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-events-thin",
          title: `第 ${chapter.chapter_no} 章事件链偏薄`,
          message: "目前更像目标描述，建议补到 3-5 个关键事件节点。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.ending_hook) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-hook-missing",
          title: `第 ${chapter.chapter_no} 章缺少钩子`,
          message: "章节结尾变化或钩子未定义，连载牵引力会偏弱。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.character_change) {
        diagnostics.push({
          scope: "chapter",
          level: "info",
          code: "chapter-character-change-missing",
          title: `第 ${chapter.chapter_no} 章缺少角色变化`,
          message: "建议至少说明主角或关键角色在本章发生了什么变化。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.information_reveal) {
        diagnostics.push({
          scope: "chapter",
          level: "info",
          code: "chapter-reveal-missing",
          title: `第 ${chapter.chapter_no} 章缺少信息揭露`,
          message: "建议补一条信息揭露，避免章节只有动作推进而没有信息增量。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.chapter_function) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-function-missing",
          title: `第 ${chapter.chapter_no} 章细纲功能缺失`,
          message: "建议补写本章功能，明确这章在整条推进链里不可替代的职责。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (chapter.scene_progression.length < 3) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-scene-progression-thin",
          title: `第 ${chapter.chapter_no} 章场景推进偏薄`,
          message: "细纲中的场景推进建议至少补到 3 条，避免写作时只剩抽象目标。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (chapter.key_takeaways.length === 0) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-key-takeaways-missing",
          title: `第 ${chapter.chapter_no} 章关键收获缺失`,
          message: "细纲里还没写本章结束后新增了什么，读者收获会不够明确。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (chapter.relationship_changes.length === 0 && !chapter.character_change) {
        diagnostics.push({
          scope: "chapter",
          level: "info",
          code: "chapter-relationship-changes-missing",
          title: `第 ${chapter.chapter_no} 章关系变化缺失`,
          message: "建议补一条关系变化，至少说明人物立场、信任或依赖如何改变。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (!chapter.strategy_judgment) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-strategy-judgment-missing",
          title: `第 ${chapter.chapter_no} 章判断策略缺失`,
          message: "细纲里还没写主角本章的判断或策略，执行时容易只剩事件罗列。",
          chapter_no: chapter.chapter_no,
        });
      }
      if (
        (chapter.stage_goal || chapter.stage_conflict) &&
        hasWeakTextOverlap(chapter.goal ?? chapter.chapter_function ?? chapter.core_conflict, chapter.stage_goal ?? chapter.stage_conflict)
      ) {
        diagnostics.push({
          scope: "chapter",
          level: "warn",
          code: "chapter-stage-link-weak",
          title: `第 ${chapter.chapter_no} 章与所属阶段关联偏弱`,
          message: "章节目标/冲突与所属阶段目标几乎没有重叠，建议检查是否发生阶段偏移。",
          chapter_no: chapter.chapter_no,
          phase_no: chapter.stage_no,
        });
      }
    }

    if (args.stages.length >= 3) {
      const middleStages = args.stages.slice(1, -1);
      if (middleStages.every((stage) => !stage.midpoint_change && !stage.climax)) {
        diagnostics.push({
          scope: "structure",
          level: "warn",
          code: "midplot-escalation-missing",
          title: "中盘缺少升级",
          message: "中盘阶段没有明显的中点变化或阶段高潮，结构容易发平。",
        });
      }
    }

    const consecutiveInfoOnly: number[] = [];
    for (let index = 1; index < args.chapters.length; index += 1) {
      const previous = args.chapters[index - 1];
      const current = args.chapters[index];
      const previousInfoOnly =
        previous.key_events.length === 0 &&
        previous.scene_progression.length === 0 &&
        !!previous.information_reveal &&
        !previous.character_change &&
        previous.relationship_changes.length === 0;
      const currentInfoOnly =
        current.key_events.length === 0 &&
        current.scene_progression.length === 0 &&
        !!current.information_reveal &&
        !current.character_change &&
        current.relationship_changes.length === 0;
      if (previousInfoOnly && currentInfoOnly) {
        consecutiveInfoOnly.push(previous.chapter_no, current.chapter_no);
      }
    }
    if (consecutiveInfoOnly.length > 0) {
      diagnostics.push({
        scope: "structure",
        level: "warn",
        code: "info-only-streak",
        title: "连续信息说明章过多",
        message: `第 ${Array.from(new Set(consecutiveInfoOnly)).join("、")} 章更偏信息说明，建议补充实质事件推进。`,
      });
    }

    const stageByNo = new Map(args.stages.map((item) => [item.phase_no, item]));
    for (const stage of args.stages) {
      const hasLaterStageContent = args.chapters.some((chapter) => (chapter.stage_no ?? 0) > stage.phase_no);
      if (hasLaterStageContent && (!stage.completion_criteria || (!stage.ending_state.protagonist_state && !stage.ending_state.relationship_state && !stage.ending_state.world_state))) {
        diagnostics.push({
          scope: "linking",
          level: "warn",
          code: "stage-not-closed",
          title: `阶段 ${stage.phase_no} 可能未闭合`,
          message: "后续阶段已经开始，但本阶段的完成判定或结算终态仍不完整。",
          phase_no: stage.phase_no,
        });
      }
      const lastChapterNo = stage.assigned_chapter_nos.at(-1);
      if (lastChapterNo) {
        const lastChapter = args.chapters.find((item) => item.chapter_no === lastChapterNo);
        if (
          lastChapter &&
          (stage.ending_state.protagonist_state || stage.ending_state.relationship_state || stage.ending_state.world_state) &&
          !lastChapter.character_change &&
          lastChapter.relationship_changes.length === 0 &&
          !lastChapter.ending_hook
        ) {
          diagnostics.push({
            scope: "linking",
            level: "info",
            code: "stage-settlement-thin",
            title: `阶段 ${stage.phase_no} 结算偏薄`,
            message: "阶段终态已经设定，但承接该阶段收束的章节缺少变化或钩子描述。",
            phase_no: stage.phase_no,
            chapter_no: lastChapter.chapter_no,
          });
        }
      }
    }

    for (const impact of args.settingImpacts) {
      diagnostics.push({
        scope: "linking",
        level: "warn",
        code: `setting-impact-${impact.key}`,
        title: `${impact.label}已变化`,
        message: `${impact.label}与上次确认的大纲快照不一致，建议重审受影响的阶段与章节。`,
      });
    }

    return diagnostics;
  }

  async getOutline(projectId: string) {
    await this.ensureProject(projectId);
    return this.prisma.storyOutlineNode.findMany({
      where: { project_id: projectId },
      orderBy: { phase_no: "asc" },
    });
  }

  async patchOutline(projectId: string, dto: PatchOutlineDto) {
    await this.ensureProject(projectId);

    const uniqueNodes = new Map<number, PatchOutlineDto["nodes"][number]>();
    for (const node of dto.nodes) {
      uniqueNodes.set(node.phase_no, node);
    }

    const nodes = Array.from(uniqueNodes.values()).sort((a, b) => a.phase_no - b.phase_no);

    await this.prisma.$transaction(async (tx) => {
      await tx.storyOutlineNode.deleteMany({ where: { project_id: projectId } });
      if (nodes.length > 0) {
        await tx.storyOutlineNode.createMany({
          data: nodes.map((node) => ({
            project_id: projectId,
            phase_no: node.phase_no,
            title: node.title,
            summary: node.summary,
            goal: node.goal,
            conflict: node.conflict,
            milestone_chapter_no: node.milestone_chapter_no,
          })),
        });
      }
    });

    return this.getOutline(projectId);
  }

  async getOutlineWorkspace(projectId: string) {
    const project = await this.ensureProject(projectId);

    const [outlineNodes, arcPlans, chapters, intents, blueprints, characters, seeds, entities, glossary] = await Promise.all([
      this.prisma.storyOutlineNode.findMany({
        where: { project_id: projectId },
        orderBy: { phase_no: "asc" },
      }),
      this.prisma.arcPlan.findMany({
        where: { project_id: projectId },
        orderBy: { arc_no: "asc" },
      }),
      this.prisma.chapter.findMany({
        where: { project_id: projectId },
        orderBy: { chapter_no: "asc" },
      }),
      this.prisma.chapterIntent.findMany({
        where: { project_id: projectId },
        orderBy: [{ chapter_id: "asc" }, { version_no: "desc" }],
      }),
      this.prisma.storyBlueprint.findMany({
        where: { project_id: projectId },
        orderBy: { version_no: "desc" },
        take: 1,
      }),
      this.prisma.character.findMany({
        where: { project_id: projectId },
        orderBy: { created_at: "asc" },
      }),
      this.prisma.seed.findMany({
        where: { project_id: projectId },
        orderBy: [{ planted_chapter_no: "asc" }, { id: "asc" }],
      }),
      this.prisma.bibleEntity.findMany({
        where: { project_id: projectId },
        orderBy: { id: "asc" },
      }),
      this.prisma.glossaryTerm.findMany({
        where: { project_id: projectId },
        orderBy: { id: "asc" },
      }),
    ]);

    const blueprint = blueprints[0] ?? null;
    const firstCharacter = characters[0] ?? null;
    const firstNode = outlineNodes[0] ?? null;
    const mainConflictGlossary =
      glossary.find((item) => ["主线冲突", "核心冲突", "logline"].some((term) => item.term.toLowerCase().includes(term.toLowerCase()))) ??
      null;

    const savedStorySpine = this.readStorySpineFromBlueprint(blueprint);
    const currentSettingSnapshot = this.buildSettingSourceSnapshot({
      project,
      firstCharacter,
      rules: entities.filter((item) => item.type === "rule"),
      blueprint,
    });

    const storySpine = {
      logline: savedStorySpine.logline ?? mainConflictGlossary?.canonical_form ?? firstNode?.summary ?? null,
      main_conflict: savedStorySpine.main_conflict ?? firstNode?.conflict ?? mainConflictGlossary?.canonical_form ?? null,
      protagonist_long_goal: savedStorySpine.protagonist_long_goal ?? firstCharacter?.motivation ?? null,
      external_pressure: savedStorySpine.external_pressure ?? firstNode?.conflict ?? null,
      internal_conflict:
        savedStorySpine.internal_conflict ??
        (dedupeStrings([firstCharacter?.personality_tags ?? null, firstCharacter?.personality ?? null]).join(" / ") || null),
      central_question: savedStorySpine.central_question ?? blueprint?.core_suspense ?? null,
      ending_direction: savedStorySpine.ending_direction,
      ending_cost: savedStorySpine.ending_cost,
      story_promise: savedStorySpine.story_promise ?? blueprint?.book_positioning ?? null,
      theme_statement: savedStorySpine.theme_statement,
      non_drift_constraints:
        savedStorySpine.non_drift_constraints.length > 0
          ? savedStorySpine.non_drift_constraints
          : dedupeStrings(entities.filter((item) => item.type === "rule").map((item) => item.constraints ?? item.description ?? item.name)),
      source_snapshot: savedStorySpine.source_snapshot,
    };

    const latestIntentByChapterId = this.pickLatestByKey(intents, (item) => item.chapter_id);
    const stageKeys = Array.from(new Set([...outlineNodes.map((item) => item.phase_no), ...arcPlans.map((item) => item.arc_no)])).sort(
      (a, b) => a - b,
    );

    const stageDrafts = stageKeys.map((phaseNo) => {
      const node = outlineNodes.find((item) => item.phase_no === phaseNo) ?? null;
      const arc = arcPlans.find((item) => item.arc_no === phaseNo) ?? null;
      const meta = normalizeStageMetaData(arc?.setup_payoff_map, arc?.twist_nodes);

      return {
        phase_no: phaseNo,
        title: node?.title ?? arc?.title ?? `阶段 ${phaseNo}`,
        summary: node?.summary ?? arc?.summary ?? "",
        goal: node?.goal ?? meta.stage_goal,
        conflict: node?.conflict ?? arc?.subline ?? null,
        milestone_chapter_no: node?.milestone_chapter_no ?? arc?.chapter_range_end ?? null,
        stage_function: meta.stage_function ?? arc?.mainline ?? null,
        start_state: meta.start_state,
        stage_goal: meta.stage_goal ?? node?.goal ?? null,
        main_opponent: meta.main_opponent,
        key_events: meta.key_events,
        midpoint_change: meta.midpoint_change,
        climax: meta.climax,
        ending_state: meta.ending_state,
        stage_cost: meta.stage_cost,
        progress: meta.progress,
        completion_criteria: meta.completion_criteria,
        no_drift_constraints: meta.no_drift_constraints,
        involved_character_ids: meta.involved_character_ids,
        character_role_assignments: meta.character_role_assignments,
        seed_links: meta.seed_links,
        chapter_range_start: arc?.chapter_range_start ?? null,
        chapter_range_end: arc?.chapter_range_end ?? null,
      };
    });

    const rangedStages = this.deriveStageRanges(stageDrafts, chapters.at(-1)?.chapter_no ?? 1);
    const characterNameById = new Map(characters.map((item) => [item.id, item.name]));

    const chapterCards = chapters.map((chapter) => {
      const latestIntent = latestIntentByChapterId.get(chapter.id) ?? null;
      const chapterMeta = normalizeChapterOutlineMeta(latestIntent?.notes);
      const stageNo = determineStageNo(
        chapter.chapter_no,
        rangedStages.map((stage) => ({
          phase_no: stage.phase_no,
          chapter_range_start: stage.chapter_range_start,
          chapter_range_end: stage.chapter_range_end,
          milestone_chapter_no: stage.milestone_chapter_no,
        })),
        chapterMeta.stage_no,
      );
      const stage = rangedStages.find((item) => item.phase_no === stageNo) ?? null;

      return {
        chapter_id: chapter.id,
        chapter_no: chapter.chapter_no,
        title: normalizeChapterStoredTitle(chapter.chapter_no, chapter.title) ?? "未命名",
        display_title: formatChapterDisplayTitle(chapter.chapter_no, chapter.title),
        stage_no: stageNo,
        stage_title: stage?.title ?? null,
        stage_position: chapterMeta.stage_position,
        goal: chapterMeta.goal ?? latestIntent?.advance_goal ?? chapter.goal ?? null,
        chapter_function: chapterMeta.chapter_function,
        core_conflict: chapterMeta.core_conflict ?? latestIntent?.conflict_target ?? chapter.conflict ?? null,
        key_events: chapterMeta.key_events,
        scene_progression: chapterMeta.scene_progression,
        key_takeaways: chapterMeta.key_takeaways,
        relationship_changes: chapterMeta.relationship_changes,
        character_change: chapterMeta.character_change,
        information_reveal: chapterMeta.information_reveal,
        strategy_judgment: chapterMeta.strategy_judgment,
        ending_hook: chapterMeta.ending_hook ?? latestIntent?.hook_target ?? chapter.cliffhanger ?? null,
        word_target: chapter.word_target ?? null,
        stage_goal: stage?.stage_goal ?? stage?.goal ?? null,
        stage_conflict: stage?.conflict ?? null,
      };
    });

    const chapterNosByStage = new Map<number, number[]>();
    for (const chapter of chapterCards) {
      if (!chapter.stage_no) continue;
      chapterNosByStage.set(chapter.stage_no, [...(chapterNosByStage.get(chapter.stage_no) ?? []), chapter.chapter_no]);
    }

    const finalStages = rangedStages.map((stage) => {
      const assignedChapterNos = (chapterNosByStage.get(stage.phase_no) ?? []).sort((a, b) => a - b);
      return {
        ...stage,
        chapter_count: assignedChapterNos.length,
        assigned_chapter_nos: assignedChapterNos,
        involved_character_names: stage.involved_character_ids.map((item) => characterNameById.get(item) ?? item),
      };
    });

    const chapterIndexWithinStage = new Map<string, { index: number; total: number }>();
    for (const stage of finalStages) {
      stage.assigned_chapter_nos.forEach((chapterNo, index) => {
        chapterIndexWithinStage.set(`${stage.phase_no}:${chapterNo}`, { index, total: stage.assigned_chapter_nos.length });
      });
    }

    const decoratedChapters = chapterCards.map((chapter) => {
      if (!chapter.stage_no) {
        return chapter;
      }
      const positionInfo = chapterIndexWithinStage.get(`${chapter.stage_no}:${chapter.chapter_no}`);
      return {
        ...chapter,
        stage_position:
          chapter.stage_position ??
          (positionInfo ? deriveStagePosition(positionInfo.index, positionInfo.total) : null),
      };
    });

    const settingImpacts = this.buildSettingImpacts({
      savedSnapshot: storySpine.source_snapshot,
      currentSnapshot: currentSettingSnapshot,
      stages: finalStages,
      chapters: decoratedChapters,
    });

    const diagnostics = this.buildDiagnostics({
      storySpine,
      stages: finalStages,
      chapters: decoratedChapters,
      settingImpacts,
    });

    return {
      story_spine: storySpine,
      stages: finalStages,
      chapters: decoratedChapters,
      diagnostics,
      linking: {
        setting_impacts: settingImpacts,
      },
      meta: {
        character_options: characters.map((item) => ({
          id: item.id,
          name: item.name,
          current_status: item.current_status ?? null,
        })),
        seed_options: seeds.map((item) => ({
          id: item.id,
          name: item.content,
          status: item.status,
          planted_chapter_no: item.planted_chapter_no,
          planned_payoff_chapter_no: item.planned_payoff_chapter_no ?? null,
        })),
        role_options: [...ROLE_OPTIONS],
        chapter_position_options: [...CHAPTER_POSITION_OPTIONS],
      },
    };
  }

  private buildStorySpinePayload(dto: StorySpineDto, sourceSnapshot: Record<string, unknown>) {
    return {
      logline: this.sanitizeString(dto.logline),
      main_conflict: this.sanitizeString(dto.main_conflict),
      protagonist_long_goal: this.sanitizeString(dto.protagonist_long_goal),
      external_pressure: this.sanitizeString(dto.external_pressure),
      internal_conflict: this.sanitizeString(dto.internal_conflict),
      central_question: this.sanitizeString(dto.central_question),
      ending_direction: this.sanitizeString(dto.ending_direction),
      ending_cost: this.sanitizeString(dto.ending_cost),
      story_promise: this.sanitizeString(dto.story_promise),
      theme_statement: this.sanitizeString(dto.theme_statement),
      non_drift_constraints: this.sanitizeStringArray(dto.non_drift_constraints),
      source_snapshot: sourceSnapshot,
    };
  }

  private buildStageStoragePayload(stage: StageOutlineWorkspaceItemDto) {
    return {
      stage_function: this.sanitizeString(stage.stage_function),
      start_state: {
        protagonist_state: this.sanitizeString(stage.start_state?.protagonist_state),
        relationship_state: this.sanitizeString(stage.start_state?.relationship_state),
        world_state: this.sanitizeString(stage.start_state?.world_state),
      },
      stage_goal: this.sanitizeString(stage.stage_goal ?? stage.goal),
      main_opponent: this.sanitizeString(stage.main_opponent),
      key_events: this.sanitizeStringArray(stage.key_events),
      midpoint_change: this.sanitizeString(stage.midpoint_change),
      climax: this.sanitizeString(stage.climax),
      ending_state: {
        protagonist_state: this.sanitizeString(stage.ending_state?.protagonist_state),
        relationship_state: this.sanitizeString(stage.ending_state?.relationship_state),
        world_state: this.sanitizeString(stage.ending_state?.world_state),
      },
      stage_cost: this.sanitizeString(stage.stage_cost),
      progress: {
        plot: typeof stage.progress?.plot === "number" ? stage.progress.plot : null,
        relationship: typeof stage.progress?.relationship === "number" ? stage.progress.relationship : null,
        information: typeof stage.progress?.information === "number" ? stage.progress.information : null,
      },
      completion_criteria: this.sanitizeString(stage.completion_criteria),
      no_drift_constraints: this.sanitizeStringArray(stage.no_drift_constraints),
      involved_character_ids: this.sanitizeStringArray(stage.involved_character_ids),
      character_role_assignments:
        stage.character_role_assignments?.map((item) => ({
          character_id: this.sanitizeString(item.character_id),
          character_name: this.sanitizeString(item.character_name),
          role: this.sanitizeString(item.role),
        })) ?? [],
      seed_links:
        stage.seed_links?.map((item) => ({
          seed_id: this.sanitizeString(item.seed_id),
          seed_name: this.sanitizeString(item.seed_name),
          introduce_in_stage: typeof item.introduce_in_stage === "number" ? item.introduce_in_stage : null,
          introduce_in_chapter: typeof item.introduce_in_chapter === "number" ? item.introduce_in_chapter : null,
          payoff_in_stage: typeof item.payoff_in_stage === "number" ? item.payoff_in_stage : null,
          payoff_in_chapter: typeof item.payoff_in_chapter === "number" ? item.payoff_in_chapter : null,
          current_status: this.sanitizeString(item.current_status),
          link_type: this.sanitizeString(item.link_type),
        })) ?? [],
    };
  }

  private buildChapterOutlinePayload(chapter: ChapterOutlineWorkspaceItemDto, fallbackStageNo: number | null) {
    return {
      stage_no: typeof chapter.stage_no === "number" ? chapter.stage_no : fallbackStageNo,
      stage_position: this.sanitizeString(chapter.stage_position),
      goal: this.sanitizeString(chapter.goal),
      chapter_function: this.sanitizeString(chapter.chapter_function),
      core_conflict: this.sanitizeString(chapter.core_conflict),
      key_events: this.sanitizeStringArray(chapter.key_events),
      scene_progression: this.sanitizeStringArray(chapter.scene_progression),
      key_takeaways: this.sanitizeStringArray(chapter.key_takeaways),
      relationship_changes: this.sanitizeStringArray(chapter.relationship_changes),
      character_change: this.sanitizeString(chapter.character_change),
      information_reveal: this.sanitizeString(chapter.information_reveal),
      strategy_judgment: this.sanitizeString(chapter.strategy_judgment),
      ending_hook: this.sanitizeString(chapter.ending_hook),
    };
  }

  async patchOutlineWorkspace(projectId: string, dto: PatchOutlineWorkspaceDto) {
    const project = await this.ensureProject(projectId);

    const [latestBlueprint, chapters, intents, characters, entities] = await Promise.all([
      this.prisma.storyBlueprint.findFirst({
        where: { project_id: projectId },
        orderBy: { version_no: "desc" },
      }),
      this.prisma.chapter.findMany({
        where: { project_id: projectId },
        orderBy: { chapter_no: "asc" },
      }),
      this.prisma.chapterIntent.findMany({
        where: { project_id: projectId },
        orderBy: [{ chapter_id: "asc" }, { version_no: "desc" }],
      }),
      this.prisma.character.findMany({
        where: { project_id: projectId },
        orderBy: { created_at: "asc" },
      }),
      this.prisma.bibleEntity.findMany({
        where: { project_id: projectId },
        orderBy: { id: "asc" },
      }),
    ]);

    const latestIntentByChapterId = this.pickLatestByKey(intents, (item) => item.chapter_id);
    const stageInputMap = new Map<number, StageOutlineWorkspaceItemDto>();
    for (const stage of dto.stages ?? []) {
      stageInputMap.set(stage.phase_no, stage);
    }
    const chapterInputMap = new Map<number, ChapterOutlineWorkspaceItemDto>();
    for (const chapter of dto.chapters ?? []) {
      chapterInputMap.set(chapter.chapter_no, chapter);
    }

    const currentSettingSnapshot = this.buildSettingSourceSnapshot({
      project,
      firstCharacter: characters[0] ?? null,
      rules: entities.filter((item) => item.type === "rule"),
      blueprint: latestBlueprint,
    });

    await this.prisma.$transaction(async (tx) => {
      if (dto.story_spine) {
        const savedRoot = this.readOutlineWorkspaceRoot(latestBlueprint?.world_rule_map);
        const nextStorySpine = this.buildStorySpinePayload(dto.story_spine, currentSettingSnapshot);
        const currentHash = sha256FromCanonicalJson(savedRoot.story_spine ?? {});
        const nextHash = sha256FromCanonicalJson(nextStorySpine);
        if (currentHash !== nextHash) {
          const nextVersionNo = (latestBlueprint?.version_no ?? 0) + 1;
          const nextRoot = {
            ...savedRoot,
            story_spine: nextStorySpine,
          };

          await tx.storyBlueprint.create({
            data: {
              project_id: projectId,
              version_no: nextVersionNo,
              book_positioning: nextStorySpine.story_promise ?? latestBlueprint?.book_positioning ?? `${project.title} 的故事总纲`,
              genre: latestBlueprint?.genre ?? project.genre ?? null,
              selling_points: dedupeStrings([
                nextStorySpine.story_promise,
                nextStorySpine.theme_statement,
                ...(latestBlueprint?.selling_points ?? []),
              ]),
              target_platform: latestBlueprint?.target_platform ?? project.target_platform ?? null,
              target_readers: latestBlueprint?.target_readers ?? null,
              pleasure_pacing: latestBlueprint?.pleasure_pacing ?? null,
              main_conflict: nextStorySpine.main_conflict,
              core_suspense: nextStorySpine.central_question ?? nextStorySpine.ending_direction ?? latestBlueprint?.core_suspense ?? null,
              character_relation_map: toJson(latestBlueprint?.character_relation_map),
              world_rule_map: toJson({
                ...(normalizeRecord(latestBlueprint?.world_rule_map) ?? {}),
                [OUTLINE_WORKSPACE_KEY]: nextRoot,
              }),
              volume_structure: toJson(latestBlueprint?.volume_structure),
              chapter_targets: toJson(latestBlueprint?.chapter_targets),
            },
          });
        }
      }

      if (dto.stages) {
        const stagePhaseNos = Array.from(stageInputMap.keys()).sort((a, b) => a - b);
        if (stagePhaseNos.length === 0) {
          await tx.storyOutlineNode.deleteMany({ where: { project_id: projectId } });
          await tx.arcPlan.deleteMany({ where: { project_id: projectId } });
        } else {
          await tx.storyOutlineNode.deleteMany({
            where: { project_id: projectId, phase_no: { notIn: stagePhaseNos } },
          });
          await tx.arcPlan.deleteMany({
            where: { project_id: projectId, arc_no: { notIn: stagePhaseNos } },
          });
        }

        for (const phaseNo of stagePhaseNos) {
          const stage = stageInputMap.get(phaseNo)!;
          const derivedChapterNos = Array.from(chapterInputMap.values())
            .filter((item) => item.stage_no === phaseNo)
            .map((item) => item.chapter_no)
            .sort((a, b) => a - b);
          const chapterRangeStart = stage.chapter_range_start ?? derivedChapterNos[0] ?? null;
          const chapterRangeEnd = stage.chapter_range_end ?? derivedChapterNos.at(-1) ?? stage.milestone_chapter_no ?? null;
          const stagePayload = this.buildStageStoragePayload(stage);

          await tx.storyOutlineNode.upsert({
            where: {
              project_id_phase_no: {
                project_id: projectId,
                phase_no: phaseNo,
              },
            },
            create: {
              project_id: projectId,
              phase_no: phaseNo,
              title: stage.title.trim(),
              summary: stage.summary.trim(),
              goal: this.sanitizeString(stage.goal ?? stage.stage_goal),
              conflict: this.sanitizeString(stage.conflict),
              milestone_chapter_no: stage.milestone_chapter_no ?? chapterRangeEnd ?? undefined,
            },
            update: {
              title: stage.title.trim(),
              summary: stage.summary.trim(),
              goal: this.sanitizeString(stage.goal ?? stage.stage_goal),
              conflict: this.sanitizeString(stage.conflict),
              milestone_chapter_no: stage.milestone_chapter_no ?? chapterRangeEnd ?? undefined,
            },
          });

          await tx.arcPlan.upsert({
            where: {
              project_id_arc_no: {
                project_id: projectId,
                arc_no: phaseNo,
              },
            },
            create: {
              project_id: projectId,
              arc_no: phaseNo,
              title: stage.title.trim(),
              summary: this.sanitizeString(stage.summary),
              mainline: this.sanitizeString(stage.stage_function),
              subline: this.sanitizeString(stage.conflict ?? stage.goal ?? stage.stage_goal),
              pacing_profile: [stagePayload.progress.plot, stagePayload.progress.relationship, stagePayload.progress.information]
                .map((item) => (typeof item === "number" ? item.toString() : ""))
                .filter(Boolean)
                .join("/")
                .trim() || undefined,
              setup_payoff_map: toJson({
                [OUTLINE_WORKSPACE_KEY]: stagePayload,
              }),
              twist_nodes: toJson(stagePayload.key_events),
              chapter_range_start: chapterRangeStart ?? undefined,
              chapter_range_end: chapterRangeEnd ?? undefined,
            },
            update: {
              title: stage.title.trim(),
              summary: this.sanitizeString(stage.summary),
              mainline: this.sanitizeString(stage.stage_function),
              subline: this.sanitizeString(stage.conflict ?? stage.goal ?? stage.stage_goal),
              pacing_profile: [stagePayload.progress.plot, stagePayload.progress.relationship, stagePayload.progress.information]
                .map((item) => (typeof item === "number" ? item.toString() : ""))
                .filter(Boolean)
                .join("/")
                .trim() || undefined,
              setup_payoff_map: toJson({
                [OUTLINE_WORKSPACE_KEY]: stagePayload,
              }),
              twist_nodes: toJson(stagePayload.key_events),
              chapter_range_start: chapterRangeStart ?? undefined,
              chapter_range_end: chapterRangeEnd ?? undefined,
            },
          });
        }
      }

      if (dto.chapters) {
        const stageRanges = Array.from(stageInputMap.values())
          .sort((a, b) => a.phase_no - b.phase_no)
          .map((stage) => ({
            phase_no: stage.phase_no,
            chapter_range_start: stage.chapter_range_start ?? null,
            chapter_range_end: stage.chapter_range_end ?? stage.milestone_chapter_no ?? null,
            milestone_chapter_no: stage.milestone_chapter_no ?? null,
          }));

        const existingChapterByNo = new Map(chapters.map((item) => [item.chapter_no, item]));

        for (const chapterInput of Array.from(chapterInputMap.values()).sort((a, b) => a.chapter_no - b.chapter_no)) {
          const existingChapter = existingChapterByNo.get(chapterInput.chapter_no) ?? null;
          const fallbackStageNo = determineStageNo(chapterInput.chapter_no, stageRanges, chapterInput.stage_no ?? null);
          const outlinePayload = this.buildChapterOutlinePayload(chapterInput, fallbackStageNo);
          const storedTitle = normalizeChapterStoredTitle(chapterInput.chapter_no, chapterInput.title);
          const savedChapter =
            existingChapter ??
            (await tx.chapter.create({
              data: {
                project_id: projectId,
                chapter_no: chapterInput.chapter_no,
                title: storedTitle ?? undefined,
                goal: outlinePayload.goal ?? undefined,
                conflict: outlinePayload.core_conflict ?? undefined,
                twist: outlinePayload.information_reveal ?? undefined,
                cliffhanger: outlinePayload.ending_hook ?? undefined,
                word_target: chapterInput.word_target ?? DEFAULT_CHAPTER_WORD_TARGET,
                status: "outline",
              },
            }));

          await tx.chapter.update({
            where: { id: savedChapter.id },
            data: {
              title: storedTitle ?? undefined,
              goal: outlinePayload.goal ?? undefined,
              conflict: outlinePayload.core_conflict ?? undefined,
              twist: outlinePayload.information_reveal ?? undefined,
              cliffhanger: outlinePayload.ending_hook ?? undefined,
              word_target: chapterInput.word_target ?? undefined,
            },
          });

          const latestIntent = latestIntentByChapterId.get(savedChapter.id) ?? null;
          const existingNotes = normalizeRecord(latestIntent?.notes);
          const nextNotes = {
            ...existingNotes,
            [OUTLINE_WORKSPACE_KEY]: outlinePayload,
          };

          const nextIntentSnapshot = {
            chapter_mission: outlinePayload.chapter_function ?? outlinePayload.goal ?? `第${chapterInput.chapter_no}章推进主线`,
            advance_goal: outlinePayload.goal,
            conflict_target: outlinePayload.core_conflict,
            hook_target: outlinePayload.ending_hook,
            pacing_direction: outlinePayload.stage_position,
            must_payoff_seed_ids: [],
            outline_workspace: outlinePayload,
          };
          const previousIntentSnapshot = latestIntent
            ? {
                chapter_mission: latestIntent.chapter_mission,
                advance_goal: latestIntent.advance_goal,
                conflict_target: latestIntent.conflict_target,
                hook_target: latestIntent.hook_target,
                pacing_direction: latestIntent.pacing_direction,
                must_payoff_seed_ids: latestIntent.must_payoff_seed_ids,
                outline_workspace: normalizeRecord(existingNotes[OUTLINE_WORKSPACE_KEY]),
              }
            : null;

          if (
            !previousIntentSnapshot ||
            sha256FromCanonicalJson(previousIntentSnapshot) !== sha256FromCanonicalJson(nextIntentSnapshot)
          ) {
            await tx.chapterIntent.create({
              data: {
                project_id: projectId,
                chapter_id: savedChapter.id,
                version_no: (latestIntent?.version_no ?? 0) + 1,
                chapter_mission: nextIntentSnapshot.chapter_mission,
                advance_goal: nextIntentSnapshot.advance_goal ?? undefined,
                conflict_target: nextIntentSnapshot.conflict_target ?? undefined,
                hook_target: nextIntentSnapshot.hook_target ?? undefined,
                pacing_direction: nextIntentSnapshot.pacing_direction ?? undefined,
                must_payoff_seed_ids: nextIntentSnapshot.must_payoff_seed_ids,
                notes: toJson(nextNotes),
              },
            });
          }
        }
      }
    });

    return this.getOutlineWorkspace(projectId);
  }

  async buildGenerationGuardrail(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const [blueprint, outlineNodes, arcPlans, latestIntent] = await Promise.all([
      this.prisma.storyBlueprint.findFirst({
        where: { project_id: chapter.project_id },
        orderBy: { version_no: "desc" },
      }),
      this.prisma.storyOutlineNode.findMany({
        where: { project_id: chapter.project_id },
        orderBy: { phase_no: "asc" },
      }),
      this.prisma.arcPlan.findMany({
        where: { project_id: chapter.project_id },
        orderBy: { arc_no: "asc" },
      }),
      this.prisma.chapterIntent.findFirst({
        where: { chapter_id: chapter.id },
        orderBy: { version_no: "desc" },
      }),
    ]);

    const storySpine = this.readStorySpineFromBlueprint(blueprint);
    const stageDrafts = Array.from(new Set([...outlineNodes.map((item) => item.phase_no), ...arcPlans.map((item) => item.arc_no)]))
      .sort((a, b) => a - b)
      .map((phaseNo) => {
        const node = outlineNodes.find((item) => item.phase_no === phaseNo) ?? null;
        const arc = arcPlans.find((item) => item.arc_no === phaseNo) ?? null;
        const meta = normalizeStageMetaData(arc?.setup_payoff_map, arc?.twist_nodes);
        return {
          phase_no: phaseNo,
          title: node?.title ?? arc?.title ?? `阶段 ${phaseNo}`,
          goal: node?.goal ?? meta.stage_goal,
          conflict: node?.conflict ?? arc?.subline ?? null,
          stage_function: meta.stage_function ?? arc?.mainline ?? null,
          key_events: meta.key_events,
          no_drift_constraints: meta.no_drift_constraints,
          milestone_chapter_no: node?.milestone_chapter_no ?? arc?.chapter_range_end ?? null,
          chapter_range_start: arc?.chapter_range_start ?? null,
          chapter_range_end: arc?.chapter_range_end ?? null,
        };
      });

    const rangedStages = this.deriveStageRanges(stageDrafts, chapter.chapter_no);
    const chapterMeta = normalizeChapterOutlineMeta(latestIntent?.notes);
    const stageNo = determineStageNo(chapter.chapter_no, rangedStages, chapterMeta.stage_no);
    const stage = rangedStages.find((item) => item.phase_no === stageNo) ?? null;

    const payload = {
      story_spine: {
        main_conflict: storySpine.main_conflict,
        protagonist_long_goal: storySpine.protagonist_long_goal,
        central_question: storySpine.central_question,
        story_promise: storySpine.story_promise,
        non_drift_constraints: storySpine.non_drift_constraints,
      },
      stage: stage
        ? {
            phase_no: stage.phase_no,
            title: stage.title,
            stage_function: stage.stage_function,
            stage_goal: stage.goal,
            stage_conflict: stage.conflict,
            key_events: stage.key_events,
            no_drift_constraints: stage.no_drift_constraints,
          }
        : null,
      chapter: {
        stage_no: stageNo,
        stage_position: chapterMeta.stage_position,
        goal: chapterMeta.goal ?? latestIntent?.advance_goal ?? chapter.goal ?? null,
        chapter_function: chapterMeta.chapter_function,
        core_conflict: chapterMeta.core_conflict ?? latestIntent?.conflict_target ?? chapter.conflict ?? null,
        key_events: chapterMeta.key_events,
        scene_progression: chapterMeta.scene_progression,
        key_takeaways: chapterMeta.key_takeaways,
        relationship_changes: chapterMeta.relationship_changes,
        character_change: chapterMeta.character_change,
        information_reveal: chapterMeta.information_reveal ?? chapter.twist ?? null,
        strategy_judgment: chapterMeta.strategy_judgment,
        ending_hook: chapterMeta.ending_hook ?? latestIntent?.hook_target ?? chapter.cliffhanger ?? null,
      },
    };

    const lines = dedupeStrings([
      payload.story_spine.main_conflict ? `主线冲突：${payload.story_spine.main_conflict}` : null,
      payload.story_spine.protagonist_long_goal ? `主角长期目标：${payload.story_spine.protagonist_long_goal}` : null,
      payload.story_spine.central_question ? `故事核心问题：${payload.story_spine.central_question}` : null,
      payload.story_spine.story_promise ? `故事承诺：${payload.story_spine.story_promise}` : null,
      ...(payload.story_spine.non_drift_constraints ?? []).map((item) => `主线不可偏移：${item}`),
      payload.stage?.stage_function ? `阶段功能：${payload.stage.stage_function}` : null,
      payload.stage?.stage_goal ? `阶段目标：${payload.stage.stage_goal}` : null,
      payload.stage?.stage_conflict ? `阶段主要冲突：${payload.stage.stage_conflict}` : null,
      ...(payload.stage?.key_events ?? []).map((item) => `阶段关键节点：${item}`),
      ...(payload.stage?.no_drift_constraints ?? []).map((item) => `阶段禁止项：${item}`),
      payload.chapter.stage_position ? `本章阶段位置：${payload.chapter.stage_position}` : null,
      payload.chapter.chapter_function ? `本章功能：${payload.chapter.chapter_function}` : null,
      payload.chapter.goal ? `本章目标：${payload.chapter.goal}` : null,
      payload.chapter.core_conflict ? `本章核心冲突：${payload.chapter.core_conflict}` : null,
      payload.chapter.scene_progression.length > 0 ? `场景推进：${formatNumberedInline(payload.chapter.scene_progression)}` : null,
      ...(payload.chapter.scene_progression.length === 0 ? (payload.chapter.key_events ?? []).map((item) => `本章关键事件：${item}`) : []),
      payload.chapter.key_takeaways.length > 0 ? `本章关键收获：${formatNumberedInline(payload.chapter.key_takeaways)}` : null,
      payload.chapter.relationship_changes.length > 0 ? `关系变化：${formatNumberedInline(payload.chapter.relationship_changes)}` : null,
      !payload.chapter.relationship_changes.length && payload.chapter.character_change ? `本章角色变化：${payload.chapter.character_change}` : null,
      payload.chapter.information_reveal && !hasTextOverlapWithList(payload.chapter.information_reveal, payload.chapter.key_takeaways)
        ? `本章信息揭露：${payload.chapter.information_reveal}`
        : null,
      payload.chapter.strategy_judgment ? `主角判断/策略：${payload.chapter.strategy_judgment}` : null,
      payload.chapter.ending_hook ? `章尾钩子：${payload.chapter.ending_hook}` : null,
    ]);

    return {
      payload,
      lines,
    };
  }
}
