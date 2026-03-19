import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from "@nestjs/common";
import { BootstrapService } from "./bootstrap.service";
import { BootstrapProjectDto } from "./dto";

@Controller("projects/:projectId")
export class BootstrapController {
  constructor(@Inject(BootstrapService) private readonly bootstrapService: BootstrapService) {}

  @Post("bootstrap")
  bootstrapProject(
    @Param("projectId") projectId: string,
    @Body() dto: BootstrapProjectDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.bootstrapService.bootstrapProject(projectId, dto, idempotencyKey);
  }

  @Get("bootstrap/status")
  getBootstrapStatus(@Param("projectId") projectId: string, @Query("idempotency_key") idempotencyKey?: string) {
    return this.bootstrapService.getBootstrapStatus(projectId, idempotencyKey);
  }
}
