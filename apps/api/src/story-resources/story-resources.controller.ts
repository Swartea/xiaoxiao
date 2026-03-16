import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query } from "@nestjs/common";
import {
  CreateCharacterDto,
  CreateGlossaryDto,
  CreateRelationshipDto,
  CreateTimelineDto,
  UpdateCharacterDto,
  UpdateGlossaryDto,
  UpdateRelationshipDto,
  UpdateTimelineDto,
} from "../bible/dto";
import {
  CreateRegexRuleDto,
  CreateSensitiveWordDto,
  PatchChapterReferencesDto,
  ResourceListQueryDto,
  UpdateRegexRuleDto,
  UpdateSensitiveWordDto,
} from "./dto";
import { StoryReferenceService } from "./story-reference.service";
import { StoryResourcesService } from "./story-resources.service";
import { ResourceReferenceOrigin } from "@prisma/client";

@Controller("projects/:projectId")
export class StoryResourcesController {
  constructor(
    @Inject(StoryResourcesService) private readonly resourcesService: StoryResourcesService,
    @Inject(StoryReferenceService) private readonly referenceService: StoryReferenceService,
  ) {}

  @Get("characters")
  listCharacters(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listCharacters(projectId, query);
  }

  @Post("characters")
  createCharacter(@Param("projectId") projectId: string, @Body() dto: CreateCharacterDto) {
    return this.resourcesService.createCharacter(projectId, dto);
  }

  @Patch("characters/:characterId")
  updateCharacter(
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body() dto: UpdateCharacterDto,
  ) {
    return this.resourcesService.updateCharacter(projectId, characterId, dto);
  }

  @Delete("characters/:characterId")
  deleteCharacter(@Param("projectId") projectId: string, @Param("characterId") characterId: string) {
    return this.resourcesService.deleteCharacter(projectId, characterId);
  }

  @Get("glossary")
  listGlossary(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listGlossary(projectId, query);
  }

  @Post("glossary")
  createGlossary(@Param("projectId") projectId: string, @Body() dto: CreateGlossaryDto) {
    return this.resourcesService.createGlossary(projectId, dto);
  }

  @Patch("glossary/:glossaryId")
  updateGlossary(@Param("projectId") projectId: string, @Param("glossaryId") glossaryId: string, @Body() dto: UpdateGlossaryDto) {
    return this.resourcesService.updateGlossary(projectId, glossaryId, dto);
  }

  @Delete("glossary/:glossaryId")
  deleteGlossary(@Param("projectId") projectId: string, @Param("glossaryId") glossaryId: string) {
    return this.resourcesService.deleteGlossary(projectId, glossaryId);
  }

  @Get("timeline")
  listTimeline(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listTimeline(projectId, query);
  }

  @Post("timeline")
  createTimeline(@Param("projectId") projectId: string, @Body() dto: CreateTimelineDto) {
    return this.resourcesService.createTimeline(projectId, dto);
  }

  @Patch("timeline/:eventId")
  updateTimeline(@Param("projectId") projectId: string, @Param("eventId") eventId: string, @Body() dto: UpdateTimelineDto) {
    return this.resourcesService.updateTimeline(projectId, eventId, dto);
  }

  @Delete("timeline/:eventId")
  deleteTimeline(@Param("projectId") projectId: string, @Param("eventId") eventId: string) {
    return this.resourcesService.deleteTimeline(projectId, eventId);
  }

  @Get("relationships")
  listRelationships(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listRelationships(projectId, query);
  }

  @Post("relationships")
  createRelationship(@Param("projectId") projectId: string, @Body() dto: CreateRelationshipDto) {
    return this.resourcesService.createRelationship(projectId, dto);
  }

  @Patch("relationships/:relationshipId")
  updateRelationship(
    @Param("projectId") projectId: string,
    @Param("relationshipId") relationshipId: string,
    @Body() dto: UpdateRelationshipDto,
  ) {
    return this.resourcesService.updateRelationship(projectId, relationshipId, dto);
  }

  @Delete("relationships/:relationshipId")
  deleteRelationship(@Param("projectId") projectId: string, @Param("relationshipId") relationshipId: string) {
    return this.resourcesService.deleteRelationship(projectId, relationshipId);
  }

  @Get("rules/sensitive-words")
  listSensitiveWords(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listSensitiveWords(projectId, query);
  }

  @Post("rules/sensitive-words")
  createSensitiveWord(@Param("projectId") projectId: string, @Body() dto: CreateSensitiveWordDto) {
    return this.resourcesService.createSensitiveWord(projectId, dto);
  }

  @Patch("rules/sensitive-words/:resourceId")
  updateSensitiveWord(
    @Param("projectId") projectId: string,
    @Param("resourceId") resourceId: string,
    @Body() dto: UpdateSensitiveWordDto,
  ) {
    return this.resourcesService.updateSensitiveWord(projectId, resourceId, dto);
  }

  @Delete("rules/sensitive-words/:resourceId")
  deleteSensitiveWord(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.resourcesService.deleteSensitiveWord(projectId, resourceId);
  }

  @Get("rules/regex")
  listRegexRules(@Param("projectId") projectId: string, @Query() query: ResourceListQueryDto) {
    return this.resourcesService.listRegexRules(projectId, query);
  }

  @Post("rules/regex")
  createRegexRule(@Param("projectId") projectId: string, @Body() dto: CreateRegexRuleDto) {
    return this.resourcesService.createRegexRule(projectId, dto);
  }

  @Patch("rules/regex/:resourceId")
  updateRegexRule(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string, @Body() dto: UpdateRegexRuleDto) {
    return this.resourcesService.updateRegexRule(projectId, resourceId, dto);
  }

  @Delete("rules/regex/:resourceId")
  deleteRegexRule(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.resourcesService.deleteRegexRule(projectId, resourceId);
  }

  @Get("chapters/:chapterId/references")
  getChapterReferences(@Param("projectId") projectId: string, @Param("chapterId") chapterId: string) {
    return this.referenceService.getChapterReferences(projectId, chapterId);
  }

  @Patch("chapters/:chapterId/references")
  patchChapterReferences(
    @Param("projectId") projectId: string,
    @Param("chapterId") chapterId: string,
    @Body() dto: PatchChapterReferencesDto,
  ) {
    return this.referenceService.patchChapterReferences(projectId, chapterId, dto);
  }

  @Post("chapters/:chapterId/references/rebuild")
  rebuildChapterReferences(@Param("projectId") projectId: string, @Param("chapterId") chapterId: string) {
    return this.referenceService.rebuildChapterReferences(projectId, chapterId, { origin: ResourceReferenceOrigin.extractor });
  }

  @Get(":collection/:resourceId/references")
  getResourceReferences(
    @Param("projectId") projectId: string,
    @Param("collection") collection: string,
    @Param("resourceId") resourceId: string,
  ) {
    if (!["characters", "glossary", "relationships", "timeline"].includes(collection)) {
      throw new NotFoundException("Unsupported collection");
    }
    return this.referenceService.getResourceReferences(projectId, collection, resourceId);
  }

  @Get(":collection/:resourceId/stats")
  getResourceStats(
    @Param("projectId") projectId: string,
    @Param("collection") collection: string,
    @Param("resourceId") resourceId: string,
  ) {
    if (!["characters", "glossary", "relationships", "timeline"].includes(collection)) {
      throw new NotFoundException("Unsupported collection");
    }
    return this.referenceService.getResourceStats(projectId, collection, resourceId);
  }

  @Get("rules/sensitive-words/:resourceId/references")
  getSensitiveWordReferences(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.referenceService.getResourceReferences(projectId, "rules/sensitive-words", resourceId);
  }

  @Get("rules/sensitive-words/:resourceId/stats")
  getSensitiveWordStats(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.referenceService.getResourceStats(projectId, "rules/sensitive-words", resourceId);
  }

  @Get("rules/regex/:resourceId/references")
  getRegexRuleReferences(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.referenceService.getResourceReferences(projectId, "rules/regex", resourceId);
  }

  @Get("rules/regex/:resourceId/stats")
  getRegexRuleStats(@Param("projectId") projectId: string, @Param("resourceId") resourceId: string) {
    return this.referenceService.getResourceStats(projectId, "rules/regex", resourceId);
  }
}
