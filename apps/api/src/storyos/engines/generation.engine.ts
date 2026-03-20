import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GenerationService } from "../../generation/generation.service";
import type { GenerateStageDto } from "../../generation/dto";

@Injectable()
export class GenerationEngine {
  constructor(@Inject(GenerationService) private readonly generationService: GenerationService) {}

  generateBeats(chapterId: string, dto: GenerateStageDto) {
    return this.generationService.generate(chapterId, "beats", dto, randomUUID());
  }

  generateDraft(chapterId: string, dto: GenerateStageDto) {
    return this.generationService.generate(chapterId, "draft", dto, randomUUID());
  }

  generatePolish(chapterId: string, dto: GenerateStageDto) {
    return this.generationService.generate(chapterId, "polish", dto, randomUUID());
  }

  generateAlternateVersion(
    chapterId: string,
    stage: "beats" | "draft" | "polish",
    instruction: string,
    k = 50,
    overrides?: {
      promptTemplateVersionId?: string;
      promptVersion?: number;
      platformVariant?: string;
      stylePresetName?: string;
      modelOverride?: string;
      retrieverStrategy?: string;
    },
  ) {
    return this.generationService.generate(
      chapterId,
      stage,
      {
        instruction,
        k,
        prompt_template_version_id: overrides?.promptTemplateVersionId,
        platform_variant: overrides?.platformVariant,
        style_preset_name: overrides?.stylePresetName,
      },
      randomUUID(),
      {
        promptTemplateVersionId: overrides?.promptTemplateVersionId,
        promptVersion: overrides?.promptVersion,
        platformVariant: overrides?.platformVariant,
        stylePresetName: overrides?.stylePresetName,
        modelOverride: overrides?.modelOverride,
        retrieverStrategy: overrides?.retrieverStrategy,
      },
    );
  }
}
