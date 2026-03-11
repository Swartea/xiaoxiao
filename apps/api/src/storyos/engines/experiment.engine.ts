import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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

  private async ensureVariantVersion(chapterId: string, variant: ExperimentVariantDto) {
    if (variant.version_id) {
      return variant.version_id;
    }

    const generated = await this.generationEngine.generateAlternateVersion(
      chapterId,
      "polish",
      `实验分支 ${variant.label}：prompt_version=${variant.prompt_version ?? "default"}, model=${variant.model ?? "default"}, retriever=${variant.retriever_strategy ?? "default"}`,
      50,
    );

    const versionId = generated?.version?.id as string | undefined;
    if (!versionId) {
      throw new NotFoundException(`Variant ${variant.label} did not produce version`);
    }

    return versionId;
  }

  private async scoreVariant(chapterId: string, variant: ExperimentVariantDto) {
    const versionId = await this.ensureVariantVersion(chapterId, variant);
    const evaluated = await this.qualityEngine.evaluateChapter({
      chapterId,
      versionId,
      persist: false,
    });

    return {
      version_id: versionId,
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
        this.scoreVariant(chapterId, dto.variant_a),
        this.scoreVariant(chapterId, dto.variant_b),
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
            prompt_template_version_id: null,
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
            prompt_template_version_id: null,
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
          quality_score: scoredA.quality_score,
        },
        variant_b: {
          ...dto.variant_b,
          version_id: scoredB.version_id,
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
