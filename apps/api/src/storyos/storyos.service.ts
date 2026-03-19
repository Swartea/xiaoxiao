import { Inject, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  AdaptChapterDto,
  CreateArcPlanDto,
  CreateBlueprintDto,
  CreateChapterIntentDto,
  CreatePromptTemplateDto,
  DirectorReviewDto,
  EvaluateChapterDto,
  RunExperimentDto,
} from "./dto";
import { PrismaService } from "../prisma.service";
import { PlannerAgent } from "./agents/planner.agent";
import { QualityAgent } from "./agents/quality.agent";
import { DirectorAgent } from "./agents/director.agent";
import { FixAgent } from "./agents/fix.agent";
import { AdaptationAgent } from "./agents/adaptation.agent";
import { StoryPlannerEngine } from "./engines/story-planner.engine";
import { QualityEngine } from "./engines/quality.engine";
import { DirectorEngine } from "./engines/director.engine";
import { FixEngine } from "./engines/fix.engine";
import { ExperimentEngine } from "./engines/experiment.engine";
import { PromptEngine } from "./engines/prompt.engine";
import { StylePresetRegistry } from "./engines/style-preset.registry";
import { ContextEngine } from "./engines/context.engine";
import { ChapterPipelineOrchestrator } from "./orchestrator/chapter-pipeline.orchestrator";
import { RunTraceEngine } from "./engines/run-trace.engine";
import { ChaptersService } from "../chapters/chapters.service";
import {
  buildFixExhaustionBlock,
  buildQualityFailBlock,
  detectSevereEvaluationContinuity,
} from "../chapters/review-block";
import { DIRECTOR_LOOP_POLICY } from "./orchestrator/director-loop.policy";

@Injectable()
export class StoryosService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlannerAgent) private readonly plannerAgent: PlannerAgent,
    @Inject(QualityAgent) private readonly qualityAgent: QualityAgent,
    @Inject(DirectorAgent) private readonly directorAgent: DirectorAgent,
    @Inject(FixAgent) private readonly fixAgent: FixAgent,
    @Inject(AdaptationAgent) private readonly adaptationAgent: AdaptationAgent,
    @Inject(StoryPlannerEngine) private readonly plannerEngine: StoryPlannerEngine,
    @Inject(QualityEngine) private readonly qualityEngine: QualityEngine,
    @Inject(DirectorEngine) private readonly directorEngine: DirectorEngine,
    @Inject(FixEngine) private readonly fixEngine: FixEngine,
    @Inject(ExperimentEngine) private readonly experimentEngine: ExperimentEngine,
    @Inject(PromptEngine) private readonly promptEngine: PromptEngine,
    @Inject(StylePresetRegistry) private readonly stylePresetRegistry: StylePresetRegistry,
    @Inject(ContextEngine) private readonly contextEngine: ContextEngine,
    @Inject(ChapterPipelineOrchestrator) private readonly orchestrator: ChapterPipelineOrchestrator,
    @Inject(RunTraceEngine) private readonly runTraceEngine: RunTraceEngine,
    @Inject(ChaptersService) private readonly chaptersService: ChaptersService,
  ) {}

  async onModuleInit() {
    await this.stylePresetRegistry.ensureSeeds();
    await this.promptEngine.ensurePromptSeeds();
  }

  private async resolveChapter(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }
    return chapter;
  }

  private async maybeBlockForEvaluation(args: {
    chapterId: string;
    versionId: string;
    evaluation: Awaited<ReturnType<QualityEngine["evaluateChapter"]>>["evaluation"];
    reportId?: string;
    directorReviewId?: string;
  }) {
    const blocked = detectSevereEvaluationContinuity(args.evaluation);
    if (!blocked) {
      return null;
    }

    return this.chaptersService.blockChapterReview({
      chapterId: args.chapterId,
      reason: blocked.reason,
      source: blocked.source,
      details: blocked.details,
      versionId: args.versionId,
      reportId: args.reportId ?? null,
      directorReviewId: args.directorReviewId ?? null,
    });
  }

  async createBlueprint(projectId: string, dto: CreateBlueprintDto) {
    const runId = randomUUID();
    const blueprint = await this.plannerAgent.createStoryBlueprint(projectId, dto);

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: projectId,
      agent_name: "PlannerAgent",
      prompt_version: "planner:v1",
      model: process.env.MODEL_BEATS ?? "default",
      style_preset: blueprint.target_platform ?? undefined,
      retriever_strategy: "n/a",
      context_hash: "n/a",
      token_usage: {},
      input_payload: dto as unknown as Record<string, unknown>,
      output_payload: blueprint as unknown as Record<string, unknown>,
    });

    return blueprint;
  }

  async createArcPlan(projectId: string, dto: CreateArcPlanDto) {
    return this.plannerAgent.generateArcPlan(projectId, dto);
  }

  async createChapterIntent(chapterId: string, dto: CreateChapterIntentDto) {
    const chapter = await this.resolveChapter(chapterId);
    const runId = randomUUID();
    const intent = await this.plannerAgent.generateChapterIntent(chapterId, dto);

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      agent_name: "PlannerAgent",
      prompt_version: "planner:v1",
      model: process.env.MODEL_BEATS ?? "default",
      style_preset: undefined,
      retriever_strategy: "n/a",
      context_hash: "n/a",
      token_usage: {},
      input_payload: dto as unknown as Record<string, unknown>,
      output_payload: intent as unknown as Record<string, unknown>,
    });

    return intent;
  }

  async evaluateChapter(chapterId: string, dto: EvaluateChapterDto) {
    const chapter = await this.resolveChapter(chapterId);
    const runId = randomUUID();
    const evaluated = await this.qualityAgent.evaluate(chapterId, dto.version_id, dto.style_preset);

    await this.runTraceEngine.logAgentRun({
      run_id: runId,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      version_id: evaluated.version_id,
      agent_name: "QualityAgent",
      prompt_version: "quality_eval:v1",
      model: process.env.MODEL_CHECK ?? "default",
      style_preset: dto.style_preset,
      retriever_strategy: "hybrid-sql-v1",
      context_hash: undefined,
      token_usage: {},
      quality_score: evaluated.evaluation.overall_score,
      input_payload: dto as unknown as Record<string, unknown>,
      output_payload: evaluated.evaluation as unknown as Record<string, unknown>,
    });

    const blockedReview = await this.maybeBlockForEvaluation({
      chapterId: chapter.id,
      versionId: evaluated.version_id,
      evaluation: evaluated.evaluation,
      reportId: evaluated.continuity_report_id,
    });

    return {
      ...evaluated,
      blocked_review: blockedReview
        ? {
            status: blockedReview.status,
            reason: blockedReview.review_block_reason,
            meta: blockedReview.review_block_meta,
          }
        : null,
    };
  }

  async reviewChapterByDirector(chapterId: string, dto: DirectorReviewDto) {
    const chapter = await this.resolveChapter(chapterId);
    if (dto.auto_fix === true) {
      this.chaptersService.assertAutomationAllowed(chapter, "总编闭环");
    }
    const evaluated = await this.qualityEngine.evaluateChapter({
      chapterId,
      versionId: dto.version_id,
      stylePresetName: dto.style_preset,
      persist: true,
    });

    const review = this.directorAgent.review(chapterId, evaluated.version_id, evaluated.evaluation);
    const saved = await this.directorEngine.persistReview({
      chapterId,
      versionId: evaluated.version_id,
      review,
    });

    const continuityBlock = await this.maybeBlockForEvaluation({
      chapterId: chapter.id,
      versionId: evaluated.version_id,
      evaluation: evaluated.evaluation,
      reportId: evaluated.continuity_report_id,
      directorReviewId: saved.id,
    });

    let fixResult: unknown = null;
    const shouldAutoFix = dto.auto_fix === true;
    let finalVersionId = evaluated.version_id;
    let finalEvaluation = evaluated.evaluation;

    if (shouldAutoFix && !continuityBlock && review.should_regenerate) {
      const blocked = buildQualityFailBlock({
        summary: review.summary ?? evaluated.evaluation.summary,
        diagnostics: evaluated.evaluation.diagnostics,
      });
      const blockedReview = await this.chaptersService.blockChapterReview({
        chapterId: chapter.id,
        reason: blocked.reason,
        source: blocked.source,
        details: blocked.details,
        versionId: evaluated.version_id,
        reportId: evaluated.continuity_report_id ?? null,
        directorReviewId: saved.id,
      });
      fixResult = {
        blocked_review: {
          status: blockedReview.status,
          reason: blockedReview.review_block_reason,
          meta: blockedReview.review_block_meta,
        },
      };
    } else if (shouldAutoFix && !review.should_regenerate && review.fix_plan && !continuityBlock) {
      const appliedRounds: Array<{ task_id: string; new_version_id: string }> = [];
      for (let round = 0; round < DIRECTOR_LOOP_POLICY.max_auto_fix_rounds; round += 1) {
        try {
          const applied = await this.fixAgent.apply(chapterId, review.fix_plan, finalVersionId);
          appliedRounds.push({
            task_id: applied.task_id,
            new_version_id: applied.fix_result.new_version_id,
          });
          finalVersionId = applied.fix_result.new_version_id;
          const reevaluated = await this.qualityEngine.evaluateChapter({
            chapterId,
            versionId: finalVersionId,
            stylePresetName: dto.style_preset,
            persist: true,
          });
          finalEvaluation = reevaluated.evaluation;

          const blockedReview = await this.maybeBlockForEvaluation({
            chapterId: chapter.id,
            versionId: finalVersionId,
            evaluation: finalEvaluation,
            reportId: reevaluated.continuity_report_id,
            directorReviewId: saved.id,
          });
          if (blockedReview) {
            fixResult = {
              applied_rounds: appliedRounds,
              blocked_review: {
                status: blockedReview.status,
                reason: blockedReview.review_block_reason,
                meta: blockedReview.review_block_meta,
              },
            };
            break;
          }

          if (finalEvaluation.overall_score >= DIRECTOR_LOOP_POLICY.pass_threshold) {
            fixResult = {
              applied_rounds: appliedRounds,
              final_version_id: finalVersionId,
              final_evaluation: finalEvaluation,
            };
            break;
          }
        } catch (error) {
          fixResult = {
            error: error instanceof Error ? error.message : "auto fix failed",
          };
          break;
        }
      }

      if (
        !fixResult ||
        (!("blocked_review" in (fixResult as Record<string, unknown>)) &&
          finalEvaluation.overall_score < DIRECTOR_LOOP_POLICY.pass_threshold)
      ) {
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
          directorReviewId: saved.id,
        });
        const priorFixResult = fixResult as { applied_rounds?: Array<{ task_id: string; new_version_id: string }> } | null;
        fixResult = {
          applied_rounds: Array.isArray(priorFixResult?.applied_rounds) ? priorFixResult.applied_rounds : [],
          blocked_review: {
            status: blockedReview.status,
            reason: blockedReview.review_block_reason,
            meta: blockedReview.review_block_meta,
          },
        };
      }
    }

    await this.runTraceEngine.logAgentRun({
      run_id: randomUUID(),
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      version_id: evaluated.version_id,
      agent_name: "DirectorAgent",
      prompt_version: "director:v1",
      model: process.env.MODEL_CHECK ?? "default",
      style_preset: dto.style_preset,
      retriever_strategy: "hybrid-sql-v1",
      context_hash: undefined,
      token_usage: {},
      quality_score: evaluated.evaluation.overall_score,
      input_payload: { evaluation: evaluated.evaluation },
      output_payload: review as unknown as Record<string, unknown>,
    });

    return {
      version_id: finalVersionId,
      evaluation: finalEvaluation,
      director_review: review,
      director_review_id: saved.id,
      auto_fix_enabled: shouldAutoFix,
      auto_fix: fixResult,
      blocked_review:
        continuityBlock && !fixResult
          ? {
              status: continuityBlock.status,
              reason: continuityBlock.review_block_reason,
              meta: continuityBlock.review_block_meta,
            }
          : (fixResult as Record<string, unknown> | null)?.blocked_review ?? null,
    };
  }

  runExperiment(chapterId: string, dto: RunExperimentDto) {
    return this.experimentEngine.runABTest(chapterId, dto);
  }

  async adaptScript(chapterId: string, dto: AdaptChapterDto) {
    const chapter = await this.resolveChapter(chapterId);
    const output = await this.adaptationAgent.toScript(chapterId, dto);

    await this.runTraceEngine.logAgentRun({
      run_id: randomUUID(),
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      version_id: dto.version_id,
      agent_name: "AdaptationAgent",
      prompt_version: "adaptation:v1",
      model: process.env.MODEL_POLISH ?? "default",
      style_preset: dto.target_platform,
      retriever_strategy: "n/a",
      context_hash: undefined,
      token_usage: {},
      input_payload: dto as unknown as Record<string, unknown>,
      output_payload: output as unknown as Record<string, unknown>,
    });

    return output;
  }

  async adaptStoryboard(chapterId: string, dto: AdaptChapterDto) {
    return this.adaptationAgent.toStoryboard(chapterId, dto);
  }

  listStylePresets() {
    return this.stylePresetRegistry.listPresets();
  }

  listPromptTemplates(projectId?: string) {
    return this.promptEngine.listPromptTemplates(projectId);
  }

  createPromptTemplate(dto: CreatePromptTemplateDto) {
    return this.promptEngine.createPromptTemplate(dto);
  }

  rollbackPromptTemplate(promptTemplateId: string, promptVersion: number) {
    return this.promptEngine.rollbackPrompt(promptTemplateId, promptVersion);
  }

  async buildDiagnostics(chapterId: string) {
    const chapter = await this.resolveChapter(chapterId);

    const [qualityReports, continuityReports, directorReviews, fixTasks, versions, snapshots] = await Promise.all([
      this.prisma.qualityReport.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
        take: 3,
      }),
      this.prisma.continuityReport.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
        take: 1,
      }),
      this.prisma.directorReview.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
        take: 1,
      }),
      this.prisma.fixTask.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
        take: 6,
      }),
      this.prisma.chapterVersion.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { version_no: "desc" },
        take: 6,
      }),
      this.prisma.contextSnapshot.findMany({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
        take: 1,
      }),
    ]);

    const latestQuality = qualityReports[0] ?? null;

    return {
      chapter_id: chapter.id,
      latest_quality: latestQuality,
      quality_trend: qualityReports
        .slice()
        .reverse()
        .map((report) => ({ version_id: report.version_id, overall_score: report.overall_score })),
      continuity: continuityReports[0] ?? null,
      director: directorReviews[0] ?? null,
      fix_actions: fixTasks,
      versions,
      context_snapshot: snapshots[0] ?? null,
    };
  }

  runPipeline(chapterId: string, stylePreset?: string) {
    return this.orchestrator.runChapterPipeline(chapterId, {
      style_preset: stylePreset,
      retriever_strategy: "hybrid-sql-v1",
    });
  }

  async buildContextBrief(chapterId: string, stage = "draft") {
    return this.contextEngine.buildContextBrief({ chapterId, stage, retrieverStrategy: "hybrid-sql-v1" });
  }

  generateBookStructure(projectId: string) {
    return this.plannerEngine.generateBookStructure(projectId);
  }
}
