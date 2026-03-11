import { Inject, Injectable } from "@nestjs/common";
import { GenerationEngine } from "../engines/generation.engine";

@Injectable()
export class PolishAgent {
  constructor(@Inject(GenerationEngine) private readonly generationEngine: GenerationEngine) {}

  generatePolish(chapterId: string, instruction?: string) {
    return this.generationEngine.generatePolish(chapterId, { instruction, k: 50 });
  }
}
