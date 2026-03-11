import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { StoryosService } from "../storyos.service";
import { CreateArcPlanDto, CreateBlueprintDto, CreatePromptTemplateDto, RollbackPromptTemplateDto } from "../dto";

@Controller()
export class StoryosProjectsController {
  constructor(@Inject(StoryosService) private readonly storyosService: StoryosService) {}

  @Post("projects/:id/blueprint")
  createBlueprint(@Param("id") projectId: string, @Body() dto: CreateBlueprintDto) {
    return this.storyosService.createBlueprint(projectId, dto);
  }

  @Post("projects/:id/arcs")
  createArcs(@Param("id") projectId: string, @Body() dto: CreateArcPlanDto) {
    return this.storyosService.createArcPlan(projectId, dto);
  }

  @Get("projects/:id/book-structure")
  getBookStructure(@Param("id") projectId: string) {
    return this.storyosService.generateBookStructure(projectId);
  }

  @Get("style-presets")
  listStylePresets() {
    return this.storyosService.listStylePresets();
  }

  @Get("prompt-templates")
  listPromptTemplates(@Query("project_id") projectId?: string) {
    return this.storyosService.listPromptTemplates(projectId);
  }

  @Post("prompt-templates")
  createPromptTemplate(@Body() dto: CreatePromptTemplateDto) {
    return this.storyosService.createPromptTemplate(dto);
  }

  @Post("prompt-templates/:id/rollback")
  rollbackPromptTemplate(@Param("id") promptTemplateId: string, @Body() dto: RollbackPromptTemplateDto) {
    return this.storyosService.rollbackPromptTemplate(promptTemplateId, dto.prompt_version);
  }
}
