import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { StoryosService } from "../storyos.service";
import {
  AdaptChapterDto,
  CreateChapterIntentDto,
  DirectorReviewDto,
  EvaluateChapterDto,
  RunExperimentDto,
} from "../dto";

@Controller("chapters")
export class StoryosChaptersController {
  constructor(@Inject(StoryosService) private readonly storyosService: StoryosService) {}

  @Post(":id/intent")
  createIntent(@Param("id") chapterId: string, @Body() dto: CreateChapterIntentDto) {
    return this.storyosService.createChapterIntent(chapterId, dto);
  }

  @Post(":id/evaluate")
  evaluate(@Param("id") chapterId: string, @Body() dto: EvaluateChapterDto) {
    return this.storyosService.evaluateChapter(chapterId, dto);
  }

  @Post(":id/director-review")
  directorReview(@Param("id") chapterId: string, @Body() dto: DirectorReviewDto) {
    return this.storyosService.reviewChapterByDirector(chapterId, dto);
  }

  @Post(":id/experiment")
  runExperiment(@Param("id") chapterId: string, @Body() dto: RunExperimentDto) {
    return this.storyosService.runExperiment(chapterId, dto);
  }

  @Post(":id/adapt/script")
  adaptScript(@Param("id") chapterId: string, @Body() dto: AdaptChapterDto) {
    return this.storyosService.adaptScript(chapterId, dto);
  }

  @Post(":id/adapt/storyboard")
  adaptStoryboard(@Param("id") chapterId: string, @Body() dto: AdaptChapterDto) {
    return this.storyosService.adaptStoryboard(chapterId, dto);
  }

  @Get(":id/diagnostics")
  diagnostics(@Param("id") chapterId: string) {
    return this.storyosService.buildDiagnostics(chapterId);
  }

  @Get(":id/context-brief")
  contextBrief(@Param("id") chapterId: string, @Query("stage") stage?: string) {
    return this.storyosService.buildContextBrief(chapterId, stage ?? "draft");
  }

  @Post(":id/pipeline-run")
  runPipeline(@Param("id") chapterId: string, @Body() body?: { style_preset?: string }) {
    return this.storyosService.runPipeline(chapterId, body?.style_preset);
  }
}
