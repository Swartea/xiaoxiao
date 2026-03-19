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

    if (
      continuity.world_rule_conflict.length > 0 ||
      continuity.timeline_conflict.length > 0 ||
      continuity.relationship_conflict.length > 0 ||
      continuity.character_ooc.length > 0
    ) {
      return this.fixContinuity();
    }

    const topDiagnostic = [...(evaluation.diagnostics ?? [])].sort((left, right) => left.score - right.score)[0];
    if (topDiagnostic?.issue_type === "ai_tone") {
      return this.fixAiTone(topDiagnostic);
    }
    if (topDiagnostic?.issue_type === "exposition_overload") {
      return this.fixExposition(topDiagnostic);
    }
    if (topDiagnostic?.issue_type === "weak_scene") {
      return this.fixWeakScene(topDiagnostic);
    }
    if (topDiagnostic?.issue_type === "stiff_dialogue") {
      return this.fixStiffDialogue(topDiagnostic);
    }

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

    return null;
  }

  fixOpening(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "opening_hook",
      fix_goal: "强化开头 300 字中的异常事件与直接冲突",
      keep_elements: ["主线冲突", "角色关系", "关键数字"],
      forbidden_changes: ["改变时间线", "改写章节结局"],
      target_intensity: "medium",
      rewrite_tactics: ["删掉开头解释句", "先抛异常动作或威胁", "把最必要信息后置"],
      focus_span: { from: 0, to: 320 },
    });
  }

  fixEnding(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "ending_hook",
      fix_goal: "增强章节结尾钩子，保留事实不变",
      keep_elements: ["结尾前事件顺序", "伏笔关系"],
      forbidden_changes: ["新增世界观设定", "软收"],
      target_intensity: "medium",
      rewrite_tactics: ["压缩结尾总结句", "保留未兑现代价", "最后一句只揭示一半信息"],
    });
  }

  fixDialogue(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "dialogue_quality",
      fix_goal: "提升对白推进信息密度与角色差异",
      keep_elements: ["场景目标", "冲突结果"],
      forbidden_changes: ["删除关键事实", "全员统一口吻"],
      target_intensity: "medium",
      rewrite_tactics: ["删掉解释性对白", "加入打断与反问", "对白里保留试探和遮掩"],
    });
  }

  fixPacing(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "pacing",
      fix_goal: "重排段落节奏，缩短低价值说明",
      keep_elements: ["剧情主干", "角色弧线"],
      forbidden_changes: ["新增支线", "删掉关键伏笔"],
      target_intensity: "high",
      rewrite_tactics: ["拆短说明段", "动作段与信息段错位排布", "减少平均句长"],
    });
  }

  fixContinuity(): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "continuity",
      fix_goal: "定向修复设定冲突和时间线矛盾",
      keep_elements: ["既有剧情推进"],
      forbidden_changes: ["无关改写", "删除主线冲突"],
      target_intensity: "low",
      rewrite_tactics: ["只修冲突事实", "不扩散到无关段落"],
    });
  }

  fixAiTone(diagnostic?: ChapterEvaluation["diagnostics"][number]): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "ai_tone",
      fix_goal: "局部去除套话、对称句和机械心理标签，保持剧情事实不变",
      keep_elements: ["剧情推进", "角色关系", "关键事实"],
      forbidden_changes: ["扩写新设定", "整章推翻重写"],
      target_intensity: diagnostic?.severity === "high" ? "medium" : "low",
      rewrite_tactics: diagnostic?.suggested_actions ?? [
        "砍掉连续定语链，把修饰拆回动作和结果",
        "打破连续对称句式",
        "将情绪总结改写为肢体动作或环境反应",
        "删除显式心理标签",
      ],
      focus_span: diagnostic?.focus_span,
      focus_scene_index: diagnostic?.focus_scene_index,
    });
  }

  fixExposition(diagnostic?: ChapterEvaluation["diagnostics"][number]): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "exposition_overload",
      fix_goal: "压缩说明性段落，把信息拆回动作和对白",
      keep_elements: ["核心信息点", "因果顺序"],
      forbidden_changes: ["删除必要设定", "改动事实结论"],
      target_intensity: diagnostic?.severity === "high" ? "medium" : "low",
      rewrite_tactics: diagnostic?.suggested_actions ?? [
        "删除段首段尾硬总结",
        "把解释句拆成动作与对白",
        "保留当下场景必须信息",
      ],
      focus_span: diagnostic?.focus_span,
      focus_scene_index: diagnostic?.focus_scene_index,
    });
  }

  fixWeakScene(diagnostic?: ChapterEvaluation["diagnostics"][number]): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "weak_scene",
      fix_goal: "增强场景画面感和可感知细节，不改变剧情走向",
      keep_elements: ["场景目标", "冲突结果", "关键伏笔"],
      forbidden_changes: ["新增支线", "改变角色立场"],
      target_intensity: diagnostic?.severity === "high" ? "medium" : "low",
      rewrite_tactics: diagnostic?.suggested_actions ?? [
        "增加视觉/听觉/触觉细节",
        "补一个环境反馈",
        "用动作承载情绪变化",
      ],
      focus_span: diagnostic?.focus_span,
      focus_scene_index: diagnostic?.focus_scene_index,
    });
  }

  fixStiffDialogue(diagnostic?: ChapterEvaluation["diagnostics"][number]): FixPlan {
    return fixPlanSchema.parse({
      issue_type: "stiff_dialogue",
      fix_goal: "把书面化对白改成更自然的试探、打断和留白",
      keep_elements: ["对白信息目标", "角色关系张力"],
      forbidden_changes: ["删掉关键信息", "统一人物口吻"],
      target_intensity: diagnostic?.severity === "high" ? "medium" : "low",
      rewrite_tactics: diagnostic?.suggested_actions ?? [
        "打断过长说明句",
        "加入反问、停顿和未说完的话",
        "删掉替作者解释背景的对白",
      ],
      focus_span: diagnostic?.focus_span,
      focus_scene_index: diagnostic?.focus_scene_index,
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
    rewriteTactics?: string[];
    focusSpan?: { from: number; to: number };
    focusSceneIndex?: number;
  }) {
    const instruction = [
      args.fixGoal,
      `保留：${args.keepElements.join("、")}`,
      `禁止：${args.forbiddenChanges.join("、")}`,
      `强度：${args.targetIntensity}`,
      args.rewriteTactics && args.rewriteTactics.length > 0 ? `手术策略：${args.rewriteTactics.join("；")}` : "",
    ]
      .filter(Boolean)
      .join("；");

    if (args.focusSpan) {
      return {
        base_version_id: args.baseVersionId,
        mode: "replace_span" as const,
        span: args.focusSpan,
        strategy_id: `${args.issueType}-targeted-rewrite`,
        instruction,
      };
    }

    if (typeof args.focusSceneIndex === "number") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_section" as const,
        section: { scene_index: args.focusSceneIndex },
        strategy_id: `${args.issueType}-scene-rewrite`,
        instruction,
      };
    }

    if (args.issueType === "opening_hook") {
      return {
        base_version_id: args.baseVersionId,
        mode: "replace_span" as const,
        span: { from: 0, to: Math.min(320, args.baseText.length) },
        strategy_id: "opening-hook-upgrade",
        instruction,
      };
    }

    if (args.issueType === "ending_hook") {
      const from = Math.max(0, args.baseText.length - 360);
      return {
        base_version_id: args.baseVersionId,
        mode: "replace_span" as const,
        span: { from, to: args.baseText.length },
        strategy_id: "ending-hook-upgrade",
        instruction,
      };
    }

    if (args.issueType === "dialogue_quality" || args.issueType === "stiff_dialogue" || args.issueType === "weak_scene") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_section" as const,
        section: { scene_index: 0 },
        strategy_id: `${args.issueType}-upgrade`,
        instruction,
      };
    }

    if (args.issueType === "ai_tone" || args.issueType === "exposition_overload") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_section" as const,
        section: { scene_index: 0 },
        strategy_id: `${args.issueType}-surgery`,
        instruction,
      };
    }

    if (args.issueType === "pacing") {
      return {
        base_version_id: args.baseVersionId,
        mode: "rewrite_chapter" as const,
        strategy_id: "pacing-rewrite",
        instruction,
      };
    }

    return {
      base_version_id: args.baseVersionId,
      mode: "rewrite_chapter" as const,
      strategy_id: "continuity-fix",
      instruction,
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
      rewriteTactics: args.plan.rewrite_tactics,
      focusSpan: args.plan.focus_span,
      focusSceneIndex: args.plan.focus_scene_index,
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
