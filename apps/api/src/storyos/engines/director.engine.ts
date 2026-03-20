import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DirectorDecision, Prisma } from "@prisma/client";
import type { ChapterEvaluation, FixPlan } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";
import { FixEngine } from "./fix.engine";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class DirectorEngine {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FixEngine) private readonly fixEngine: FixEngine,
  ) {}

  decideIfRegenerate(evaluation: ChapterEvaluation) {
    if (evaluation.overall_score < 5) {
      return true;
    }

    if (evaluation.quality.pacing.score < 4.5 && evaluation.quality.conflict_strength.score < 5) {
      return true;
    }

    return false;
  }

  chooseFixPlan(evaluation: ChapterEvaluation): FixPlan | null {
    return this.fixEngine.routeFixStrategy(evaluation);
  }

  adjustPacingDirection(evaluation: ChapterEvaluation) {
    if (evaluation.quality.pacing.score < 6) {
      return "提速，减少解释性段落，增加动作驱动段";
    }
    if (evaluation.quality.pacing.score > 8) {
      return "适度压速，补充情绪沉淀与关系反应";
    }
    return "维持当前节奏，优先强化冲突波峰";
  }

  suggestHookUpgrade(evaluation: ChapterEvaluation) {
    if (evaluation.quality.ending_hook.score < 6) {
      return "结尾加入未兑现代价或下一步风险，只揭示一半信息";
    }
    if (evaluation.quality.opening_hook.score < 6) {
      return "开头 200-300 字先抛异常，再补最小解释";
    }
    return "钩子强度可接受，维持双钩结构";
  }

  suggestArcCorrection(evaluation: ChapterEvaluation) {
    if (evaluation.quality.conflict_strength.score < 6) {
      return "主线冲突变平，下一章需提升外部压力并绑定代价";
    }
    if (evaluation.continuity.seed_payoff_miss.length > 0) {
      return "部分伏笔应提前兑现，避免长期悬置";
    }
    return "弧线推进正常";
  }

  reviewCurrentChapter(args: {
    chapterId: string;
    versionId: string;
    evaluation: ChapterEvaluation;
  }) {
    const regenerate = this.decideIfRegenerate(args.evaluation);
    const fixPlan = regenerate ? this.fixEngine.rewriteChapter() : this.chooseFixPlan(args.evaluation);

    const decision = regenerate
      ? "regenerate"
      : args.evaluation.overall_score >= 7
        ? "accept"
        : "fix";

    return {
      decision,
      should_regenerate: regenerate,
      fix_plan: fixPlan,
      pacing_direction: this.adjustPacingDirection(args.evaluation),
      hook_upgrade: this.suggestHookUpgrade(args.evaluation),
      arc_correction: this.suggestArcCorrection(args.evaluation),
      summary:
        decision === "accept"
          ? "当前版本可发布，建议局部微调后进入下章。"
          : decision === "fix"
            ? "建议先执行定向修复，再复评。"
            : "建议重生成并强制提升冲突与钩子。",
    };
  }

  async persistReview(args: {
    chapterId: string;
    versionId: string;
    review: {
      decision: string;
      should_regenerate: boolean;
      fix_plan: FixPlan | null;
      pacing_direction: string;
      hook_upgrade: string;
      arc_correction: string;
      summary: string;
    };
  }) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: args.chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const mappedDecision =
      args.review.decision === "accept"
        ? DirectorDecision.accept
        : args.review.decision === "regenerate"
          ? DirectorDecision.regenerate
          : DirectorDecision.fix;

    return this.prisma.directorReview.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        version_id: args.versionId,
        decision: mappedDecision,
        should_regenerate: args.review.should_regenerate,
        fix_plan: toJson(args.review.fix_plan),
        pacing_direction: args.review.pacing_direction,
        hook_upgrade: args.review.hook_upgrade,
        arc_correction: args.review.arc_correction,
        summary: args.review.summary,
      },
    });
  }
}
