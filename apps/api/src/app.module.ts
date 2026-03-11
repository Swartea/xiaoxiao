import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { resolve } from "node:path";
import { PrismaService } from "./prisma.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectsService } from "./projects/projects.service";
import { BibleController } from "./bible/bible.controller";
import { BibleService } from "./bible/bible.service";
import { ChaptersController } from "./chapters/chapters.controller";
import { ChaptersService } from "./chapters/chapters.service";
import { GenerationController } from "./generation/generation.controller";
import { GenerationService } from "./generation/generation.service";
import { WorkspaceController } from "./workspace/workspace.controller";
import { WorkspaceService } from "./workspace/workspace.service";
import { OutlineController } from "./outline/outline.controller";
import { OutlineService } from "./outline/outline.service";
import { BootstrapController } from "./bootstrap/bootstrap.controller";
import { BootstrapService } from "./bootstrap/bootstrap.service";
import { StoryosProjectsController } from "./storyos/controllers/storyos-projects.controller";
import { StoryosChaptersController } from "./storyos/controllers/storyos-chapters.controller";
import { StoryosService } from "./storyos/storyos.service";
import { StoryPlannerEngine } from "./storyos/engines/story-planner.engine";
import { PlotEngine } from "./storyos/engines/plot.engine";
import { CharacterEngine } from "./storyos/engines/character.engine";
import { MemoryEngine } from "./storyos/engines/memory.engine";
import { ContextEngine } from "./storyos/engines/context.engine";
import { PromptEngine } from "./storyos/engines/prompt.engine";
import { GenerationEngine } from "./storyos/engines/generation.engine";
import { QualityEngine } from "./storyos/engines/quality.engine";
import { ContinuityEvaluatorEngine } from "./storyos/engines/continuity-evaluator.engine";
import { FixEngine } from "./storyos/engines/fix.engine";
import { DirectorEngine } from "./storyos/engines/director.engine";
import { ExperimentEngine } from "./storyos/engines/experiment.engine";
import { AdaptationEngine } from "./storyos/engines/adaptation.engine";
import { VersionEngine } from "./storyos/engines/version.engine";
import { StylePresetRegistry } from "./storyos/engines/style-preset.registry";
import { RunTraceEngine } from "./storyos/engines/run-trace.engine";
import { PlannerAgent } from "./storyos/agents/planner.agent";
import { BeatAgent } from "./storyos/agents/beat.agent";
import { DraftAgent } from "./storyos/agents/draft.agent";
import { PolishAgent } from "./storyos/agents/polish.agent";
import { QualityAgent } from "./storyos/agents/quality.agent";
import { ContinuityAgent } from "./storyos/agents/continuity.agent";
import { FixAgent } from "./storyos/agents/fix.agent";
import { DirectorAgent } from "./storyos/agents/director.agent";
import { AdaptationAgent } from "./storyos/agents/adaptation.agent";
import { ChapterPipelineOrchestrator } from "./storyos/orchestrator/chapter-pipeline.orchestrator";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Support running from repo root or apps/api cwd.
      envFilePath: [
        resolve(process.cwd(), "apps/api/.env"),
        resolve(process.cwd(), ".env"),
        ".env",
      ],
    }),
  ],
  controllers: [
    ProjectsController,
    BibleController,
    ChaptersController,
    GenerationController,
    WorkspaceController,
    OutlineController,
    BootstrapController,
    StoryosProjectsController,
    StoryosChaptersController,
  ],
  providers: [
    PrismaService,
    ProjectsService,
    BibleService,
    ChaptersService,
    GenerationService,
    WorkspaceService,
    OutlineService,
    BootstrapService,
    StoryosService,
    StoryPlannerEngine,
    PlotEngine,
    CharacterEngine,
    MemoryEngine,
    ContextEngine,
    PromptEngine,
    GenerationEngine,
    QualityEngine,
    ContinuityEvaluatorEngine,
    FixEngine,
    DirectorEngine,
    ExperimentEngine,
    AdaptationEngine,
    VersionEngine,
    StylePresetRegistry,
    RunTraceEngine,
    PlannerAgent,
    BeatAgent,
    DraftAgent,
    PolishAgent,
    QualityAgent,
    ContinuityAgent,
    FixAgent,
    DirectorAgent,
    AdaptationAgent,
    ChapterPipelineOrchestrator,
  ],
})
export class AppModule {}
