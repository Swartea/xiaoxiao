import { Inject, Injectable } from "@nestjs/common";
import { StoryPlannerEngine } from "../engines/story-planner.engine";
import type { CreateArcPlanDto, CreateBlueprintDto, CreateChapterIntentDto } from "../dto";

@Injectable()
export class PlannerAgent {
  constructor(@Inject(StoryPlannerEngine) private readonly planner: StoryPlannerEngine) {}

  createStoryBlueprint(projectId: string, dto: CreateBlueprintDto) {
    return this.planner.createStoryBlueprint(projectId, dto);
  }

  generateArcPlan(projectId: string, dto: CreateArcPlanDto) {
    return this.planner.generateArcPlan(projectId, dto);
  }

  generateChapterIntent(chapterId: string, dto: CreateChapterIntentDto) {
    return this.planner.generateChapterIntent(chapterId, dto);
  }
}
