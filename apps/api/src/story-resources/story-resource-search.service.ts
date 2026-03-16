import { Inject, Injectable } from "@nestjs/common";
import { type ResourceReference, type ResourceType } from "@prisma/client";
import { RESOURCE_GROUP_KEYS, RESOURCE_TYPE_TO_COLLECTION } from "./constants";
import { PrismaService } from "../prisma.service";

type ResourceReferenceWithLinks = ResourceReference & {
  chapter: {
    id: string;
    chapter_no: number;
    title: string | null;
  };
  version: {
    id: string;
    version_no: number;
    stage: string;
  } | null;
};

@Injectable()
export class StoryResourceSearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private emptyGroupedReferences() {
    return {
      characters: [] as any[],
      glossary: [] as any[],
      relationships: [] as any[],
      timeline: [] as any[],
      sensitive_words: [] as any[],
      regex_rules: [] as any[],
    };
  }

  private async loadDetails(projectId: string, refs: ResourceReference[]) {
    const idsByType = new Map<ResourceType, string[]>();
    for (const ref of refs) {
      const current = idsByType.get(ref.resource_type) ?? [];
      current.push(ref.resource_id);
      idsByType.set(ref.resource_type, current);
    }

    const [characters, glossary, relationships, timeline, sensitiveWords, regexRules] = await Promise.all([
      idsByType.get("character")
        ? this.prisma.character.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("character") } },
          })
        : Promise.resolve([]),
      idsByType.get("glossary")
        ? this.prisma.glossaryTerm.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("glossary") } },
          })
        : Promise.resolve([]),
      idsByType.get("relationship")
        ? this.prisma.relationship.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("relationship") } },
            include: { fromCharacter: true, toCharacter: true },
          })
        : Promise.resolve([]),
      idsByType.get("timeline_event")
        ? this.prisma.timelineEvent.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("timeline_event") } },
          })
        : Promise.resolve([]),
      idsByType.get("sensitive_word")
        ? this.prisma.sensitiveWord.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("sensitive_word") } },
          })
        : Promise.resolve([]),
      idsByType.get("regex_rule")
        ? this.prisma.regexRule.findMany({
            where: { project_id: projectId, id: { in: idsByType.get("regex_rule") } },
          })
        : Promise.resolve([]),
    ]);

    const detailMap = new Map<string, unknown>();
    for (const item of characters) detailMap.set(`character:${item.id}`, item);
    for (const item of glossary) detailMap.set(`glossary:${item.id}`, item);
    for (const item of relationships) detailMap.set(`relationship:${item.id}`, item);
    for (const item of timeline) detailMap.set(`timeline_event:${item.id}`, item);
    for (const item of sensitiveWords) detailMap.set(`sensitive_word:${item.id}`, item);
    for (const item of regexRules) detailMap.set(`regex_rule:${item.id}`, item);
    return detailMap;
  }

  async getResourceStats(projectId: string, resourceType: ResourceType, resourceId: string) {
    const refs = await this.prisma.resourceReference.findMany({
      where: {
        project_id: projectId,
        resource_type: resourceType,
        resource_id: resourceId,
      },
      include: {
        chapter: {
          select: {
            id: true,
            chapter_no: true,
            title: true,
          },
        },
      },
      orderBy: [{ updated_at: "desc" }],
    });

    const distinctChapters = new Map(refs.map((ref) => [ref.chapter_id, ref.chapter]));
    const totalHits = refs.reduce((acc, ref) => acc + ref.occurrence_count, 0);
    const stateDistribution = refs.reduce(
      (acc, ref) => {
        acc[ref.state] += 1;
        return acc;
      },
      { inferred: 0, confirmed: 0, ignored: 0 },
    );

    let canonicalConflictCount = 0;
    if (resourceType === "glossary") {
      const current = await this.prisma.glossaryTerm.findFirst({ where: { project_id: projectId, id: resourceId } });
      if (current) {
        const siblings = await this.prisma.glossaryTerm.findMany({
          where: { project_id: projectId },
          select: { term: true, canonical_form: true },
        });
        const conflictSet = new Set(
          siblings
            .filter((item) => item.term.trim().toLowerCase() === current.term.trim().toLowerCase())
            .map((item) => item.canonical_form.trim().toLowerCase()),
        );
        canonicalConflictCount = Math.max(0, conflictSet.size - 1);
      }
    }

    const latestChapter = Array.from(distinctChapters.values()).sort((a, b) => b.chapter_no - a.chapter_no)[0] ?? null;
    return {
      collection: RESOURCE_TYPE_TO_COLLECTION[resourceType],
      resource_type: resourceType,
      resource_id: resourceId,
      total_chapters: distinctChapters.size,
      latest_chapter_no: latestChapter?.chapter_no ?? null,
      total_hits: totalHits,
      canonical_conflict_count: canonicalConflictCount,
      state_distribution: stateDistribution,
      hot_chapters: Array.from(distinctChapters.values()).slice(0, 5),
    };
  }

  private async enrichReferences(projectId: string, refs: ResourceReferenceWithLinks[]) {
    const detailMap = await this.loadDetails(projectId, refs);
    return Promise.all(
      refs.map(async (ref) => ({
        ...ref,
        collection: RESOURCE_TYPE_TO_COLLECTION[ref.resource_type],
        resource: detailMap.get(`${ref.resource_type}:${ref.resource_id}`) ?? null,
        stats: await this.getResourceStats(projectId, ref.resource_type, ref.resource_id),
      })),
    );
  }

  async getChapterReferences(projectId: string, chapterId: string) {
    const refs = (await this.prisma.resourceReference.findMany({
      where: {
        project_id: projectId,
        chapter_id: chapterId,
      },
      include: {
        chapter: {
          select: {
            id: true,
            chapter_no: true,
            title: true,
          },
        },
        version: {
          select: {
            id: true,
            version_no: true,
            stage: true,
          },
        },
      },
      orderBy: [{ state: "asc" }, { occurrence_count: "desc" }, { updated_at: "desc" }],
    })) as ResourceReferenceWithLinks[];

    const enriched = await this.enrichReferences(projectId, refs);
    const grouped = this.emptyGroupedReferences();
    for (const item of enriched) {
      grouped[RESOURCE_GROUP_KEYS[item.resource_type]].push(item);
    }

    return {
      chapter_id: chapterId,
      summary: {
        total: enriched.length,
        confirmed: enriched.filter((item) => item.state === "confirmed").length,
        inferred: enriched.filter((item) => item.state === "inferred").length,
        ignored: enriched.filter((item) => item.state === "ignored").length,
      },
      references: grouped,
    };
  }

  async getResourceReferences(projectId: string, resourceType: ResourceType, resourceId: string) {
    const refs = (await this.prisma.resourceReference.findMany({
      where: {
        project_id: projectId,
        resource_type: resourceType,
        resource_id: resourceId,
      },
      include: {
        chapter: {
          select: {
            id: true,
            chapter_no: true,
            title: true,
          },
        },
        version: {
          select: {
            id: true,
            version_no: true,
            stage: true,
          },
        },
      },
      orderBy: [{ updated_at: "desc" }],
    })) as ResourceReferenceWithLinks[];

    return {
      collection: RESOURCE_TYPE_TO_COLLECTION[resourceType],
      resource_type: resourceType,
      resource_id: resourceId,
      stats: await this.getResourceStats(projectId, resourceType, resourceId),
      references: await this.enrichReferences(projectId, refs),
    };
  }
}
