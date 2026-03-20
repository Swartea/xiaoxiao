import { Inject, Injectable } from "@nestjs/common";
import type { ChapterEvaluation } from "@novel-factory/storyos-domain";
import { DirectorEngine } from "../engines/director.engine";

@Injectable()
export class DirectorAgent {
  constructor(@Inject(DirectorEngine) private readonly directorEngine: DirectorEngine) {}

  review(chapterId: string, versionId: string, evaluation: ChapterEvaluation) {
    return this.directorEngine.reviewCurrentChapter({
      chapterId,
      versionId,
      evaluation,
    });
  }
}
