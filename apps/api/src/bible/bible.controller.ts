import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { BibleService } from "./bible.service";
import { CreateEntityDto, PatchBibleDto, UpdateEntityDto } from "./dto";

@Controller("projects/:projectId")
export class BibleController {
  constructor(@Inject(BibleService) private readonly bibleService: BibleService) {}

  @Get("bible")
  getBible(@Param("projectId") projectId: string) {
    return this.bibleService.getBible(projectId);
  }

  @Patch("bible")
  patchBible(@Param("projectId") projectId: string, @Body() dto: PatchBibleDto) {
    return this.bibleService.patchBible(projectId, dto);
  }

  @Get("entities")
  listEntities(@Param("projectId") projectId: string) {
    return this.bibleService.listEntities(projectId);
  }

  @Post("entities")
  createEntity(@Param("projectId") projectId: string, @Body() dto: CreateEntityDto) {
    return this.bibleService.createEntity(projectId, dto);
  }

  @Patch("entities/:entityId")
  updateEntity(@Param("projectId") projectId: string, @Param("entityId") entityId: string, @Body() dto: UpdateEntityDto) {
    return this.bibleService.updateEntity(projectId, entityId, dto);
  }

  @Delete("entities/:entityId")
  deleteEntity(@Param("projectId") projectId: string, @Param("entityId") entityId: string) {
    return this.bibleService.deleteEntity(projectId, entityId);
  }
}
