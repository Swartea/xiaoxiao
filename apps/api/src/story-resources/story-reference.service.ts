import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ResourceReferenceOrigin, ResourceReferenceState, ResourceType } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { resourceTypeFromCollection } from "./constants";
import { PatchChapterReferencesDto } from "./dto";
import { StoryReferenceExtractorService } from "./story-reference-extractor.service";
import { StoryResourceSearchService } from "./story-resource-search.service";
import { StoryResourcesService } from "./story-resources.service";

@Injectable()
export class StoryReferenceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryResourcesService) private readonly resourcesService: StoryResourcesService,
    @Inject(StoryResourceSearchService) private readonly searchService: StoryResourceSearchService,
    @Inject(StoryReferenceExtractorService) private readonly extractor: StoryReferenceExtractorService,
  ) {}

  private async resolveChapter(projectId: string, chapterId: string) {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, project_id: projectId },
    });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }
    return chapter;
  }

  async getChapterReferences(projectId: string, chapterId: string) {
    await this.resolveChapter(projectId, chapterId);
    return this.searchService.getChapterReferences(projectId, chapterId);
  }

  async getResourceReferences(projectId: string, collection: string, resourceId: string) {
    const resourceType = resourceTypeFromCollection(collection);
    await this.resourcesService.getResourceOrThrow(projectId, resourceType, resourceId);
    return this.searchService.getResourceReferences(projectId, resourceType, resourceId);
  }

  async getResourceStats(projectId: string, collection: string, resourceId: string) {
    const resourceType = resourceTypeFromCollection(collection);
    await this.resourcesService.getResourceOrThrow(projectId, resourceType, resourceId);
    return this.searchService.getResourceStats(projectId, resourceType, resourceId);
  }

  async patchChapterReferences(projectId: string, chapterId: string, dto: PatchChapterReferencesDto) {
    const chapter = await this.resolveChapter(projectId, chapterId);
    const latestVersion = await this.prisma.chapterVersion.findFirst({
      where: { chapter_id: chapter.id },
      orderBy: { version_no: "desc" },
    });

    for (const item of dto.items) {
      const resourceType = item.resource_type as ResourceType;
      await this.resourcesService.getResourceOrThrow(projectId, resourceType, item.resource_id);
      const existing = await this.prisma.resourceReference.findFirst({
        where: {
          chapter_id: chapterId,
          resource_type: resourceType,
          resource_id: item.resource_id,
        },
      });

      const data: Prisma.ResourceReferenceUncheckedCreateInput = {
        id: existing?.id,
        project_id: projectId,
        chapter_id: chapterId,
        version_id: latestVersion?.id ?? null,
        resource_type: resourceType,
        resource_id: item.resource_id,
        state: item.state as ResourceReferenceState,
        origin: ResourceReferenceOrigin.manual,
        confidence: item.confidence ?? existing?.confidence ?? 1,
        occurrence_count: existing?.occurrence_count ?? 0,
        evidence_json: existing?.evidence_json ?? Prisma.JsonNull,
      };

      await this.prisma.resourceReference.upsert({
        where: {
          chapter_id_resource_type_resource_id: {
            chapter_id: chapterId,
            resource_type: resourceType,
            resource_id: item.resource_id,
          },
        },
        create: data,
        update: {
          version_id: latestVersion?.id ?? null,
          state: item.state as ResourceReferenceState,
          origin: ResourceReferenceOrigin.manual,
          confidence: item.confidence ?? existing?.confidence ?? 1,
        },
      });
    }

    return this.getChapterReferences(projectId, chapterId);
  }

  async rebuildChapterReferences(
    projectId: string,
    chapterId: string,
    options?: { versionId?: string; origin?: ResourceReferenceOrigin },
  ) {
    const chapter = await this.resolveChapter(projectId, chapterId);
    const version =
      options?.versionId
        ? await this.prisma.chapterVersion.findFirst({ where: { id: options.versionId, chapter_id: chapterId } })
        : await this.prisma.chapterVersion.findFirst({
            where: { chapter_id: chapterId },
            orderBy: { version_no: "desc" },
          });

    if (!version) {
      throw new NotFoundException("Chapter version not found");
    }

    const bundle = await this.resourcesService.getProjectResourceBundle(projectId);
    const candidates = this.extractor.extractFromText({
      text: version.text,
      characters: bundle.characters,
      glossary: bundle.glossary,
      timeline: bundle.timeline,
      relationships: bundle.relationships,
      sensitiveWords: bundle.sensitiveWords,
      regexRules: bundle.regexRules,
    });

    const existing = await this.prisma.resourceReference.findMany({
      where: { chapter_id: chapterId },
    });
    const candidateKeys = new Set(candidates.map((item) => `${item.resource_type}:${item.resource_id}`));

    await this.prisma.$transaction(async (tx) => {
      for (const candidate of candidates) {
        const current = existing.find(
          (item) => item.resource_type === candidate.resource_type && item.resource_id === candidate.resource_id,
        );
        await tx.resourceReference.upsert({
          where: {
            chapter_id_resource_type_resource_id: {
              chapter_id: chapterId,
              resource_type: candidate.resource_type,
              resource_id: candidate.resource_id,
            },
          },
          create: {
            project_id: projectId,
            chapter_id: chapterId,
            version_id: version.id,
            resource_type: candidate.resource_type,
            resource_id: candidate.resource_id,
            state: current?.state ?? ResourceReferenceState.inferred,
            origin: options?.origin ?? ResourceReferenceOrigin.extractor,
            confidence: candidate.confidence,
            occurrence_count: candidate.occurrence_count,
            evidence_json: candidate.evidence_json as Prisma.InputJsonObject,
          },
          update: {
            version_id: version.id,
            state:
              current?.state === ResourceReferenceState.confirmed
                ? ResourceReferenceState.confirmed
                : current?.state === ResourceReferenceState.ignored
                  ? ResourceReferenceState.ignored
                  : ResourceReferenceState.inferred,
            origin: options?.origin ?? current?.origin ?? ResourceReferenceOrigin.extractor,
            confidence: candidate.confidence,
            occurrence_count: candidate.occurrence_count,
            evidence_json: candidate.evidence_json as Prisma.InputJsonObject,
          },
        });
      }

      for (const item of existing) {
        const key = `${item.resource_type}:${item.resource_id}`;
        if (candidateKeys.has(key)) {
          continue;
        }

        if (item.state === ResourceReferenceState.confirmed || item.state === ResourceReferenceState.ignored) {
          await tx.resourceReference.update({
            where: { id: item.id },
            data: {
              version_id: version.id,
              occurrence_count: 0,
              confidence: 0,
              evidence_json: {
                missing_from_version: version.id,
                previous_state: item.state,
              },
            },
          });
          continue;
        }

        await tx.resourceReference.delete({ where: { id: item.id } });
      }
    });

    return this.getChapterReferences(projectId, chapterId);
  }

  async getPrioritizedReferenceIds(projectId: string, chapterId: string) {
    await this.resolveChapter(projectId, chapterId);
    const refs = await this.prisma.resourceReference.findMany({
      where: {
        project_id: projectId,
        chapter_id: chapterId,
        state: { in: [ResourceReferenceState.confirmed, ResourceReferenceState.inferred] },
      },
      orderBy: [{ state: "asc" }, { occurrence_count: "desc" }, { updated_at: "desc" }],
    });

    const grouped = {
      confirmed: {
        characters: [] as string[],
        glossary: [] as string[],
        timeline: [] as string[],
        relationships: [] as string[],
        sensitive_words: [] as string[],
        regex_rules: [] as string[],
      },
      inferred: {
        characters: [] as string[],
        glossary: [] as string[],
        timeline: [] as string[],
        relationships: [] as string[],
        sensitive_words: [] as string[],
        regex_rules: [] as string[],
      },
    };

    for (const ref of refs) {
      const target = ref.state === ResourceReferenceState.confirmed ? grouped.confirmed : grouped.inferred;
      if (ref.resource_type === ResourceType.character) target.characters.push(ref.resource_id);
      if (ref.resource_type === ResourceType.glossary) target.glossary.push(ref.resource_id);
      if (ref.resource_type === ResourceType.timeline_event) target.timeline.push(ref.resource_id);
      if (ref.resource_type === ResourceType.relationship) target.relationships.push(ref.resource_id);
      if (ref.resource_type === ResourceType.sensitive_word) target.sensitive_words.push(ref.resource_id);
      if (ref.resource_type === ResourceType.regex_rule) target.regex_rules.push(ref.resource_id);
    }

    return grouped;
  }
}
