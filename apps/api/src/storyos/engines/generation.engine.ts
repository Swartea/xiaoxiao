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

  generateAlternateVersion(chapterId: string, stage: "beats" | "draft" | "polish", instruction: string, k = 50) {
    return this.generationService.generate(
      chapterId,
      stage,
      {
        instruction,
        k,
      },
      randomUUID(),
    );
  }
}
