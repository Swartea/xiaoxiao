import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { AuthorAdvisorService } from "./author-advisor.service";
import { WorkspaceService } from "./workspace.service";
import { AuthorAdviceDto } from "./dto/author-advice.dto";

@Controller("chapters")
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(AuthorAdvisorService) private readonly authorAdvisorService: AuthorAdvisorService,
  ) {}

  @Get(":chapterId/workspace")
  getWorkspace(@Param("chapterId") chapterId: string) {
    return this.workspaceService.getWorkspace(chapterId);
  }

  @Post(":chapterId/author-advice")
  authorAdvice(@Param("chapterId") chapterId: string, @Body() dto: AuthorAdviceDto) {
    return this.authorAdvisorService.advise(chapterId, dto);
  }
}
