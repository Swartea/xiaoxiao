import { Inject, Injectable } from "@nestjs/common";
import type { FixPlan } from "@novel-factory/storyos-domain";
import { FixEngine } from "../engines/fix.engine";

@Injectable()
export class FixAgent {
  constructor(@Inject(FixEngine) private readonly fixEngine: FixEngine) {}

  apply(chapterId: string, plan: FixPlan, versionId?: string) {
    return this.fixEngine.applyFixPlan({
      chapterId,
      versionId,
      plan,
    });
  }
}
