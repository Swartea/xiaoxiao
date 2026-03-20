import { Body, Controller, Get, Headers, Inject, Param, Post } from "@nestjs/common";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapAdvisorService } from "./bootstrap-advisor.service";
import { BootstrapInspirationService } from "./bootstrap-inspiration.service";
import {
  BootstrapAdviceDto,
  BootstrapLoglineOptionsDto,
  BootstrapProjectDto,
  BootstrapRandomIdeaDto,
  BootstrapStorySeedOptionsDto,
  BootstrapTitleOptionsDto,
  BootstrapVolumePlanGenerationDto,
} from "./dto";

@Controller("projects/:projectId")
export class BootstrapController {
  constructor(
    @Inject(BootstrapService) private readonly bootstrapService: BootstrapService,
    @Inject(BootstrapAdvisorService) private readonly bootstrapAdvisorService: BootstrapAdvisorService,
    @Inject(BootstrapInspirationService) private readonly bootstrapInspirationService: BootstrapInspirationService,
  ) {}

  @Post("bootstrap")
  bootstrapProject(
    @Param("projectId") projectId: string,
    @Body() dto: BootstrapProjectDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.bootstrapService.bootstrapProject(projectId, dto, idempotencyKey);
  }

  @Post("bootstrap-advice")
  bootstrapAdvice(@Param("projectId") projectId: string, @Body() dto: BootstrapAdviceDto) {
    return this.bootstrapAdvisorService.advise(projectId, dto);
  }

  @Get("bootstrap-inspiration")
  bootstrapInspiration() {
    return this.bootstrapInspirationService.getTaxonomy();
  }

  @Post("bootstrap-story-seeds")
  bootstrapStorySeeds(@Param("projectId") projectId: string, @Body() dto: BootstrapStorySeedOptionsDto) {
    return this.bootstrapInspirationService.generateStorySeedOptions(projectId, dto);
  }

  @Post("bootstrap-titles")
  bootstrapTitles(@Param("projectId") projectId: string, @Body() dto: BootstrapTitleOptionsDto) {
    return this.bootstrapInspirationService.generateTitleOptions(projectId, dto);
  }

  @Post("bootstrap-loglines")
  bootstrapLoglines(@Param("projectId") projectId: string, @Body() dto: BootstrapLoglineOptionsDto) {
    return this.bootstrapInspirationService.generateLoglineOptions(projectId, dto);
  }

  @Post("bootstrap-volume-plan")
  bootstrapVolumePlan(@Param("projectId") projectId: string, @Body() dto: BootstrapVolumePlanGenerationDto) {
    return this.bootstrapInspirationService.generateVolumePlan(projectId, dto);
  }

  @Post("bootstrap-random-idea")
  bootstrapRandomIdea(@Param("projectId") projectId: string, @Body() dto: BootstrapRandomIdeaDto) {
    return this.bootstrapInspirationService.generateRandomIdea(projectId, dto);
  }
}
