import { Inject, Injectable } from "@nestjs/common";
import { PlotEngine } from "../engines/plot.engine";

@Injectable()
export class BeatAgent {
  constructor(@Inject(PlotEngine) private readonly plotEngine: PlotEngine) {}

  generateChapterBeats(input: { chapterMission: string; conflictTarget?: string; hookTarget?: string }) {
    return this.plotEngine.generateChapterBeats(input);
  }
}
