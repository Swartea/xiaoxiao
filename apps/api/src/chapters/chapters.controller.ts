import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ChaptersService } from "./chapters.service";
import { CreateChapterDto, RollbackChapterDto } from "./dto";

@Controller()
export class ChaptersController {
  constructor(@Inject(ChaptersService) private readonly chaptersService: ChaptersService) {}

  @Post("projects/:projectId/chapters")
  createChapter(@Param("projectId") projectId: string, @Body() dto: CreateChapterDto) {
    return this.chaptersService.createChapter(projectId, dto);
  }

  @Get("projects/:projectId/chapters")
  listProjectChapters(@Param("projectId") projectId: string) {
    return this.chaptersService.listProjectChapters(projectId);
  }

  @Get("chapters/:chapterId")
  getChapter(@Param("chapterId") chapterId: string) {
    return this.chaptersService.getChapter(chapterId);
  }

  @Get("chapters/:chapterId/versions")
  getVersions(@Param("chapterId") chapterId: string) {
    return this.chaptersService.getVersions(chapterId);
  }

  @Get("chapters/:chapterId/versions/diff")
  getDiff(
    @Param("chapterId") chapterId: string,
    @Query("from") fromVersionId: string,
    @Query("to") toVersionId: string,
  ) {
    return this.chaptersService.getVersionDiff(chapterId, fromVersionId, toVersionId);
  }

  @Post("chapters/:chapterId/rollback")
  rollback(@Param("chapterId") chapterId: string, @Body() dto: RollbackChapterDto) {
    return this.chaptersService.rollback(chapterId, dto);
  }
}
