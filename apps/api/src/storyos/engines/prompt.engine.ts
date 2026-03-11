import { Inject, Injectable } from "@nestjs/common";
import { PromptTemplateStage, PromptTemplateStatus, Prisma } from "@prisma/client";
import { defaultPromptSeeds } from "@novel-factory/storyos-prompts";
import { PrismaService } from "../../prisma.service";
import type { CreatePromptTemplateDto } from "../dto";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function renderTemplate(template: string, input: Record<string, unknown>) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, segment) => {
      if (acc && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[segment];
      }
      return "";
    }, input);

    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value);
  });
}

@Injectable()
export class PromptEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toStage(stage: string): PromptTemplateStage {
    if (stage === "beats") return PromptTemplateStage.beats;
    if (stage === "draft") return PromptTemplateStage.draft;
    if (stage === "polish") return PromptTemplateStage.polish;
    if (stage === "quality_eval") return PromptTemplateStage.quality_eval;
    if (stage === "fix") return PromptTemplateStage.fix;
    if (stage === "director") return PromptTemplateStage.director;
    return PromptTemplateStage.adaptation;
  }

  async ensurePromptSeeds() {
    for (const seed of defaultPromptSeeds) {
      const existing = await this.prisma.promptTemplate.findFirst({
        where: {
          project_id: null,
          prompt_name: seed.prompt_name,
        },
      });

      const template =
        existing ??
        (await this.prisma.promptTemplate.create({
          data: {
            project_id: null,
            prompt_name: seed.prompt_name,
            purpose: seed.purpose,
            status: PromptTemplateStatus.active,
            input_schema: toJson(seed.input_schema ?? {}),
            output_schema: toJson(seed.output_schema ?? {}),
          },
        }));

      for (const version of seed.versions) {
        const foundVersion = await this.prisma.promptTemplateVersion.findFirst({
          where: {
            prompt_template_id: template.id,
            prompt_version: version.prompt_version,
          },
        });

        if (!foundVersion) {
          await this.prisma.promptTemplateVersion.create({
            data: {
              project_id: null,
              prompt_template_id: template.id,
              prompt_version: version.prompt_version,
              stage: this.toStage(seed.stage),
              platform_variant: version.platform_variant,
              template: version.template,
              ab_bucket: version.ab_bucket,
              is_active: version.is_active,
            },
          });
        }
      }
    }
  }

  async listPromptTemplates(projectId?: string) {
    return this.prisma.promptTemplate.findMany({
      where: {
        OR: [
          { project_id: null },
          projectId ? { project_id: projectId } : undefined,
        ].filter(Boolean) as Array<{ project_id: string | null }>,
      },
      include: {
        versions: {
          orderBy: [{ prompt_version: "desc" }],
        },
      },
      orderBy: [{ created_at: "desc" }],
    });
  }

  async createPromptTemplate(dto: CreatePromptTemplateDto) {
    const template = await this.prisma.promptTemplate.create({
      data: {
        project_id: dto.project_id ?? null,
        prompt_name: dto.prompt_name,
        purpose: dto.purpose,
        status: PromptTemplateStatus.active,
        input_schema: toJson({}),
        output_schema: toJson({}),
      },
    });

    for (const version of dto.versions) {
      await this.prisma.promptTemplateVersion.create({
        data: {
          project_id: dto.project_id ?? null,
          prompt_template_id: template.id,
          prompt_version: version.prompt_version,
          stage: this.toStage(dto.stage),
          platform_variant: version.platform_variant,
          template: version.template,
          ab_bucket: version.ab_bucket,
          is_active: version.is_active ?? true,
        },
      });
    }

    return this.prisma.promptTemplate.findUnique({
      where: { id: template.id },
      include: { versions: { orderBy: { prompt_version: "desc" } } },
    });
  }

  async rollbackPrompt(promptTemplateId: string, promptVersion: number) {
    await this.prisma.promptTemplateVersion.updateMany({
      where: { prompt_template_id: promptTemplateId },
      data: { is_active: false },
    });

    const current = await this.prisma.promptTemplateVersion.updateMany({
      where: {
        prompt_template_id: promptTemplateId,
        prompt_version: promptVersion,
      },
      data: { is_active: true },
    });

    return { success: current.count > 0 };
  }

  async resolvePrompt(args: {
    promptName: string;
    stage: PromptTemplateStage;
    platformVariant?: string;
    promptVersion?: number;
    projectId?: string;
    input: Record<string, unknown>;
  }) {
    const template = await this.prisma.promptTemplate.findFirst({
      where: {
        prompt_name: args.promptName,
        OR: [{ project_id: args.projectId ?? "" }, { project_id: null }],
      },
      orderBy: { project_id: "desc" },
    });

    if (!template) {
      return {
        prompt_name: args.promptName,
        prompt_version: "builtin:1",
        rendered: JSON.stringify(args.input),
      };
    }

    const version = args.promptVersion
      ? await this.prisma.promptTemplateVersion.findFirst({
          where: {
            prompt_template_id: template.id,
            prompt_version: args.promptVersion,
            stage: args.stage,
          },
        })
      : await this.prisma.promptTemplateVersion.findFirst({
          where: {
            prompt_template_id: template.id,
            stage: args.stage,
            is_active: true,
            OR: [{ platform_variant: args.platformVariant ?? "default" }, { platform_variant: "default" }],
          },
          orderBy: [{ platform_variant: "desc" }, { prompt_version: "desc" }],
        });

    if (!version) {
      return {
        prompt_name: template.prompt_name,
        prompt_version: "builtin:1",
        rendered: JSON.stringify(args.input),
      };
    }

    return {
      prompt_name: template.prompt_name,
      prompt_version: `v${version.prompt_version}`,
      prompt_template_version_id: version.id,
      rendered: renderTemplate(version.template, args.input),
      raw_template: version.template,
    };
  }
}
