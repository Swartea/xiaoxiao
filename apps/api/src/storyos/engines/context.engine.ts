import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sha256FromCanonicalJson } from "@novel-factory/memory";
import { contextBriefSchema, type ContextBrief } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";
import { StoryReferenceService } from "../../story-resources/story-reference.service";
import { StoryResourcesService } from "../../story-resources/story-resources.service";

const DEFAULT_TAGS = ["character_core", "recent_plot", "direct_conflict", "must_payoff_seed"] as const;

@Injectable()
export class ContextEngine {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StoryResourcesService) private readonly storyResourcesService: StoryResourcesService,
    @Inject(StoryReferenceService) private readonly storyReferenceService: StoryReferenceService,
  ) {}

  rankContextItems(items: Array<{ label: string; score: number }>) {
    return items.slice().sort((a, b) => b.score - a.score);
  }

  compressContext(items: string[], maxItems = 24) {
    return items
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, maxItems);
  }

  filterByStage(stage: string, tags?: string[]) {
    if (tags && tags.length > 0) {
      return tags;
    }
    if (stage === "beats" || stage === "draft" || stage === "polish") {
      return [...DEFAULT_TAGS];
    }
    return ["recent_plot", "direct_conflict"];
  }

  async buildContextBrief(args: {
    chapterId: string;
    stage: string;
    retrieverStrategy?: string;
    tags?: string[];
  }) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: args.chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const [latestIntent, latestMemory, activeSeeds, resourceBundle, chapterReferences] = await Promise.all([
      this.prisma.chapterIntent.findFirst({
        where: { chapter_id: chapter.id },
        orderBy: { version_no: "desc" },
      }),
      this.prisma.chapterMemory.findFirst({
        where: { chapter_id: chapter.id },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.seed.findMany({
        where: {
          project_id: chapter.project_id,
          status: { in: ["planted", "in_progress"] },
        },
        orderBy: { planted_chapter_no: "desc" },
        take: 8,
      }),
      this.storyResourcesService.getProjectResourceBundle(chapter.project_id),
      this.storyReferenceService.getChapterReferences(chapter.project_id, chapter.id),
    ]);
    const activeRules = resourceBundle.worldRules.slice(0, 8);
    const relationships = resourceBundle.relationships
      .slice()
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 8);
    const referencedResources = [
      ...chapterReferences.references.characters
        .filter((item: any) => item.state !== "ignored")
        .map((item: any) => `角色: ${item.resource?.name ?? "未命名角色"}`),
      ...chapterReferences.references.glossary
        .filter((item: any) => item.state !== "ignored")
        .map((item: any) => `术语: ${item.resource?.term ?? item.resource?.canonical_form ?? "未命名术语"}`),
      ...chapterReferences.references.timeline
        .filter((item: any) => item.state !== "ignored")
        .map((item: any) => `时间线: ${item.resource?.event ?? item.resource?.time_mark ?? "未命名事件"}`),
    ].slice(0, 8);
    const ruleConstraints = [
      ...activeRules.map((item) => `${item.name}: ${item.constraints ?? item.description ?? ""}`),
      ...resourceBundle.sensitiveWords.slice(0, 6).map((item) =>
        item.replacement ? `敏感词 ${item.term} -> ${item.replacement}` : `避免使用敏感词 ${item.term}`,
      ),
      ...resourceBundle.regexRules.slice(0, 6).map((item) => `规则 ${item.name}: /${item.pattern}/${item.flags ?? ""}`),
    ];

    const mission = latestIntent?.chapter_mission ?? chapter.goal ?? `第${chapter.chapter_no}章推进主线`;

    const brief: ContextBrief = {
      chapter_mission: mission,
      must_remember: this.compressContext([
        latestMemory?.summary ?? "",
        chapter.goal ?? "",
        chapter.conflict ?? "",
        chapter.twist ?? "",
        ...referencedResources,
      ]),
      must_not_violate: this.compressContext(ruleConstraints),
      active_relationships: this.compressContext(
        relationships.map((rel) => `${rel.fromCharacter.name}-${rel.toCharacter.name}(${rel.relation_type})`),
      ),
      payoff_targets: this.compressContext(activeSeeds.map((seed) => seed.content)),
      danger_points: this.compressContext([
        chapter.conflict ?? "",
        chapter.cliffhanger ?? "",
        ...activeSeeds.slice(0, 3).map((seed) => `伏笔未兑现: ${seed.content}`),
      ]),
    };

    const parsed = contextBriefSchema.parse(brief);
    const tags = this.filterByStage(args.stage, args.tags);
    const contextHash = sha256FromCanonicalJson(parsed);

    const snapshot = await this.prisma.contextSnapshot.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        stage: args.stage,
        retriever_strategy: args.retrieverStrategy ?? "hybrid-sql-v1",
        tags,
        context_brief: parsed,
        context_hash: contextHash,
      },
    });

    return {
      context_brief: parsed,
      context_hash: contextHash,
      snapshot_id: snapshot.id,
      tags,
    };
  }
}
