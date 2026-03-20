import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ExperimentStatus, ExperimentType, Prisma } from "@prisma/client";
import type { ExperimentVariantDto, RunExperimentDto } from "../dto/run-experiment.dto";
import { PrismaService } from "../../prisma.service";
import { QualityEngine } from "./quality.engine";
import { GenerationEngine } from "./generation.engine";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class ExperimentEngine {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QualityEngine) private readonly qualityEngine: QualityEngine,
    @Inject(GenerationEngine) private readonly generationEngine: GenerationEngine,
  ) {}

  private mapType(type: RunExperimentDto["type"]) {
    if (type === "prompt_ab") return ExperimentType.prompt_ab;
    if (type === "model_compare") return ExperimentType.model_compare;
    return ExperimentType.retriever_compare;
  }

  private normalizePromptVersion(variant: ExperimentVariantDto) {
    if (typeof variant.prompt_version_number === "number") {
      return variant.prompt_version_number;
    }
    if (typeof variant.prompt_version !== "string") {
      return undefined;
    }
    const normalized = Number.parseInt(variant.prompt_version.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : undefined;
  }

  private stageFromPromptName(promptName?: string | null) {
    const normalized = promptName?.trim();
    if (normalized === "beats_prompt") return "beats" as const;
    if (normalized === "draft_prompt") return "draft" as const;
    if (normalized === "polish_prompt") return "polish" as const;
    if (normalized === "fix_prompt") return "fix" as const;
    return null;
  }

  private async resolveExperimentStage(variant: ExperimentVariantDto, type: RunExperimentDto["type"]) {
    if (type !== "prompt_ab") {
      return "polish" as const;
    }

    if (variant.prompt_template_version_id) {
      const promptVersion = await this.prisma.promptTemplateVersion.findUnique({
        where: { id: variant.prompt_template_version_id },
        include: {
          promptTemplate: {
            select: {
              prompt_name: true,
            },
          },
        },
      });
      if (!promptVersion) {
        throw new NotFoundException(`Prompt template version ${variant.prompt_template_version_id} not found`);
      }
      const stage = this.stageFromPromptName(promptVersion.promptTemplate.prompt_name);
      if (stage === "beats" || stage === "draft" || stage === "polish") {
        return stage;
      }
      throw new BadRequestException("Prompt A/B currently supports beats/draft/polish templates only");
    }

    const stage = this.stageFromPromptName(variant.prompt_name);
    if (stage === "beats" || stage === "draft" || stage === "polish") {
      return stage;
    }
    throw new BadRequestException("Prompt A/B requires prompt_template_version_id or prompt_name for beats/draft/polish");
  }

  private assertPromptABVariants(variantA: ExperimentVariantDto, variantB: ExperimentVariantDto) {
    const sameVersionId =
      variantA.prompt_template_version_id &&
      variantB.prompt_template_version_id &&
      variantA.prompt_template_version_id === variantB.prompt_template_version_id;
    if (sameVersionId) {
      throw new BadRequestException("Prompt A/B requires two different prompt template versions");
    }

    const aKey = [
      variantA.prompt_name ?? "",
      this.normalizePromptVersion(variantA) ?? "",
      variantA.platform_variant ?? "",
    ].join("|");
    const bKey = [
      variantB.prompt_name ?? "",
      this.normalizePromptVersion(variantB) ?? "",
      variantB.platform_variant ?? "",
    ].join("|");
    if (aKey !== "||" && aKey === bKey) {
      throw new BadRequestException("Prompt A/B variants must differ");
    }
  }

  async comparePrompts(chapterId: string, variantA: ExperimentVariantDto, variantB: ExperimentVariantDto) {
    return this.runABTest(chapterId, {
      type: "prompt_ab",
      variant_a: variantA,
      variant_b: variantB,
    });
  }

  async compareModels(chapterId: string, variantA: ExperimentVariantDto, variantB: ExperimentVariantDto) {
    return this.runABTest(chapterId, {
      type: "model_compare",
      variant_a: variantA,
      variant_b: variantB,
    });
  }

  async compareRetrieverStrategies(chapterId: string, variantA: ExperimentVariantDto, variantB: ExperimentVariantDto) {
    return this.runABTest(chapterId, {
      type: "retriever_compare",
      variant_a: variantA,
      variant_b: variantB,
    });
  }

  private async ensureVariantVersion(chapterId: string, variant: ExperimentVariantDto, type: RunExperimentDto["type"]) {
    if (variant.version_id) {
      return {
        version_id: variant.version_id,
        prompt_template_version_id: variant.prompt_template_version_id ?? null,
      };
    }

    const stage = await this.resolveExperimentStage(variant, type);
    const generated = await this.generationEngine.generateAlternateVersion(
      chapterId,
      stage,
      `实验分支 ${variant.label}：聚焦比较当前方案差异，保持章节事实不变。`,
      50,
      {
        promptTemplateVersionId: variant.prompt_template_version_id,
        promptVersion: this.normalizePromptVersion(variant),
        platformVariant: variant.platform_variant,
        modelOverride: variant.model,
        retrieverStrategy: variant.retriever_strategy,
      },
    );

    const versionId = generated?.version?.id as string | undefined;
    if (!versionId) {
      throw new NotFoundException(`Variant ${variant.label} did not produce version`);
    }

    const promptMeta = ((generated?.version?.meta ?? {}) as Record<string, unknown>) ?? {};
    return {
      version_id: versionId,
      prompt_template_version_id:
        variant.prompt_template_version_id ??
        (typeof promptMeta.prompt_template_version_id === "string" ? promptMeta.prompt_template_version_id : null),
    };
  }

  private async scoreVariant(chapterId: string, variant: ExperimentVariantDto, type: RunExperimentDto["type"]) {
    const ensured = await this.ensureVariantVersion(chapterId, variant, type);
    const evaluated = await this.qualityEngine.evaluateChapter({
      chapterId,
      versionId: ensured.version_id,
      persist: false,
    });

    return {
      version_id: ensured.version_id,
      prompt_template_version_id: ensured.prompt_template_version_id,
      quality_score: evaluated.evaluation.overall_score,
    };
  }

  private decideWinner(input: {
    qualityA: number;
    qualityB: number;
    manualA?: number;
    manualB?: number;
  }) {
    if (typeof input.manualA === "number" && typeof input.manualB === "number") {
      if (input.manualA === input.manualB) return "draw" as const;
      return input.manualA > input.manualB ? "a" as const : "b" as const;
    }

    if (input.qualityA === input.qualityB) return "draw" as const;
    return input.qualityA > input.qualityB ? "a" as const : "b" as const;
  }

  async recordManualFeedback(experimentId: string, manualA: number, manualB: number) {
    const experiment = await this.prisma.experimentRun.findUnique({ where: { id: experimentId } });
    if (!experiment) {
      throw new NotFoundException("Experiment run not found");
    }

    const winner = this.decideWinner({
      qualityA: experiment.quality_score_a ?? 0,
      qualityB: experiment.quality_score_b ?? 0,
      manualA,
      manualB,
    });

    return this.prisma.experimentRun.update({
      where: { id: experimentId },
      data: {
        manual_score_a: manualA,
        manual_score_b: manualB,
        winner,
      },
    });
  }

  async runABTest(chapterId: string, dto: RunExperimentDto) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    if (dto.type === "prompt_ab") {
      this.assertPromptABVariants(dto.variant_a, dto.variant_b);
    }

    const created = await this.prisma.experimentRun.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        experiment_type: this.mapType(dto.type),
        status: ExperimentStatus.running,
        variant_a: toJson(dto.variant_a),
        variant_b: toJson(dto.variant_b),
      },
    });

    try {
      const [scoredA, scoredB] = await Promise.all([
        this.scoreVariant(chapterId, dto.variant_a, dto.type),
        this.scoreVariant(chapterId, dto.variant_b, dto.type),
      ]);

      const winner = this.decideWinner({
        qualityA: scoredA.quality_score,
        qualityB: scoredB.quality_score,
        manualA: dto.variant_a.manual_score,
        manualB: dto.variant_b.manual_score,
      });

      const updated = await this.prisma.experimentRun.update({
        where: { id: created.id },
        data: {
          status: ExperimentStatus.completed,
          quality_score_a: scoredA.quality_score,
          quality_score_b: scoredB.quality_score,
          manual_score_a: dto.variant_a.manual_score,
          manual_score_b: dto.variant_b.manual_score,
          winner,
          result: toJson({
            winner,
            reason:
              winner === "draw"
                ? "A/B 质量分接近，建议人工复核"
                : winner === "a"
                  ? "A 方案质量或人工分更高"
                  : "B 方案质量或人工分更高",
          }),
        },
      });

      await this.prisma.experimentVariant.createMany({
        data: [
          {
            experiment_run_id: updated.id,
            name: dto.variant_a.label,
            prompt_template_version_id: scoredA.prompt_template_version_id,
            generated_version_id: scoredA.version_id,
            model: dto.variant_a.model,
            retriever_strategy: dto.variant_a.retriever_strategy,
            quality_score: scoredA.quality_score,
            manual_score: dto.variant_a.manual_score,
            meta: toJson(dto.variant_a),
          },
          {
            experiment_run_id: updated.id,
            name: dto.variant_b.label,
            prompt_template_version_id: scoredB.prompt_template_version_id,
            generated_version_id: scoredB.version_id,
            model: dto.variant_b.model,
            retriever_strategy: dto.variant_b.retriever_strategy,
            quality_score: scoredB.quality_score,
            manual_score: dto.variant_b.manual_score,
            meta: toJson(dto.variant_b),
          },
        ],
      });

      return {
        experiment_id: updated.id,
        chapter_id: chapter.id,
        type: dto.type,
        variant_a: {
          ...dto.variant_a,
          version_id: scoredA.version_id,
          prompt_template_version_id: scoredA.prompt_template_version_id ?? dto.variant_a.prompt_template_version_id,
          quality_score: scoredA.quality_score,
        },
        variant_b: {
          ...dto.variant_b,
          version_id: scoredB.version_id,
          prompt_template_version_id: scoredB.prompt_template_version_id ?? dto.variant_b.prompt_template_version_id,
          quality_score: scoredB.quality_score,
        },
        winner: updated.winner,
      };
    } catch (error) {
      await this.prisma.experimentRun.update({
        where: { id: created.id },
        data: {
          status: ExperimentStatus.failed,
          result: toJson({ error: error instanceof Error ? error.message : "experiment failed" }),
        },
      });
      throw error;
    }
  }
}
