import { Body, Controller, Get, Inject, Param, Patch } from "@nestjs/common";
import { OutlineService } from "./outline.service";
import { PatchOutlineDto, PatchOutlineWorkspaceDto } from "./dto";

@Controller("projects/:projectId/outline")
export class OutlineController {
  constructor(@Inject(OutlineService) private readonly outlineService: OutlineService) {}

  @Get()
  getOutline(@Param("projectId") projectId: string) {
    return this.outlineService.getOutline(projectId);
  }

  @Get("workspace")
  getOutlineWorkspace(@Param("projectId") projectId: string) {
    return this.outlineService.getOutlineWorkspace(projectId);
  }

  @Patch()
  patchOutline(@Param("projectId") projectId: string, @Body() dto: PatchOutlineDto) {
    return this.outlineService.patchOutline(projectId, dto);
  }

  @Patch("workspace")
  patchOutlineWorkspace(@Param("projectId") projectId: string, @Body() dto: PatchOutlineWorkspaceDto) {
    return this.outlineService.patchOutlineWorkspace(projectId, dto);
  }
}
