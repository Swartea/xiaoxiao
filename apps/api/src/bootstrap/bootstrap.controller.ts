import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
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
}
