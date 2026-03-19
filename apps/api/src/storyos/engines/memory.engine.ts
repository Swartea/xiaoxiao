import { Inject, Injectable } from "@nestjs/common";
import { ExtractedStatus, Prisma } from "@prisma/client";
import { normalizedContentHash, sanitizeExtractedFacts } from "@novel-factory/memory";
import { PrismaService } from "../../prisma.service";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class MemoryEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  extractFacts(text: string) {
    const sentences = text
      .split(/[。！？\n]/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 12)
      .slice(0, 8);

    return sanitizeExtractedFacts(
      sentences.map((content, idx) => ({
        content,
        confidence: Math.max(60, 90 - idx * 4),
        source_span: { from: Math.max(0, idx * 30), to: Math.max(0, idx * 30 + content.length) },
      })),
    );
  }

  extractSeeds(text: string) {
    const keywords = ["似乎", "却", "未说完", "异常", "秘密", "伏笔"];
    const lines = text.split(/\n/).filter((line) => keywords.some((keyword) => line.includes(keyword)));
    return lines.slice(0, 6).map((line, idx) => ({
      content: line.trim(),
      planned_payoff_chapter_no: idx + 2,
    }));
  }

  updateTimeline(text: string, chapterNo: number) {
    const marks = ["清晨", "中午", "傍晚", "深夜", "次日"];
    const hit = marks.find((mark) => text.includes(mark)) ?? `第${chapterNo}章`;
    return [
      {
        time_mark: hit,
        event: `第${chapterNo}章关键事件推进`,
      },
    ];
  }

  snapshotCharacterState(input: Array<{ character_id: string; state: string }>) {
    return input.reduce<Record<string, string>>((acc, item) => {
      acc[item.character_id] = item.state;
      return acc;
    }, {});
  }

  mergeStoryMemory(input: {
    facts: Array<{ content: string }>;
    seeds: Array<{ content: string }>;
    timeline: Array<{ event: string }>;
  }) {
    return {
      must_remember: input.facts.map((item) => item.content),
      unresolved_seeds: input.seeds.map((item) => item.content),
      recent_timeline: input.timeline.map((item) => item.event),
    };
  }

  async persistExtractedMemory(args: {
    projectId: string;
    chapterId: string;
    chapterNo: number;
    versionId: string;
    text: string;
  }) {
    const facts = this.extractFacts(args.text);
    const seeds = this.extractSeeds(args.text);
    const timeline = this.updateTimeline(args.text, args.chapterNo);

    await this.prisma.chapterMemory.create({
      data: {
        chapter_id: args.chapterId,
        extracted_from_version_id: args.versionId,
        summary: args.text.slice(0, 220),
        scene_list: toJson([]),
        character_state_snapshot: toJson({}),
        needs_manual_review: false,
      },
    });

    if (facts.length > 0) {
      await this.prisma.fact.createMany({
        data: facts.map((fact) => ({
          project_id: args.projectId,
          chapter_no: args.chapterNo,
          content: fact.content,
          entities: toJson({}),
          time_in_story: null,
          confidence: fact.confidence,
          source_span: toJson(fact.source_span),
          known_by_character_ids: [],
          source_version_id: args.versionId,
          fingerprint: normalizedContentHash(fact.content),
          status: ExtractedStatus.extracted,
        })),
        skipDuplicates: true,
      });
    }

    if (seeds.length > 0) {
      await this.prisma.seed.createMany({
        data: seeds.map((seed) => ({
          project_id: args.projectId,
          planted_chapter_no: args.chapterNo,
          content: seed.content,
          planned_payoff_chapter_no: seed.planned_payoff_chapter_no,
          status: "planted",
          payoff_method: null,
          related_fact_ids: [],
          source_version_id: args.versionId,
          fingerprint: normalizedContentHash(seed.content),
          extraction_status: ExtractedStatus.extracted,
        })),
        skipDuplicates: true,
      });
    }

    if (timeline.length > 0) {
      await this.prisma.timelineEvent.createMany({
        data: timeline.map((event) => ({
          project_id: args.projectId,
          time_mark: event.time_mark,
          event: event.event,
          involved_entities: toJson({}),
          chapter_no_ref: args.chapterNo,
          source_version_id: args.versionId,
          fingerprint: normalizedContentHash(`${event.time_mark}|${event.event}`),
          status: ExtractedStatus.extracted,
        })),
        skipDuplicates: true,
      });
    }

    return { facts, seeds, timeline };
  }
}
