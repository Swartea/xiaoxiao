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

function pickTemplateString(value?: string | null, fallback?: string | null) {
  const primary = value?.trim();
  if (primary) {
    return primary;
  }
  const fallbackValue = fallback?.trim();
  return fallbackValue || "";
}

function normalizePlatformVariant(value?: string | null) {
  const normalized = value?.trim();
  return normalized || "default";
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
        const platformVariant = normalizePlatformVariant(version.platform_variant);
        const foundVersion = await this.prisma.promptTemplateVersion.findFirst({
          where: {
            prompt_template_id: template.id,
            prompt_version: version.prompt_version,
            platform_variant: platformVariant,
          },
        });

        if (!foundVersion) {
          await this.prisma.promptTemplateVersion.create({
            data: {
              project_id: null,
              prompt_template_id: template.id,
              prompt_version: version.prompt_version,
              stage: this.toStage(seed.stage),
              platform_variant: platformVariant,
              template: version.template ?? version.user_template ?? version.system_template ?? "",
              system_template: version.system_template,
              user_template: version.user_template,
              input_contract: toJson(version.input_contract ?? {}),
              output_contract: toJson(version.output_contract ?? {}),
              ab_bucket: version.ab_bucket,
              is_active: version.is_active,
            },
          });
        } else if (
          !foundVersion.system_template ||
          !foundVersion.user_template ||
          foundVersion.input_contract === null ||
          foundVersion.output_contract === null
        ) {
          await this.prisma.promptTemplateVersion.update({
            where: { id: foundVersion.id },
            data: {
              template:
                foundVersion.template ||
                version.template ||
                version.user_template ||
                version.system_template ||
                "",
              system_template: foundVersion.system_template ?? version.system_template,
              user_template: foundVersion.user_template ?? version.user_template,
              input_contract:
                foundVersion.input_contract === null ? toJson(version.input_contract ?? {}) : undefined,
              output_contract:
                foundVersion.output_contract === null ? toJson(version.output_contract ?? {}) : undefined,
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
    const existing = await this.prisma.promptTemplate.findFirst({
      where: {
        project_id: dto.project_id ?? null,
        prompt_name: dto.prompt_name,
      },
    });

    const template =
      existing ??
      (await this.prisma.promptTemplate.create({
        data: {
          project_id: dto.project_id ?? null,
          prompt_name: dto.prompt_name,
          purpose: dto.purpose,
          status: PromptTemplateStatus.active,
          input_schema: toJson({}),
          output_schema: toJson({}),
        },
      }));

    if (existing) {
      await this.prisma.promptTemplate.update({
        where: { id: existing.id },
        data: {
          purpose: dto.purpose,
          status: PromptTemplateStatus.active,
        },
      });
    }

    for (const version of dto.versions) {
      const platformVariant = normalizePlatformVariant(version.platform_variant);
      const existingVersion = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          prompt_version: version.prompt_version,
          platform_variant: platformVariant,
        },
      });

      const payload = {
        project_id: dto.project_id ?? null,
        prompt_template_id: template.id,
        prompt_version: version.prompt_version,
        stage: this.toStage(dto.stage),
        platform_variant: platformVariant,
        template: version.template ?? version.user_template ?? version.system_template ?? "",
        system_template: version.system_template,
        user_template: version.user_template,
        input_contract: toJson(version.input_contract ?? {}),
        output_contract: toJson(version.output_contract ?? {}),
        ab_bucket: version.ab_bucket,
        is_active: version.is_active ?? true,
      };

      if (existingVersion) {
        await this.prisma.promptTemplateVersion.update({
          where: { id: existingVersion.id },
          data: payload,
        });
      } else {
        await this.prisma.promptTemplateVersion.create({
          data: payload,
        });
      }
    }

    return this.prisma.promptTemplate.findUnique({
      where: { id: template.id },
      include: { versions: { orderBy: [{ prompt_version: "desc" }, { platform_variant: "asc" }] } },
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
    promptTemplateVersionId?: string;
    platformVariant?: string;
    promptVersion?: number;
    projectId?: string;
    input: Record<string, unknown>;
  }) {
    const template = args.projectId
      ? (await this.prisma.promptTemplate.findFirst({
          where: {
            prompt_name: args.promptName,
            project_id: args.projectId,
          },
        })) ??
        (await this.prisma.promptTemplate.findFirst({
          where: {
            prompt_name: args.promptName,
            project_id: null,
          },
        }))
      : await this.prisma.promptTemplate.findFirst({
          where: {
            prompt_name: args.promptName,
            project_id: null,
          },
        });

    if (!template) {
      return {
        prompt_name: args.promptName,
        prompt_version: "fallback:legacy",
        platform_variant: args.platformVariant ?? "default",
        system_rendered: "",
        user_rendered: JSON.stringify(args.input, null, 2),
        raw_system_template: "",
        raw_user_template: "",
      };
    }

    let version = args.promptTemplateVersionId
      ? await this.prisma.promptTemplateVersion.findFirst({
          where: {
            id: args.promptTemplateVersionId,
            stage: args.stage,
            promptTemplate: {
              is: {
                prompt_name: args.promptName,
              },
            },
          },
        })
      : null;

    if (!version && args.promptVersion) {
      version = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          prompt_version: args.promptVersion,
          stage: args.stage,
          platform_variant: normalizePlatformVariant(args.platformVariant),
        },
      });
    }

    if (!version && args.promptVersion) {
      version = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          prompt_version: args.promptVersion,
          stage: args.stage,
          platform_variant: "default",
        },
      });
    }

    if (!version && args.platformVariant && args.platformVariant !== "default") {
      version = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          stage: args.stage,
          is_active: true,
          platform_variant: normalizePlatformVariant(args.platformVariant),
        },
        orderBy: [{ prompt_version: "desc" }],
      });
    }

    if (!version) {
      version = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          stage: args.stage,
          is_active: true,
          platform_variant: "default",
        },
        orderBy: [{ prompt_version: "desc" }],
      });
    }

    if (!version) {
      version = await this.prisma.promptTemplateVersion.findFirst({
        where: {
          prompt_template_id: template.id,
          stage: args.stage,
          is_active: true,
        },
        orderBy: [{ prompt_version: "desc" }],
      });
    }

    if (!version) {
      return {
        prompt_name: template.prompt_name,
        prompt_version: "fallback:legacy",
        platform_variant: args.platformVariant ?? "default",
        system_rendered: "",
        user_rendered: JSON.stringify(args.input, null, 2),
        raw_system_template: "",
        raw_user_template: "",
      };
    }

    const rawSystemTemplate = pickTemplateString(version.system_template, "");
    const rawUserTemplate = pickTemplateString(version.user_template, version.template);

    return {
      prompt_name: template.prompt_name,
      prompt_version: `v${version.prompt_version}`,
      prompt_template_version_id: version.id,
      platform_variant: version.platform_variant,
      system_rendered: renderTemplate(rawSystemTemplate, args.input),
      user_rendered: renderTemplate(rawUserTemplate, args.input),
      raw_system_template: rawSystemTemplate,
      raw_user_template: rawUserTemplate,
      raw_template: version.template,
      input_contract: version.input_contract,
      output_contract: version.output_contract,
    };
  }
}
