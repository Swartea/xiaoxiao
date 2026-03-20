import { Body, Controller, Headers, Inject, Param, Patch, Post } from "@nestjs/common";
import { ExtractedStatus } from "@prisma/client";
import { GenerationService } from "./generation.service";
import { CheckContinuityDto, GenerateStageDto, UpdateExtractionStatusDto } from "./dto";

@Controller("chapters/:chapterId")
export class GenerationController {
  constructor(@Inject(GenerationService) private readonly generationService: GenerationService) {}

  @Post("generate/beats")
  generateBeats(
    @Param("chapterId") chapterId: string,
    @Body() dto: GenerateStageDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.generationService.generate(chapterId, "beats", dto, idempotencyKey);
  }

  @Post("generate/draft")
  generateDraft(
    @Param("chapterId") chapterId: string,
    @Body() dto: GenerateStageDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.generationService.generate(chapterId, "draft", dto, idempotencyKey);
  }

  @Post("generate/polish")
  generatePolish(
    @Param("chapterId") chapterId: string,
    @Body() dto: GenerateStageDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.generationService.generate(chapterId, "polish", dto, idempotencyKey);
  }

  @Post("check/continuity")
  checkContinuity(@Param("chapterId") chapterId: string, @Body() dto: CheckContinuityDto) {
    return this.generationService.checkContinuity(chapterId, dto);
  }

  @Post("fix")
  fix(
    @Param("chapterId") chapterId: string,
    @Body() payload: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.generationService.fix(chapterId, payload, idempotencyKey);
  }

  @Post("fix/preview")
  previewFix(@Param("chapterId") chapterId: string, @Body() payload: unknown) {
    return this.generationService.previewFix(chapterId, payload);
  }

  @Patch("facts/:factId/status")
  updateFactStatus(
    @Param("chapterId") chapterId: string,
    @Param("factId") factId: string,
    @Body() dto: UpdateExtractionStatusDto,
  ) {
    return this.generationService.updateFactStatus(chapterId, factId, dto.status as ExtractedStatus);
  }

  @Patch("seeds/:seedId/status")
  updateSeedStatus(
    @Param("chapterId") chapterId: string,
    @Param("seedId") seedId: string,
    @Body() dto: UpdateExtractionStatusDto,
  ) {
    return this.generationService.updateSeedStatus(chapterId, seedId, dto.status as ExtractedStatus);
  }

  @Patch("timeline/:eventId/status")
  updateTimelineStatus(
    @Param("chapterId") chapterId: string,
    @Param("eventId") eventId: string,
    @Body() dto: UpdateExtractionStatusDto,
  ) {
    return this.generationService.updateTimelineStatus(chapterId, eventId, dto.status as ExtractedStatus);
  }
}
