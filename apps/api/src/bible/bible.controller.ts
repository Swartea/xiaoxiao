import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { BibleService } from "./bible.service";
import {
  CreateCharacterDto,
  CreateEntityDto,
  CreateGlossaryDto,
  CreateRelationshipDto,
  CreateTimelineDto,
  PatchBibleDto,
  UpdateCharacterDto,
  UpdateEntityDto,
  UpdateGlossaryDto,
  UpdateRelationshipDto,
  UpdateTimelineDto,
} from "./dto";

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

  @Get("characters")
  listCharacters(@Param("projectId") projectId: string) {
    return this.bibleService.listCharacters(projectId);
  }

  @Post("characters")
  createCharacter(@Param("projectId") projectId: string, @Body() dto: CreateCharacterDto) {
    return this.bibleService.createCharacter(projectId, dto);
  }

  @Patch("characters/:characterId")
  updateCharacter(
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body() dto: UpdateCharacterDto,
  ) {
    return this.bibleService.updateCharacter(projectId, characterId, dto);
  }

  @Delete("characters/:characterId")
  deleteCharacter(@Param("projectId") projectId: string, @Param("characterId") characterId: string) {
    return this.bibleService.deleteCharacter(projectId, characterId);
  }

  @Get("relationships")
  listRelationships(@Param("projectId") projectId: string) {
    return this.bibleService.listRelationships(projectId);
  }

  @Post("relationships")
  createRelationship(@Param("projectId") projectId: string, @Body() dto: CreateRelationshipDto) {
    return this.bibleService.createRelationship(projectId, dto);
  }

  @Patch("relationships/:relationshipId")
  updateRelationship(
    @Param("projectId") projectId: string,
    @Param("relationshipId") relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
  ) {
    return this.bibleService.updateRelationship(projectId, relationshipId, dto);
  }

  @Delete("relationships/:relationshipId")
  deleteRelationship(@Param("projectId") projectId: string, @Param("relationshipId") relationshipId: string) {
    return this.bibleService.deleteRelationship(projectId, relationshipId);
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

  @Get("glossary")
  listGlossary(@Param("projectId") projectId: string) {
    return this.bibleService.listGlossary(projectId);
  }

  @Post("glossary")
  createGlossary(@Param("projectId") projectId: string, @Body() dto: CreateGlossaryDto) {
    return this.bibleService.createGlossary(projectId, dto);
  }

  @Patch("glossary/:glossaryId")
  updateGlossary(
    @Param("projectId") projectId: string,
    @Param("glossaryId") glossaryId: string,
    @Body() dto: UpdateGlossaryDto,
  ) {
    return this.bibleService.updateGlossary(projectId, glossaryId, dto);
  }

  @Delete("glossary/:glossaryId")
  deleteGlossary(@Param("projectId") projectId: string, @Param("glossaryId") glossaryId: string) {
    return this.bibleService.deleteGlossary(projectId, glossaryId);
  }

  @Get("timeline")
  listTimeline(@Param("projectId") projectId: string) {
    return this.bibleService.listTimeline(projectId);
  }

  @Post("timeline")
  createTimeline(@Param("projectId") projectId: string, @Body() dto: CreateTimelineDto) {
    return this.bibleService.createTimeline(projectId, dto);
  }

  @Patch("timeline/:eventId")
  updateTimeline(@Param("projectId") projectId: string, @Param("eventId") eventId: string, @Body() dto: UpdateTimelineDto) {
    return this.bibleService.updateTimeline(projectId, eventId, dto);
  }

  @Delete("timeline/:eventId")
  deleteTimeline(@Param("projectId") projectId: string, @Param("eventId") eventId: string) {
    return this.bibleService.deleteTimeline(projectId, eventId);
  }
}
