import { Inject, Injectable } from "@nestjs/common";
import { QualityEngine } from "../engines/quality.engine";

@Injectable()
export class QualityAgent {
  constructor(@Inject(QualityEngine) private readonly qualityEngine: QualityEngine) {}

  evaluate(chapterId: string, versionId?: string, stylePreset?: string) {
    return this.qualityEngine.evaluateChapter({
      chapterId,
      versionId,
      stylePresetName: stylePreset,
      persist: true,
    });
  }
}
