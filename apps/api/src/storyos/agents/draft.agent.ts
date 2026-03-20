import { Inject, Injectable } from "@nestjs/common";
import { GenerationEngine } from "../engines/generation.engine";

@Injectable()
export class DraftAgent {
  constructor(@Inject(GenerationEngine) private readonly generationEngine: GenerationEngine) {}

  generateDraft(chapterId: string, instruction?: string) {
    return this.generationEngine.generateDraft(chapterId, { instruction, k: 50 });
  }
}
