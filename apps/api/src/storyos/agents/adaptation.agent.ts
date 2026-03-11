import { Inject, Injectable } from "@nestjs/common";
import type { AdaptChapterDto } from "../dto";
import { AdaptationEngine } from "../engines/adaptation.engine";

@Injectable()
export class AdaptationAgent {
  constructor(@Inject(AdaptationEngine) private readonly adaptationEngine: AdaptationEngine) {}

  toScript(chapterId: string, dto: AdaptChapterDto) {
    return this.adaptationEngine.novelToScript(chapterId, dto);
  }

  toStoryboard(chapterId: string, dto: AdaptChapterDto) {
    return this.adaptationEngine.novelToStoryboard(chapterId, dto);
  }
}
