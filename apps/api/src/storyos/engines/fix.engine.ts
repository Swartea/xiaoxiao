import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { FixTaskStatus, Prisma } from "@prisma/client";
import { fixPlanSchema, type ChapterEvaluation, type FixPlan } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";
import { GenerationService } from "../../generation/generation.service";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class FixEngine {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GenerationService) private readonly generationService: GenerationService,
  ) {}

  routeFixStrategy(evaluation: ChapterEvaluation) {
    const { quality, continuity } = evaluation;

    if (quality.opening_hook.score < 6) {
      return this.fixOpening();
    }

    if (quality.ending_hook.score < 6) {
      return this.fixEnding();
    }

    if (quality.dialogue_quality.score < 5) {
      return this.fixDialogue();
    }

    if (quality.pacing.score < 6) {
      return this.fixPacing();
    }

    if (
      continuity.world_rule_conflict.length > 0 ||
      continuity.timeline_conflict.length > 0 ||
      continuity.relationship_conflict.length > 0 ||
      continuity.character_ooc.length > 0
    ) {
      return this.fixContinuity();
    }

    return null;
  }

  fixOpening(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "opening_hook",
      fix_goal: "强化开头 300 字中的异常事件与直接冲突",
      keep_elements: ["主线冲突", "角色关系", "关键数字"],
      forbidden_changes: ["改变时间线", "改写章节结局"],
      target_intensity: "medium",
    });
  }

  fixEnding(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "ending_hook",
      fix_goal: "增强章节结尾钩子，保留事实不变",
      keep_elements: ["结尾前事件顺序", "伏笔关系"],
      forbidden_changes: ["新增世界观设定", "软收"],
      target_intensity: "medium",
    });
  }

  fixDialogue(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "dialogue_quality",
      fix_goal: "提升对白推进信息密度与角色差异",
      keep_elements: ["场景目标", "冲突结果"],
      forbidden_changes: ["删除关键事实", "全员统一口吻"],
      target_intensity: "medium",
    });
  }

  fixPacing(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "pacing",
      fix_goal: "重排段落节奏，缩短低价值说明",
      keep_elements: ["剧情主干", "角色弧线"],
      forbidden_changes: ["新增支线", "删掉关键伏笔"],
      target_intensity: "high",
    });
  }

  fixContinuity(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "continuity",
      fix_goal: "定向修复设定冲突和时间线矛盾",
      keep_elements: ["既有剧情推进"],
      forbidden_changes: ["无关改写", "删除主线冲突"],
      target_intensity: "low",
    });
  }

  rewriteSection(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "section_rewrite",
      fix_goal: "对指定场景进行重写以提升冲突与可读性",
      keep_elements: ["场景目标", "关键线索"],
      forbidden_changes: ["改变章节整体结局"],
      target_intensity: "medium",
    });
  }

  rewriteChapter(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "chapter_rewrite",
      fix_goal: "按当前 mission 重写全章，保留设定边界",
      keep_elements: ["主线冲突", "角色关系", "核心伏笔"],
      forbidden_changes: ["更换主角立场"],
      target_intensity: "high",
    });
  }

  replaceSpan(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "span_replace",
      fix_goal: "替换局部问题段落",
      keep_elements: ["上下文衔接"],
      forbidden_changes: ["扩散性重写"],
      target_intensity: "low",
    });
  }

  private async resolveChapterAndBaseVersion(chapterId: string, versionId?: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const baseVersion = versionId
      ? await this.prisma.chapterVersion.findFirst({ where: { id: versionId, chapter_id: chapterId } })
      : await this.prisma.chapterVersion.findFirst({
          where: { chapter_id: chapterId },
          orderBy: { version_no: "desc" },
        });

    if (!baseVersion) {
      throw new NotFoundException("Base version not found");
    }

    return { chapter, baseVersion };
  }

  private buildGenerationFixPayload(args: {
    issueType: string;
    baseVersionId: string;
    baseText: string;
    fixGoal: string;
    keepElements: string[];
    forbiddenChanges: string[];
    targetIntensity: string;
  }) {
    if (args.issueType === "opening_hook") {
      return {
        base_version_id: args.baseVersionId,
        mode: "replace_span" as const,
        span: { from: 0, to: Math.min(320, args.baseText.length) },
        strategy_id: "opening-hook-upgrade",
        instruction: `${args.fixGoal}；保留：${args.keepElements.join("、")}；禁止：${args.forbiddenChanges.join("、")}；强度：${args.targetIntensity}`,
      };
    }

    if (args.issueType === "ending_hook") {
      const from = Math.max(0, args.baseText.length - 360);
      return {
        base_version_id: args.baseVersionId,
        mode: "replace_span" as const,
        span: { from, to: args.baseText.length },
        strategy_id: "ending-hook-upgrade",
        instruction: `${args.fixGoal}；保留：${args.keepElements.join("、")}；禁止：${args.forbiddenChanges.join("、")}；强度：${args.targetIntensity}`,
      };
    }

    if (args.issueType === "dialogue_quality") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_section" as const,
        section: { scene_index: 0 },
        strategy_id: "dialogue-quality-upgrade",
        instruction: `${args.fixGoal}；保留：${args.keepElements.join("、")}；禁止：${args.forbiddenChanges.join("、")}；强度：${args.targetIntensity}`,
      };
    }

    if (args.issueType === "pacing") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_chapter" as const,
        strategy_id: "pacing-rewrite",
        instruction: `${args.fixGoal}；保留：${args.keepElements.join("、")}；禁止：${args.forbiddenChanges.join("、")}；强度：${args.targetIntensity}`,
      };
    }

    return {
      base_version_id: args.baseVersionId,
      mode: "rewrite_chapter" as const,
      strategy_id: "continuity-fix",
      instruction: `${args.fixGoal}；保留：${args.keepElements.join("、")}；禁止：${args.forbiddenChanges.join("、")}；强度：${args.targetIntensity}`,
    };
  }

  async applyFixPlan(args: {
    chapterId: string;
    versionId?: string;
    plan: FixPlan;
  }) {
    const { chapter, baseVersion } = await this.resolveChapterAndBaseVersion(args.chapterId, args.versionId);

    const task = await this.prisma.fixTask.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        base_version_id: baseVersion.id,
        issue_type: args.plan.issue_type,
        fix_goal: args.plan.fix_goal,
        keep_elements: args.plan.keep_elements,
        forbidden_changes: args.plan.forbidden_changes,
        target_intensity: args.plan.target_intensity,
        strategy: "rule-router-v1",
        status: FixTaskStatus.pending,
        input_payload: toJson(args.plan),
      },
    });

    const payload = this.buildGenerationFixPayload({
      issueType: args.plan.issue_type,
      baseVersionId: baseVersion.id,
      baseText: baseVersion.text,
      fixGoal: args.plan.fix_goal,
      keepElements: args.plan.keep_elements,
      forbiddenChanges: args.plan.forbidden_changes,
      targetIntensity: args.plan.target_intensity,
    });

    try {
      const result = await this.generationService.fix(chapter.id, payload, randomUUID());

      await this.prisma.fixTask.update({
        where: { id: task.id },
        data: {
          status: FixTaskStatus.applied,
          target_version_id: result.new_version_id,
          result_payload: toJson(result),
        },
      });

      return {
        task_id: task.id,
        fix_result: result,
      };
    } catch (error) {
      await this.prisma.fixTask.update({
        where: { id: task.id },
        data: {
          status: FixTaskStatus.failed,
          result_payload: toJson({ error: error instanceof Error ? error.message : "fix failed" }),
        },
      });
      throw error;
    }
  }
}
