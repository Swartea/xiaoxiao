import { Controller, Get, Inject, Param } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";

@Controller("chapters")
export class WorkspaceController {
  constructor(@Inject(WorkspaceService) private readonly workspaceService: WorkspaceService) {}

  @Get(":chapterId/workspace")
  getWorkspace(@Param("chapterId") chapterId: string) {
    return this.workspaceService.getWorkspace(chapterId);
  }
}
