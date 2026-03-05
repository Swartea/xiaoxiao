import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
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
import { normalizedContentHash } from "@novel-factory/memory";

function toJson(
  value: Record<string, unknown> | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value ? (value as Prisma.InputJsonObject) : Prisma.JsonNull;
}

@Injectable()
export class BibleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private renderBibleMarkdown(payload: {
    characters: Array<{ name: string; personality: string | null; motivation: string | null }>;
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

  async getBible(projectId: string) {
    await this.ensureProject(projectId);

    const [characters, relationships, entities, glossary, timeline] = await Promise.all([
      this.prisma.character.findMany({ where: { project_id: projectId }, orderBy: { created_at: "asc" } }),
      this.prisma.relationship.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.bibleEntity.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.glossaryTerm.findMany({ where: { project_id: projectId }, orderBy: { id: "asc" } }),
      this.prisma.timelineEvent.findMany({ where: { project_id: projectId }, orderBy: { chapter_no_ref: "asc" } }),
    ]);

    const markdown = this.renderBibleMarkdown({
      characters,
      entities,
      glossary,
      timeline,
    });

    return {
      structured: {
        characters,
        relationships,
        entities,
        glossary,
        timeline,
      },
      markdown,
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
        if (dto.relationships.length > 0) {
          await Promise.all(
            dto.relationships.map((item) =>
              tx.relationship.create({
                data: {
                  project_id: projectId,
                  from_character_id: item.from_character_id,
                  to_character_id: item.to_character_id,
                  relation_type: item.relation_type as never,
                  intensity: item.intensity,
                  notes: item.notes,
                  last_updated_chapter_no: item.last_updated_chapter_no,
                },
              }),
            ),
          );
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
      ...(dto.characters?.map((c) => c.name) ?? []),
      ...(dto.entities?.map((e) => e.name) ?? []),
      ...(dto.glossary?.map((g) => g.term) ?? []),
    ];

    const impact_chapters = await this.computeImpact(projectId, changedKeywords);

    return {
      ...(await this.getBible(projectId)),
      impact_chapters,
    };
  }

  listCharacters(projectId: string) {
    return this.prisma.character.findMany({ where: { project_id: projectId } });
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
        motivation: dto.motivation,
        secrets: dto.secrets,
        abilities: toJson(dto.abilities),
        catchphrases: dto.catchphrases ?? [],
      },
    });
  }

  updateCharacter(projectId: string, characterId: string, dto: UpdateCharacterDto) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.character.findFirst({ where: { id: characterId, project_id: projectId } });
      if (!found) {
        throw new NotFoundException("Character not found");
      }

      return tx.character.update({
        where: { id: characterId },
        data: {
          ...dto,
          aliases: dto.aliases,
          catchphrases: dto.catchphrases,
          abilities: dto.abilities ? (dto.abilities as Prisma.InputJsonObject) : undefined,
        },
      });
    });
  }

  deleteCharacter(projectId: string, characterId: string) {
    return this.prisma.character.deleteMany({
      where: { id: characterId, project_id: projectId },
    });
  }

  listRelationships(projectId: string) {
    return this.prisma.relationship.findMany({ where: { project_id: projectId } });
  }

  createRelationship(projectId: string, dto: CreateRelationshipDto) {
    return this.prisma.relationship.create({
      data: {
        project_id: projectId,
        from_character_id: dto.from_character_id,
        to_character_id: dto.to_character_id,
        relation_type: dto.relation_type as never,
        intensity: dto.intensity,
        notes: dto.notes,
        last_updated_chapter_no: dto.last_updated_chapter_no,
      },
    });
  }

  updateRelationship(projectId: string, relationshipId: string, dto: UpdateRelationshipDto) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.relationship.findFirst({ where: { id: relationshipId, project_id: projectId } });
      if (!found) {
        throw new NotFoundException("Relationship not found");
      }

      return tx.relationship.update({
        where: { id: relationshipId },
        data: {
          from_character_id: dto.from_character_id,
          to_character_id: dto.to_character_id,
          relation_type: dto.relation_type as never,
          intensity: dto.intensity,
          notes: dto.notes,
          last_updated_chapter_no: dto.last_updated_chapter_no,
        },
      });
    });
  }

  deleteRelationship(projectId: string, relationshipId: string) {
    return this.prisma.relationship.deleteMany({
      where: { id: relationshipId, project_id: projectId },
    });
  }

  listEntities(projectId: string) {
    return this.prisma.bibleEntity.findMany({ where: { project_id: projectId } });
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

  updateEntity(projectId: string, entityId: string, dto: UpdateEntityDto) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.bibleEntity.findFirst({ where: { id: entityId, project_id: projectId } });
      if (!found) {
        throw new NotFoundException("Entity not found");
      }
      return tx.bibleEntity.update({
        where: { id: entityId },
        data: dto,
      });
    });
  }

  deleteEntity(projectId: string, entityId: string) {
    return this.prisma.bibleEntity.deleteMany({
      where: { id: entityId, project_id: projectId },
    });
  }

  listGlossary(projectId: string) {
    return this.prisma.glossaryTerm.findMany({ where: { project_id: projectId } });
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

  updateGlossary(projectId: string, glossaryId: string, dto: UpdateGlossaryDto) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.glossaryTerm.findFirst({ where: { id: glossaryId, project_id: projectId } });
      if (!found) {
        throw new NotFoundException("Glossary term not found");
      }
      return tx.glossaryTerm.update({
        where: { id: glossaryId },
        data: dto,
      });
    });
  }

  deleteGlossary(projectId: string, glossaryId: string) {
    return this.prisma.glossaryTerm.deleteMany({
      where: { id: glossaryId, project_id: projectId },
    });
  }

  listTimeline(projectId: string) {
    return this.prisma.timelineEvent.findMany({ where: { project_id: projectId } });
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

  updateTimeline(projectId: string, eventId: string, dto: UpdateTimelineDto) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.timelineEvent.findFirst({ where: { id: eventId, project_id: projectId } });
      if (!found) {
        throw new NotFoundException("Timeline event not found");
      }
      return tx.timelineEvent.update({
        where: { id: eventId },
        data: {
          time_mark: dto.time_mark,
          event: dto.event,
          involved_entities: dto.involved_entities ? (dto.involved_entities as Prisma.InputJsonObject) : undefined,
          chapter_no_ref: dto.chapter_no_ref,
        },
      });
    });
  }

  deleteTimeline(projectId: string, eventId: string) {
    return this.prisma.timelineEvent.deleteMany({
      where: { id: eventId, project_id: projectId },
    });
  }
}
