import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RelationType, ResourceType, Severity } from "@prisma/client";
import { normalizedContentHash } from "@novel-factory/memory";
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
} from "../bible/dto";
import { PrismaService } from "../prisma.service";
import {
  CreateRegexRuleDto,
  CreateSensitiveWordDto,
  ResourceListQueryDto,
  UpdateRegexRuleDto,
  UpdateSensitiveWordDto,
} from "./dto";
import { StoryResourceSearchService } from "./story-resource-search.service";

function toJson(
  value: Record<string, unknown> | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value ? (value as Prisma.InputJsonObject) : Prisma.JsonNull;
}

function containsIgnoreCase(value: string | null | undefined, query: string) {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes(query.toLowerCase());
}

function normalizeRelationType(value: string): RelationType {
  if ((Object.values(RelationType) as string[]).includes(value)) {
    return value as RelationType;
  }
  throw new BadRequestException(`Invalid relation_type: ${value}`);
}

@Injectable()
export class StoryResourcesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryResourceSearchService) private readonly searchService: StoryResourceSearchService,
  ) {}

  async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private parseInclude(include?: string) {
    return new Set(
      (include ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  private paginate<T>(items: T[], query?: ResourceListQueryDto) {
    const offset = query?.offset ?? 0;
    const limit = query?.limit ?? 50;
    return items.slice(offset, offset + limit);
  }

  private async attachCollectionExtras<T extends { id: string }>(
    projectId: string,
    resourceType: ResourceType,
    items: T[],
    include?: string,
  ) {
    const includes = this.parseInclude(include);
    if (!includes.has("stats") && !includes.has("references")) {
      return items;
    }

    return Promise.all(
      items.map(async (item) => ({
        ...item,
        ...(includes.has("stats")
          ? { stats: await this.searchService.getResourceStats(projectId, resourceType, item.id) }
          : {}),
        ...(includes.has("references")
          ? { references: (await this.searchService.getResourceReferences(projectId, resourceType, item.id)).references }
          : {}),
      })),
    );
  }

  private renderBibleMarkdown(payload: {
    characters: Array<{
      name: string;
      personality: string | null;
      motivation: string | null;
      visual_anchors: string | null;
      personality_tags: string | null;
      current_status: string | null;
    }>;
    entities: Array<{ type: string; name: string; description: string | null; constraints: string | null }>;
    glossary: Array<{ term: string; canonical_form: string; notes: string | null }>;
    timeline: Array<{ time_mark: string; event: string; chapter_no_ref: number }>;
  }) {
    const lines: string[] = [];
    lines.push("# 故事设定");
    lines.push("");
    lines.push("## Characters");
    for (const c of payload.characters) {
      lines.push(`- **${c.name}**`);
      if (c.personality) lines.push(`  - Personality: ${c.personality}`);
      if (c.visual_anchors) lines.push(`  - Visual Anchors: ${c.visual_anchors}`);
      if (c.personality_tags) lines.push(`  - Personality Tags: ${c.personality_tags}`);
      if (c.current_status) lines.push(`  - Current Status: ${c.current_status}`);
      if (c.motivation) lines.push(`  - Motivation: ${c.motivation}`);
    }
    lines.push("");
    lines.push("## Entities");
    for (const e of payload.entities) {
      lines.push(`- [${e.type}] **${e.name}**: ${e.description ?? ""}`);
      if (e.constraints) lines.push(`  - Constraints: ${e.constraints}`);
    }
    lines.push("");
    lines.push("## Glossary");
    for (const g of payload.glossary) {
      lines.push(`- ${g.term} => ${g.canonical_form}${g.notes ? ` (${g.notes})` : ""}`);
    }
    lines.push("");
    lines.push("## Timeline");
    for (const t of payload.timeline) {
      lines.push(`- ${t.time_mark}: ${t.event} (ch.${t.chapter_no_ref})`);
    }
    return lines.join("\n");
  }

  private async computeImpact(projectId: string, changedKeywords: string[]) {
    if (!changedKeywords.length) {
      return [] as Array<{ chapter_id: string; chapter_no: number; matched_keywords: string[] }>;
    }

    const chapters = await this.prisma.chapter.findMany({
      where: { project_id: projectId },
      include: {
        versions: {
          orderBy: { version_no: "desc" },
          take: 1,
        },
      },
      orderBy: { chapter_no: "asc" },
    });

    return chapters
      .map((chapter) => {
        const latestText = chapter.versions[0]?.text ?? "";
        const matched = changedKeywords.filter((kw) => latestText.includes(kw));
        return {
          chapter_id: chapter.id,
          chapter_no: chapter.chapter_no,
          matched_keywords: matched,
        };
      })
      .filter((item) => item.matched_keywords.length > 0);
  }

  async getProjectResourceBundle(projectId: string) {
    await this.ensureProject(projectId);
    const [characters, glossary, relationships, timeline, sensitiveWords, regexRules, worldRules] = await Promise.all([
      this.prisma.character.findMany({ where: { project_id: projectId }, orderBy: { created_at: "asc" } }),
      this.prisma.glossaryTerm.findMany({ where: { project_id: projectId }, orderBy: { term: "asc" } }),
      this.prisma.relationship.findMany({
        where: { project_id: projectId },
        include: { fromCharacter: true, toCharacter: true },
        orderBy: { id: "asc" },
      }),
      this.prisma.timelineEvent.findMany({ where: { project_id: projectId }, orderBy: { chapter_no_ref: "asc" } }),
      this.prisma.sensitiveWord.findMany({
        where: { project_id: projectId, enabled: true },
        orderBy: { created_at: "asc" },
      }),
      this.prisma.regexRule.findMany({
        where: { project_id: projectId, enabled: true },
        orderBy: { created_at: "asc" },
      }),
      this.prisma.bibleEntity.findMany({
        where: { project_id: projectId, type: { in: ["rule", "ability"] } },
        orderBy: { name: "asc" },
      }),
    ]);

    return {
      characters,
      glossary,
      relationships,
      timeline,
      sensitiveWords,
      regexRules,
      worldRules,
    };
  }

  async getBible(projectId: string) {
    await this.ensureProject(projectId);
    const [characters, relationships, entities, glossary, timeline] = await Promise.all([
      this.prisma.character.findMany({ where: { project_id: projectId }, orderBy: { created_at: "asc" } }),
      this.prisma.relationship.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.bibleEntity.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.glossaryTerm.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.timelineEvent.findMany({
        where: { project_id: projectId, source_version_id: null },
        orderBy: { chapter_no_ref: "asc" },
      }),
    ]);

    return {
      structured: {
        characters,
        relationships,
        entities,
        glossary,
        timeline,
      },
      markdown: this.renderBibleMarkdown({
        characters,
        entities,
        glossary,
        timeline,
      }),
    };
  }

  async patchBible(projectId: string, dto: PatchBibleDto) {
    await this.ensureProject(projectId);
    await this.prisma.$transaction(async (tx) => {
      if (dto.characters) {
        await tx.character.deleteMany({ where: { project_id: projectId } });
        if (dto.characters.length > 0) {
          await tx.character.createMany({
            data: dto.characters.map((item) => ({
              project_id: projectId,
              name: item.name,
              aliases: item.aliases ?? [],
              age: item.age,
              appearance: item.appearance,
              personality: item.personality,
              visual_anchors: item.visual_anchors,
              personality_tags: item.personality_tags,
              current_status: item.current_status,
              motivation: item.motivation,
              secrets: item.secrets,
              abilities: toJson(item.abilities),
              catchphrases: item.catchphrases ?? [],
            })),
          });
        }
      }

      if (dto.relationships) {
        await tx.relationship.deleteMany({ where: { project_id: projectId } });
        for (const item of dto.relationships) {
          await tx.relationship.create({
            data: {
              project_id: projectId,
              from_character_id: item.from_character_id,
              to_character_id: item.to_character_id,
              relation_type: normalizeRelationType(item.relation_type),
              intensity: item.intensity,
              notes: item.notes,
              last_updated_chapter_no: item.last_updated_chapter_no,
            },
          });
        }
      }

      if (dto.entities) {
        await tx.bibleEntity.deleteMany({ where: { project_id: projectId } });
        if (dto.entities.length > 0) {
          await tx.bibleEntity.createMany({
            data: dto.entities.map((item) => ({
              project_id: projectId,
              type: item.type,
              name: item.name,
              description: item.description,
              constraints: item.constraints,
              cost: item.cost,
              first_appearance_chapter_no: item.first_appearance_chapter_no,
            })),
          });
        }
      }

      if (dto.glossary) {
        await tx.glossaryTerm.deleteMany({ where: { project_id: projectId } });
        if (dto.glossary.length > 0) {
          await tx.glossaryTerm.createMany({
            data: dto.glossary.map((item) => ({
              project_id: projectId,
              term: item.term,
              canonical_form: item.canonical_form,
              notes: item.notes,
            })),
          });
        }
      }

      if (dto.timeline) {
        await tx.timelineEvent.deleteMany({ where: { project_id: projectId, source_version_id: null } });
        if (dto.timeline.length > 0) {
          await tx.timelineEvent.createMany({
            data: dto.timeline.map((item) => ({
              project_id: projectId,
              time_mark: item.time_mark,
              event: item.event,
              involved_entities: toJson(item.involved_entities),
              chapter_no_ref: item.chapter_no_ref,
              source_version_id: null,
              fingerprint: normalizedContentHash(`${item.time_mark}|${item.event}|${item.chapter_no_ref}`),
              status: "confirmed",
            })),
          });
        }
      }
    });

    const changedKeywords = [
      ...(dto.characters?.map((item) => item.name) ?? []),
      ...(dto.entities?.map((item) => item.name) ?? []),
      ...(dto.glossary?.map((item) => item.term) ?? []),
    ];

    return {
      ...(await this.getBible(projectId)),
      impact_chapters: await this.computeImpact(projectId, changedKeywords),
    };
  }

  async getResourceOrThrow(projectId: string, resourceType: ResourceType, resourceId: string) {
    const bundle = await this.getProjectResourceBundle(projectId);
    const resource =
      resourceType === ResourceType.character
        ? bundle.characters.find((item) => item.id === resourceId)
        : resourceType === ResourceType.glossary
          ? bundle.glossary.find((item) => item.id === resourceId)
          : resourceType === ResourceType.relationship
            ? bundle.relationships.find((item) => item.id === resourceId)
            : resourceType === ResourceType.timeline_event
              ? bundle.timeline.find((item) => item.id === resourceId)
              : resourceType === ResourceType.sensitive_word
                ? bundle.sensitiveWords.find((item) => item.id === resourceId)
                : bundle.regexRules.find((item) => item.id === resourceId);
    if (!resource) {
      throw new NotFoundException("Resource not found");
    }
    return resource;
  }

  async listCharacters(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.character.findMany({ where: { project_id: projectId }, orderBy: { created_at: "asc" } });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.name, query.q!) ||
            containsIgnoreCase(item.personality, query.q!) ||
            item.aliases.some((alias) => containsIgnoreCase(alias, query.q!)),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.character, this.paginate(filtered, query), query?.include);
  }

  createCharacter(projectId: string, dto: CreateCharacterDto) {
    return this.prisma.character.create({
      data: {
        project_id: projectId,
        name: dto.name,
        aliases: dto.aliases ?? [],
        age: dto.age,
        appearance: dto.appearance,
        personality: dto.personality,
        visual_anchors: dto.visual_anchors,
        personality_tags: dto.personality_tags,
        current_status: dto.current_status,
        motivation: dto.motivation,
        secrets: dto.secrets,
        abilities: toJson(dto.abilities),
        catchphrases: dto.catchphrases ?? [],
      },
    });
  }

  async updateCharacter(projectId: string, characterId: string, dto: UpdateCharacterDto) {
    const found = await this.prisma.character.findFirst({ where: { id: characterId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Character not found");
    }
    return this.prisma.character.update({
      where: { id: characterId },
      data: {
        ...dto,
        aliases: dto.aliases,
        catchphrases: dto.catchphrases,
        abilities: dto.abilities ? (dto.abilities as Prisma.InputJsonObject) : undefined,
      },
    });
  }

  deleteCharacter(projectId: string, characterId: string) {
    return this.prisma.character.deleteMany({ where: { id: characterId, project_id: projectId } });
  }

  async listRelationships(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.relationship.findMany({
      where: { project_id: projectId },
      include: { fromCharacter: true, toCharacter: true },
      orderBy: { intensity: "desc" },
    });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.notes, query.q!) ||
            containsIgnoreCase(item.fromCharacter.name, query.q!) ||
            containsIgnoreCase(item.toCharacter.name, query.q!) ||
            containsIgnoreCase(item.relation_type, query.q!),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.relationship, this.paginate(filtered, query), query?.include);
  }

  createRelationship(projectId: string, dto: CreateRelationshipDto) {
    return this.prisma.relationship.create({
      data: {
        project_id: projectId,
        from_character_id: dto.from_character_id,
        to_character_id: dto.to_character_id,
        relation_type: normalizeRelationType(dto.relation_type),
        intensity: dto.intensity,
        notes: dto.notes,
        last_updated_chapter_no: dto.last_updated_chapter_no,
      },
    });
  }

  async updateRelationship(projectId: string, relationshipId: string, dto: UpdateRelationshipDto) {
    const found = await this.prisma.relationship.findFirst({ where: { id: relationshipId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Relationship not found");
    }
    return this.prisma.relationship.update({
      where: { id: relationshipId },
      data: {
        from_character_id: dto.from_character_id,
        to_character_id: dto.to_character_id,
        relation_type: normalizeRelationType(dto.relation_type),
        intensity: dto.intensity,
        notes: dto.notes,
        last_updated_chapter_no: dto.last_updated_chapter_no,
      },
    });
  }

  deleteRelationship(projectId: string, relationshipId: string) {
    return this.prisma.relationship.deleteMany({ where: { id: relationshipId, project_id: projectId } });
  }

  listEntities(projectId: string) {
    return this.prisma.bibleEntity.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } });
  }

  createEntity(projectId: string, dto: CreateEntityDto) {
    return this.prisma.bibleEntity.create({
      data: {
        project_id: projectId,
        type: dto.type,
        name: dto.name,
        description: dto.description,
        constraints: dto.constraints,
        cost: dto.cost,
        first_appearance_chapter_no: dto.first_appearance_chapter_no,
      },
    });
  }

  async updateEntity(projectId: string, entityId: string, dto: UpdateEntityDto) {
    const found = await this.prisma.bibleEntity.findFirst({ where: { id: entityId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Entity not found");
    }
    return this.prisma.bibleEntity.update({
      where: { id: entityId },
      data: dto,
    });
  }

  deleteEntity(projectId: string, entityId: string) {
    return this.prisma.bibleEntity.deleteMany({ where: { id: entityId, project_id: projectId } });
  }

  async listGlossary(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.glossaryTerm.findMany({ where: { project_id: projectId }, orderBy: { term: "asc" } });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.term, query.q!) ||
            containsIgnoreCase(item.canonical_form, query.q!) ||
            containsIgnoreCase(item.notes, query.q!),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.glossary, this.paginate(filtered, query), query?.include);
  }

  createGlossary(projectId: string, dto: CreateGlossaryDto) {
    return this.prisma.glossaryTerm.create({
      data: {
        project_id: projectId,
        term: dto.term,
        canonical_form: dto.canonical_form,
        notes: dto.notes,
      },
    });
  }

  async updateGlossary(projectId: string, glossaryId: string, dto: UpdateGlossaryDto) {
    const found = await this.prisma.glossaryTerm.findFirst({ where: { id: glossaryId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Glossary term not found");
    }
    return this.prisma.glossaryTerm.update({
      where: { id: glossaryId },
      data: dto,
    });
  }

  deleteGlossary(projectId: string, glossaryId: string) {
    return this.prisma.glossaryTerm.deleteMany({ where: { id: glossaryId, project_id: projectId } });
  }

  async listTimeline(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.timelineEvent.findMany({
      where: { project_id: projectId },
      orderBy: { chapter_no_ref: "asc" },
    });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.time_mark, query.q!) ||
            containsIgnoreCase(item.event, query.q!),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.timeline_event, this.paginate(filtered, query), query?.include);
  }

  createTimeline(projectId: string, dto: CreateTimelineDto) {
    return this.prisma.timelineEvent.create({
      data: {
        project_id: projectId,
        time_mark: dto.time_mark,
        event: dto.event,
        involved_entities: toJson(dto.involved_entities),
        chapter_no_ref: dto.chapter_no_ref,
        source_version_id: null,
        fingerprint: normalizedContentHash(`${dto.time_mark}|${dto.event}|${dto.chapter_no_ref}`),
        status: "confirmed",
      },
    });
  }

  async updateTimeline(projectId: string, eventId: string, dto: UpdateTimelineDto) {
    const found = await this.prisma.timelineEvent.findFirst({ where: { id: eventId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Timeline event not found");
    }
    return this.prisma.timelineEvent.update({
      where: { id: eventId },
      data: {
        time_mark: dto.time_mark,
        event: dto.event,
        involved_entities: dto.involved_entities ? (dto.involved_entities as Prisma.InputJsonObject) : undefined,
        chapter_no_ref: dto.chapter_no_ref,
      },
    });
  }

  deleteTimeline(projectId: string, eventId: string) {
    return this.prisma.timelineEvent.deleteMany({ where: { id: eventId, project_id: projectId } });
  }

  async listSensitiveWords(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.sensitiveWord.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: "asc" },
    });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.term, query.q!) ||
            containsIgnoreCase(item.replacement, query.q!) ||
            containsIgnoreCase(item.notes, query.q!),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.sensitive_word, this.paginate(filtered, query), query?.include);
  }

  createSensitiveWord(projectId: string, dto: CreateSensitiveWordDto) {
    return this.prisma.sensitiveWord.create({
      data: {
        project_id: projectId,
        term: dto.term,
        replacement: dto.replacement,
        severity: (dto.severity ?? Severity.med) as Severity,
        notes: dto.notes,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateSensitiveWord(projectId: string, resourceId: string, dto: UpdateSensitiveWordDto) {
    const found = await this.prisma.sensitiveWord.findFirst({ where: { id: resourceId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Sensitive word not found");
    }
    return this.prisma.sensitiveWord.update({
      where: { id: resourceId },
      data: {
        term: dto.term,
        replacement: dto.replacement,
        severity: dto.severity ? (dto.severity as Severity) : undefined,
        notes: dto.notes,
        enabled: dto.enabled,
      },
    });
  }

  deleteSensitiveWord(projectId: string, resourceId: string) {
    return this.prisma.sensitiveWord.deleteMany({ where: { id: resourceId, project_id: projectId } });
  }

  async listRegexRules(projectId: string, query?: ResourceListQueryDto) {
    await this.ensureProject(projectId);
    const items = await this.prisma.regexRule.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: "asc" },
    });
    const filtered = query?.q
      ? items.filter(
          (item) =>
            containsIgnoreCase(item.name, query.q!) ||
            containsIgnoreCase(item.pattern, query.q!) ||
            containsIgnoreCase(item.description, query.q!),
        )
      : items;
    return this.attachCollectionExtras(projectId, ResourceType.regex_rule, this.paginate(filtered, query), query?.include);
  }

  createRegexRule(projectId: string, dto: CreateRegexRuleDto) {
    return this.prisma.regexRule.create({
      data: {
        project_id: projectId,
        name: dto.name,
        pattern: dto.pattern,
        flags: dto.flags,
        severity: (dto.severity ?? Severity.med) as Severity,
        description: dto.description,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async updateRegexRule(projectId: string, resourceId: string, dto: UpdateRegexRuleDto) {
    const found = await this.prisma.regexRule.findFirst({ where: { id: resourceId, project_id: projectId } });
    if (!found) {
      throw new NotFoundException("Regex rule not found");
    }
    return this.prisma.regexRule.update({
      where: { id: resourceId },
      data: {
        name: dto.name,
        pattern: dto.pattern,
        flags: dto.flags,
        severity: dto.severity ? (dto.severity as Severity) : undefined,
        description: dto.description,
        enabled: dto.enabled,
      },
    });
  }

  deleteRegexRule(projectId: string, resourceId: string) {
    return this.prisma.regexRule.deleteMany({ where: { id: resourceId, project_id: projectId } });
  }
}
