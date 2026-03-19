import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma.service";
import { DIRECTOR_LOOP_POLICY } from "./director-loop.policy";
import { ContextEngine } from "../engines/context.engine";
import { PlotEngine } from "../engines/plot.engine";
import { GenerationEngine } from "../engines/generation.engine";
import { QualityEngine } from "../engines/quality.engine";
import { DirectorEngine } from "../engines/director.engine";
import { FixEngine } from "../engines/fix.engine";
import { VersionEngine } from "../engines/version.engine";
import { RunTraceEngine } from "../engines/run-trace.engine";
import { ChaptersService } from "../../chapters/chapters.service";
import {
  buildFixExhaustionBlock,
  buildQualityFailBlock,
  detectSevereEvaluationContinuity,
} from "../../chapters/review-block";

@Injectable()
export class ChapterPipelineOrchestrator {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ContextEngine) private readonly contextEngine: ContextEngine,
    @Inject(PlotEngine) private readonly plotEngine: PlotEngine,
    @Inject(GenerationEngine) private readonly generationEngine: GenerationEngine,
    @Inject(QualityEngine) private readonly qualityEngine: QualityEngine,
    @Inject(DirectorEngine) private readonly directorEngine: DirectorEngine,
    @Inject(FixEngine) private readonly fixEngine: FixEngine,
    @Inject(VersionEngine) private readonly versionEngine: VersionEngine,
    @Inject(RunTraceEngine) private readonly runTraceEngine: RunTraceEngine,
    @Inject(ChaptersService) private readonly chaptersService: ChaptersService,
  ) {}

  async runChapterPipeline(chapterId: string, options?: { style_preset?: string; retriever_strategy?: string }) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }
    this.chaptersService.assertAutomationAllowed(chapter, "自动流水线");

    const runId = randomUUID();

    const context = await this.contextEngine.buildContextBrief({
      chapterId,
      stage: "beats",
      retrieverStrategy: options?.retriever_strategy,
    });

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      agent_name: "PlannerAgent",
      prompt_version: "n/a",
      model: process.env.MODEL_BEATS ?? "default",
      style_preset: options?.style_preset,
      retriever_strategy: options?.retriever_strategy ?? "hybrid-sql-v1",
      context_hash: context.context_hash,
      token_usage: {},
      input_payload: { context },
      output_payload: { tags: context.tags },
    });

    const latestIntent = await this.prisma.chapterIntent.findFirst({
      where: { chapter_id: chapter.id },
      orderBy: { version_no: "desc" },
    });

    const beatsPlan = this.plotEngine.generateChapterBeats({
      chapterMission: latestIntent?.chapter_mission ?? `第${chapter.chapter_no}章推进主线`,
      conflictTarget: latestIntent?.conflict_target ?? chapter.conflict ?? undefined,
      hookTarget: latestIntent?.hook_target ?? chapter.cliffhanger ?? undefined,
    });

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      agent_name: "BeatAgent",
      prompt_version: "v1",
      model: process.env.MODEL_BEATS ?? "default",
      style_preset: options?.style_preset,
      retriever_strategy: options?.retriever_strategy ?? "hybrid-sql-v1",
      context_hash: context.context_hash,
      token_usage: {},
      input_payload: { intent: latestIntent },
      output_payload: { beats: beatsPlan },
    });

    const beatsInstruction = beatsPlan
      .map((beat, idx) => `${idx + 1}. goal=${beat.goal}; conflict=${beat.conflict}; ending_hook=${beat.ending_hook}`)
      .join("\n");

    const beatsResult = await this.generationEngine.generateBeats(chapterId, {
      instruction: `按以下结构化 beats 生成：\n${beatsInstruction}`,
      k: 50,
    });

    const draftResult = await this.generationEngine.generateDraft(chapterId, {
      instruction: "严格沿用 beats 的冲突升级与 ending_hook。",
      k: 50,
    });

    const polishResult = await this.generationEngine.generatePolish(chapterId, {
      instruction: "提升平台适配并强化开头/结尾钩子，不改事实。",
      k: 50,
    });

    const polishVersionId = (polishResult.version as { id: string }).id;

    const evaluated = await this.qualityEngine.evaluateChapter({
      chapterId,
      versionId: polishVersionId,
      stylePresetName: options?.style_preset,
      persist: true,
    });

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      version_id: polishVersionId,
      agent_name: "QualityAgent",
      prompt_version: "v1",
      model: process.env.MODEL_CHECK ?? "default",
      style_preset: options?.style_preset,
      retriever_strategy: options?.retriever_strategy ?? "hybrid-sql-v1",
      context_hash: context.context_hash,
      token_usage: {},
      quality_score: evaluated.evaluation.overall_score,
      input_payload: { version_id: polishVersionId },
      output_payload: { evaluation: evaluated.evaluation },
    });

    const review = this.directorEngine.reviewCurrentChapter({
      chapterId,
      versionId: polishVersionId,
      evaluation: evaluated.evaluation,
    });

    await this.directorEngine.persistReview({
      chapterId,
      versionId: polishVersionId,
      review,
    });

    const continuityBlock = detectSevereEvaluationContinuity(evaluated.evaluation);
    if (continuityBlock) {
      const blockedReview = await this.chaptersService.blockChapterReview({
        chapterId: chapter.id,
        reason: continuityBlock.reason,
        source: continuityBlock.source,
        details: continuityBlock.details,
        versionId: polishVersionId,
        reportId: evaluated.continuity_report_id ?? null,
      });
      return {
        run_id: runId,
        chapter_id: chapterId,
        stage_versions: {
          beats_version_id: (beatsResult.version as { id: string }).id,
          draft_version_id: (draftResult.version as { id: string }).id,
          polish_version_id: polishVersionId,
          final_version_id: polishVersionId,
        },
        director_review: review,
        fix_actions: [],
        final_evaluation: evaluated.evaluation,
        blocked_review: {
          status: blockedReview.status,
          reason: blockedReview.review_block_reason,
          meta: blockedReview.review_block_meta,
        },
      };
    }

    if (review.should_regenerate) {
      const blocked = buildQualityFailBlock({
        summary: review.summary ?? evaluated.evaluation.summary,
        diagnostics: evaluated.evaluation.diagnostics,
      });
      const blockedReview = await this.chaptersService.blockChapterReview({
        chapterId: chapter.id,
        reason: blocked.reason,
        source: blocked.source,
        details: blocked.details,
        versionId: polishVersionId,
        reportId: evaluated.continuity_report_id ?? null,
      });
      return {
        run_id: runId,
        chapter_id: chapterId,
        stage_versions: {
          beats_version_id: (beatsResult.version as { id: string }).id,
          draft_version_id: (draftResult.version as { id: string }).id,
          polish_version_id: polishVersionId,
          final_version_id: polishVersionId,
        },
        director_review: review,
        fix_actions: [],
        final_evaluation: evaluated.evaluation,
        blocked_review: {
          status: blockedReview.status,
          reason: blockedReview.review_block_reason,
          meta: blockedReview.review_block_meta,
        },
      };
    }

    let finalVersionId = polishVersionId;
    let finalEvaluation = evaluated.evaluation;
    const fixActions: Array<{ task_id: string; new_version_id: string }> = [];

    if (review.decision !== "accept" && review.fix_plan) {
      for (let i = 0; i < DIRECTOR_LOOP_POLICY.max_auto_fix_rounds; i += 1) {
        const fixResult = await this.fixEngine.applyFixPlan({
          chapterId,
          versionId: finalVersionId,
          plan: review.fix_plan,
        });

        finalVersionId = fixResult.fix_result.new_version_id;
        fixActions.push({
          task_id: fixResult.task_id,
          new_version_id: fixResult.fix_result.new_version_id,
        });

        const reevaluated = await this.qualityEngine.evaluateChapter({
          chapterId,
          versionId: finalVersionId,
          stylePresetName: options?.style_preset,
          persist: true,
        });

        finalEvaluation = reevaluated.evaluation;

        const blockedReview = detectSevereEvaluationContinuity(finalEvaluation);
        if (blockedReview) {
          const savedBlock = await this.chaptersService.blockChapterReview({
            chapterId: chapter.id,
            reason: blockedReview.reason,
            source: blockedReview.source,
            details: blockedReview.details,
            versionId: finalVersionId,
            reportId: reevaluated.continuity_report_id ?? null,
          });
          return {
            run_id: runId,
            chapter_id: chapterId,
            stage_versions: {
              beats_version_id: (beatsResult.version as { id: string }).id,
              draft_version_id: (draftResult.version as { id: string }).id,
              polish_version_id: polishVersionId,
              final_version_id: finalVersionId,
            },
            director_review: review,
            fix_actions: fixActions,
            final_evaluation: finalEvaluation,
            blocked_review: {
              status: savedBlock.status,
              reason: savedBlock.review_block_reason,
              meta: savedBlock.review_block_meta,
            },
          };
        }

        if (finalEvaluation.overall_score >= DIRECTOR_LOOP_POLICY.pass_threshold) {
          break;
        }
      }
    }

    if (review.fix_plan && finalEvaluation.overall_score < DIRECTOR_LOOP_POLICY.pass_threshold) {
      const blocked = buildFixExhaustionBlock({
        rounds: DIRECTOR_LOOP_POLICY.max_auto_fix_rounds,
        passThreshold: DIRECTOR_LOOP_POLICY.pass_threshold,
        overallScore: finalEvaluation.overall_score,
        summary: finalEvaluation.summary,
        diagnostics: finalEvaluation.diagnostics,
      });
      const blockedReview = await this.chaptersService.blockChapterReview({
        chapterId: chapter.id,
        reason: blocked.reason,
        source: blocked.source,
        details: blocked.details,
        versionId: finalVersionId,
      });
      return {
        run_id: runId,
        chapter_id: chapterId,
        stage_versions: {
          beats_version_id: (beatsResult.version as { id: string }).id,
          draft_version_id: (draftResult.version as { id: string }).id,
          polish_version_id: polishVersionId,
          final_version_id: finalVersionId,
        },
        director_review: review,
        fix_actions: fixActions,
        final_evaluation: finalEvaluation,
        blocked_review: {
          status: blockedReview.status,
          reason: blockedReview.review_block_reason,
          meta: blockedReview.review_block_meta,
        },
      };
    }

    await this.versionEngine.tagBestVersion(chapterId, finalVersionId);

    return {
      run_id: runId,
      chapter_id: chapterId,
      stage_versions: {
        beats_version_id: (beatsResult.version as { id: string }).id,
        draft_version_id: (draftResult.version as { id: string }).id,
        polish_version_id: polishVersionId,
        final_version_id: finalVersionId,
      },
      director_review: review,
      fix_actions: fixActions,
      final_evaluation: finalEvaluation,
    };
  }
}
