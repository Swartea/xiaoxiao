import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  ExtractedStatus,
  GenerationRequestStatus,
  Prisma,
  VersionStage,
  type Chapter,
  type ChapterVersion,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { createPatch } from "diff";
import {
  buildGenerationContext,
  fallbackExtractMemory,
  normalizedContentHash,
  parseExtractorJson,
  runContinuityCheck,
  sha256FromCanonicalJson,
  type RetrievedMemoryPackage,
} from "@novel-factory/memory";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider, type StageModelConfig } from "@novel-factory/llm";
import { fixRequestSchema, fixResponseSchema, type FixRequest, type VersionStage as SharedVersionStage } from "@novel-factory/shared";
import { PrismaService } from "../prisma.service";
import { CheckContinuityDto, GenerateStageDto } from "./dto";

type Stage = Exclude<SharedVersionStage, "fix"> | "fix";

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function scoreByMatch({
  text,
  queryEntities,
  recencyDelta,
  typeWeight,
  unresolvedSeedBonus = 0,
}: {
  text: string;
  queryEntities: string[];
  recencyDelta: number;
  typeWeight: number;
  unresolvedSeedBonus?: number;
}) {
  const entityMatch = queryEntities.reduce((acc, entity) => (text.includes(entity) ? acc + 10 : acc), 0);
  const recency = Math.max(0, 30 - recencyDelta);
  return entityMatch + recency + typeWeight + unresolvedSeedBonus;
}

function normalizeStage(stage: Stage): VersionStage {
  if (stage === "beats") return VersionStage.beats;
  if (stage === "draft") return VersionStage.draft;
  if (stage === "polish") return VersionStage.polish;
  return VersionStage.fix;
}

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function toRequiredJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return {} as Prisma.InputJsonObject;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class GenerationService {
  private provider: LlmProvider | null;
  private readonly modelConfig: StageModelConfig;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const providerName = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
    const openAiApiKey = process.env.OPENAI_API_KEY;
    const deepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    const xaiApiKey = process.env.XAI_API_KEY;

    if (providerName === "deepseek" && deepSeekApiKey) {
      this.provider = new DeepSeekProvider(deepSeekApiKey, process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com");
    } else if (providerName === "xai" && xaiApiKey) {
      this.provider = new XAiProvider(xaiApiKey, process.env.XAI_BASE_URL ?? "https://api.x.ai/v1");
    } else if (openAiApiKey) {
      this.provider = new OpenAiProvider(openAiApiKey, process.env.OPENAI_BASE_URL);
    } else {
      this.provider = null;
    }

    const usingDeepSeek = providerName === "deepseek";
    const usingXai = providerName === "xai";
    const defaultMiniModel = usingDeepSeek ? "deepseek-chat" : usingXai ? "grok-3-mini-beta" : "gpt-4.1-mini";
    const defaultStrongModel = usingDeepSeek ? "deepseek-chat" : usingXai ? "grok-3-beta" : "gpt-4.1";

    this.modelConfig = {
      beats: process.env.MODEL_BEATS ?? defaultMiniModel,
      draft: process.env.MODEL_DRAFT ?? defaultMiniModel,
      polish: process.env.MODEL_POLISH ?? defaultStrongModel,
      check: process.env.MODEL_CHECK ?? defaultMiniModel,
      extract: process.env.MODEL_EXTRACT ?? defaultMiniModel,
      fix: process.env.MODEL_FIX ?? defaultStrongModel,
    };
  }

  private requireIdempotencyKey(idempotencyKey?: string) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    return idempotencyKey.trim();
  }

  private requestHash(stage: Stage, payload: unknown) {
    return sha256FromCanonicalJson({ stage, payload });
  }

  private stageLabel(stage: Stage) {
    if (stage === "beats") return "Scene Beats";
    if (stage === "draft") return "Draft";
    if (stage === "polish") return "Polish";
    return "Fix";
  }

  private async resolveChapter(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }
    const project = await this.prisma.project.findUnique({ where: { id: chapter.project_id } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return { chapter, project };
  }

  private async loadOrCreateRequest(args: {
    chapterId: string;
    stage: VersionStage;
    idempotencyKey: string;
    requestHash: string;
  }) {
    const existing = await this.prisma.generationRequest.findUnique({
      where: {
        chapter_id_stage_idempotency_key: {
          chapter_id: args.chapterId,
          stage: args.stage,
          idempotency_key: args.idempotencyKey,
        },
      },
    });

    if (existing) {
      if (existing.request_hash !== args.requestHash) {
        throw new UnprocessableEntityException("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }

      if (existing.status === GenerationRequestStatus.in_progress) {
        throw new ConflictException("REQUEST_IN_PROGRESS");
      }

      if (existing.status === GenerationRequestStatus.failed) {
        throw new BadRequestException(existing.error_message ?? "Previous request failed");
      }

      if (existing.response_version_id) {
        const [version, report] = await Promise.all([
          this.prisma.chapterVersion.findUnique({ where: { id: existing.response_version_id } }),
          existing.response_report_id
            ? this.prisma.consistencyReport.findUnique({ where: { id: existing.response_report_id } })
            : Promise.resolve(null),
        ]);
        return { request: existing, replay: { version, report } };
      }

      return { request: existing, replay: null };
    }

    const request = await this.prisma.generationRequest.create({
      data: {
        chapter_id: args.chapterId,
        stage: args.stage,
        idempotency_key: args.idempotencyKey,
        request_hash: args.requestHash,
        status: GenerationRequestStatus.in_progress,
      },
    });

    return { request, replay: null };
  }

  private async markRequestFailed(requestId: string, message: string) {
    await this.prisma.generationRequest.update({
      where: { id: requestId },
      data: {
        status: GenerationRequestStatus.failed,
        error_message: message,
      },
    });
  }

  private async markRequestSucceeded(requestId: string, versionId: string, reportId: string) {
    await this.prisma.generationRequest.update({
      where: { id: requestId },
      data: {
        status: GenerationRequestStatus.succeeded,
        response_version_id: versionId,
        response_report_id: reportId,
      },
    });
  }

  private async retrieveMemory(chapter: Chapter, queryEntities: string[], k: number): Promise<RetrievedMemoryPackage> {
    const [entities, glossary, recentMemories, characters, facts, seeds, timeline] = await Promise.all([
      this.prisma.bibleEntity.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.glossaryTerm.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.chapterMemory.findMany({
        where: {
          chapter: {
            project_id: chapter.project_id,
            chapter_no: { lt: chapter.chapter_no },
          },
        },
        include: { chapter: true },
        orderBy: { created_at: "desc" },
        take: 20,
      }),
      this.prisma.character.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.fact.findMany({
        where: {
          project_id: chapter.project_id,
          status: { in: [ExtractedStatus.confirmed, ExtractedStatus.extracted] },
        },
        orderBy: [{ chapter_no: "desc" }],
        take: 120,
      }),
      this.prisma.seed.findMany({
        where: { project_id: chapter.project_id },
        orderBy: [{ planted_chapter_no: "desc" }],
        take: 120,
      }),
      this.prisma.timelineEvent.findMany({
        where: {
          project_id: chapter.project_id,
          status: { in: [ExtractedStatus.confirmed, ExtractedStatus.extracted] },
        },
        orderBy: [{ chapter_no_ref: "desc" }],
        take: 120,
      }),
    ]);

    const entitiesFromChapter = [chapter.goal, chapter.conflict, chapter.twist, chapter.title]
      .filter(Boolean)
      .join(" ");

    const resolvedEntities = [
      ...new Set(
        [...queryEntities, ...characters.filter((c) => entitiesFromChapter.includes(c.name)).map((c) => c.name)].filter(
          Boolean,
        ),
      ),
    ];

    const involvedCharacters =
      resolvedEntities.length > 0
        ? characters.filter((c) => resolvedEntities.some((name) => c.name.includes(name) || name.includes(c.name)))
        : characters.slice(0, 8);

    const relationships = await this.prisma.relationship.findMany({
      where: {
        project_id: chapter.project_id,
        OR: [
          { from_character_id: { in: involvedCharacters.map((c) => c.id) } },
          { to_character_id: { in: involvedCharacters.map((c) => c.id) } },
        ],
      },
      include: { fromCharacter: true, toCharacter: true },
      take: 50,
    });

    const latestMemory = recentMemories[0];
    const stateSnapshot = (latestMemory?.character_state_snapshot ?? {}) as Record<string, unknown>;

    const bibleRules = entities
      .filter((entity) => entity.type === "rule" || entity.type === "ability")
      .map((entity) => ({
        id: entity.id,
        data: { text: `${entity.name}: ${entity.constraints ?? entity.description ?? ""}` },
        rank: 0,
        score: scoreByMatch({
          text: `${entity.name} ${entity.description ?? ""}`,
          queryEntities: resolvedEntities,
          recencyDelta: 0,
          typeWeight: 8,
        }),
        source_table: "bible_entities",
        source_id: entity.id,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const glossaryItems = glossary
      .map((term) => ({
        id: term.id,
        data: { term: term.term, canonical_form: term.canonical_form, notes: term.notes },
        rank: 0,
        score: scoreByMatch({
          text: `${term.term} ${term.canonical_form}`,
          queryEntities: resolvedEntities,
          recencyDelta: 0,
          typeWeight: 6,
        }),
        source_table: "glossary_terms",
        source_id: term.id,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const recentSummaryItems = recentMemories
      .filter((memory) => !!memory.summary)
      .map((memory) => ({
        id: memory.id,
        data: { chapter_no: memory.chapter.chapter_no, summary: memory.summary ?? "" },
        rank: 0,
        score: scoreByMatch({
          text: memory.summary ?? "",
          queryEntities: resolvedEntities,
          recencyDelta: chapter.chapter_no - memory.chapter.chapter_no,
          typeWeight: 7,
        }),
        source_table: "chapter_memory",
        source_id: memory.id,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const characterSnapshots = involvedCharacters
      .map((character) => ({
        id: character.id,
        data: {
          id: character.id,
          name: character.name,
          state_snapshot: stateSnapshot[character.id] ?? {},
          key_traits: [character.personality, character.motivation].filter(Boolean) as string[],
        },
        rank: 0,
        score: scoreByMatch({
          text: `${character.name} ${character.personality ?? ""} ${character.motivation ?? ""}`,
          queryEntities: resolvedEntities,
          recencyDelta: 0,
          typeWeight: 10,
        }),
        source_table: "chapter_memory",
        source_id: latestMemory?.id ?? character.id,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const relationshipSlice = relationships
      .map((rel) => ({
        id: rel.id,
        data: {
          from: rel.fromCharacter.name,
          to: rel.toCharacter.name,
          type: rel.relation_type,
          intensity: rel.intensity,
          notes: rel.notes,
        },
        rank: 0,
        score: scoreByMatch({
          text: `${rel.fromCharacter.name} ${rel.toCharacter.name} ${rel.notes ?? ""}`,
          queryEntities: resolvedEntities,
          recencyDelta: rel.last_updated_chapter_no ? chapter.chapter_no - rel.last_updated_chapter_no : 0,
          typeWeight: 7,
        }),
        source_table: "relationships",
        source_id: rel.id,
        entity_id: `${rel.from_character_id}:${rel.to_character_id}`,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const factsItems = facts
      .map((fact) => ({
        id: fact.id,
        data: {
          fact_id: fact.id,
          content: fact.content,
          chapter_no: fact.chapter_no,
          known_by_character_ids: fact.known_by_character_ids,
        },
        rank: 0,
        score: scoreByMatch({
          text: fact.content,
          queryEntities: resolvedEntities,
          recencyDelta: chapter.chapter_no - fact.chapter_no,
          typeWeight: 9,
        }),
        source_table: "facts",
        source_id: fact.id,
        source_span: fact.source_span,
        entity_id: Array.isArray((fact.entities as Record<string, unknown> | null)?.character_ids)
          ? ((fact.entities as Record<string, unknown>).character_ids as string[]).join(",")
          : undefined,
        normalized_content_hash: normalizedContentHash(fact.content),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const seedItems = seeds
      .map((seed) => ({
        id: seed.id,
        data: {
          seed_id: seed.id,
          content: seed.content,
          status: seed.status,
          planted_chapter_no: seed.planted_chapter_no,
        },
        rank: 0,
        score: scoreByMatch({
          text: seed.content,
          queryEntities: resolvedEntities,
          recencyDelta: chapter.chapter_no - seed.planted_chapter_no,
          typeWeight: 8,
          unresolvedSeedBonus: seed.status !== "paid_off" ? 6 : 0,
        }),
        source_table: "seeds",
        source_id: seed.id,
        entity_id: seed.related_fact_ids.join(","),
        normalized_content_hash: normalizedContentHash(seed.content),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const timelineItems = timeline
      .map((event) => ({
        id: event.id,
        data: {
          event_id: event.id,
          time_mark: event.time_mark,
          event: event.event,
          chapter_no_ref: event.chapter_no_ref,
        },
        rank: 0,
        score: scoreByMatch({
          text: `${event.time_mark} ${event.event}`,
          queryEntities: resolvedEntities,
          recencyDelta: chapter.chapter_no - event.chapter_no_ref,
          typeWeight: 7,
        }),
        source_table: "timeline_events",
        source_id: event.id,
        entity_id: event.chapter_no_ref.toString(),
        normalized_content_hash: normalizedContentHash(`${event.time_mark}|${event.event}`),
      }))
      .sort((a, b) => b.score - a.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    return {
      bibleRules,
      glossary: glossaryItems,
      recentSummaries: recentSummaryItems,
      characterSnapshots,
      relationshipSlice,
      facts: factsItems,
      seeds: seedItems,
      timeline: timelineItems,
      retrieverMeta: {
        k,
        query_entities: resolvedEntities,
        filters: {
          project_id: chapter.project_id,
          chapter_no: chapter.chapter_no,
        },
        ordering: ["entity_match", "recency", "type_weight", "unresolved_seed_bonus"],
        ids_selected: [
          ...factsItems.slice(0, k).map((f) => f.id),
          ...seedItems.slice(0, k).map((s) => s.id),
          ...timelineItems.slice(0, k).map((t) => t.id),
        ],
      },
    };
  }

  private buildGenerationPrompt(stage: Stage, chapter: Chapter, context: unknown, instruction?: string) {
    const stageIntent: Record<Stage, string> = {
      beats: "输出场景骨架，每个场景都要明确冲突与转折",
      draft: "扩写为章节初稿，保持人物信息边界与术语一致",
      polish: "润色语言节奏并去除机械表达，不改动关键事实",
      fix: "按修复目标重写指定范围文本，保证上下文衔接",
    };

    return {
      system: [
        "你是中文小说创作引擎。",
        "必须遵守 GenerationContext 中的约束、术语、时间线和人物状态。",
        "不得凭空引入未在 context 中出现的关键设定。",
      ].join("\n"),
      user: [
        `任务阶段: ${stage}`,
        `阶段目标: ${stageIntent[stage]}`,
        `章节信息: no=${chapter.chapter_no}, title=${chapter.title ?? "未命名"}`,
        instruction ? `额外指令: ${instruction}` : "",
        "GenerationContext(JSON):",
        JSON.stringify(context, null, 2),
        "请只输出最终文本，不要输出解释。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  private async generateText(stage: Stage, chapter: Chapter, context: unknown, instruction?: string) {
    const prompt = this.buildGenerationPrompt(stage, chapter, context, instruction);

    if (!this.provider) {
      return [
        `[${this.stageLabel(stage)} Mock Output]`,
        `Chapter ${chapter.chapter_no}${chapter.title ? `: ${chapter.title}` : ""}`,
        instruction ? `Instruction: ${instruction}` : "",
        "",
        "在没有配置 OPENAI_API_KEY 的情况下，返回可运行的占位文本。",
        "请配置 API Key 后得到真实模型输出。",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const model =
      stage === "beats"
        ? this.modelConfig.beats
        : stage === "draft"
          ? this.modelConfig.draft
          : stage === "polish"
            ? this.modelConfig.polish
            : this.modelConfig.fix;

    const result = await this.provider.generateText({
      system: prompt.system,
      user: prompt.user,
      model,
      temperature: stage === "polish" ? 0.8 : 0.6,
      maxTokens: 3000,
    });

    return result.text;
  }

  private async extractMemoryText(text: string): Promise<ReturnType<typeof fallbackExtractMemory>> {
    if (!this.provider) {
      return fallbackExtractMemory(text);
    }

    try {
      const response = await this.provider.generateText({
        model: this.modelConfig.extract,
        system: "你是小说记忆抽取器，请输出严格 JSON。",
        user: [
          "从正文中抽取 summary, scene_list, facts_added, seeds_added, timeline_events_added, character_state_snapshot。",
          "scene_list 需要 scene_index 和 anchor_span(from/to)。",
          "输出 JSON，不要 Markdown。",
          text,
        ].join("\n\n"),
        temperature: 0,
        maxTokens: 2000,
      });

      return parseExtractorJson(response.text);
    } catch (error) {
      return fallbackExtractMemory(text);
    }
  }

  private async createVersion(args: {
    chapterId: string;
    stage: Stage;
    text: string;
    parentVersionId?: string | null;
    meta?: Record<string, unknown>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM chapters WHERE id = ${args.chapterId}::uuid FOR UPDATE`);
      const maxVersionRow = await tx.$queryRaw<Array<{ max_version: number | null }>>(
        Prisma.sql`SELECT MAX(version_no)::int AS max_version FROM chapter_versions WHERE chapter_id = ${args.chapterId}::uuid`,
      );
      const nextVersionNo = (maxVersionRow[0]?.max_version ?? 0) + 1;

      const created = await tx.chapterVersion.create({
        data: {
          chapter_id: args.chapterId,
          version_no: nextVersionNo,
          stage: normalizeStage(args.stage),
          text: args.text,
          text_hash: textHash(args.text),
          parent_version_id: args.parentVersionId ?? null,
          meta: args.meta ? (args.meta as Prisma.InputJsonObject) : Prisma.JsonNull,
        },
      });

      return created;
    });
  }

  private highestSeverity(report: ReturnType<typeof runContinuityCheck>) {
    if (report.summary.high > 0) return "high" as const;
    if (report.summary.med > 0) return "med" as const;
    return "low" as const;
  }

  private async saveExtractedMemory(args: {
    chapter: Chapter;
    version: ChapterVersion;
    extracted: ReturnType<typeof fallbackExtractMemory>;
  }) {
    const { chapter, version, extracted } = args;

    await this.prisma.chapterMemory.create({
      data: {
        chapter_id: chapter.id,
        extracted_from_version_id: version.id,
        summary: extracted.summary,
        scene_list: toJson(extracted.scene_list),
        character_state_snapshot: toJson(extracted.character_state_snapshot),
        needs_manual_review: extracted.needs_manual_review,
        review_notes: extracted.review_notes,
      },
    });

    if (extracted.facts_added.length > 0) {
      await this.prisma.fact.createMany({
        data: extracted.facts_added.map((fact) => ({
          project_id: chapter.project_id,
          chapter_no: chapter.chapter_no,
          content: fact.content,
          entities: {} as Prisma.InputJsonObject,
          time_in_story: null,
          confidence: fact.confidence,
          source_span: fact.source_span as Prisma.InputJsonObject,
          known_by_character_ids: [],
          source_version_id: version.id,
          fingerprint: normalizedContentHash(fact.content),
          status: extracted.needs_manual_review ? ExtractedStatus.extracted : ExtractedStatus.confirmed,
        })),
        skipDuplicates: true,
      });
    }

    if (extracted.seeds_added.length > 0) {
      await this.prisma.seed.createMany({
        data: extracted.seeds_added.map((seed) => ({
          project_id: chapter.project_id,
          planted_chapter_no: chapter.chapter_no,
          content: seed.content,
          planned_payoff_chapter_no: seed.planned_payoff_chapter_no ?? null,
          status: "planted",
          payoff_method: null,
          related_fact_ids: [],
          source_version_id: version.id,
          fingerprint: normalizedContentHash(seed.content),
          extraction_status: extracted.needs_manual_review ? ExtractedStatus.extracted : ExtractedStatus.confirmed,
        })),
        skipDuplicates: true,
      });
    }

    if (extracted.timeline_events_added.length > 0) {
      await this.prisma.timelineEvent.createMany({
        data: extracted.timeline_events_added.map((event) => ({
          project_id: chapter.project_id,
          time_mark: event.time_mark,
          event: event.event,
          involved_entities: {} as Prisma.InputJsonObject,
          chapter_no_ref: chapter.chapter_no,
          source_version_id: version.id,
          fingerprint: normalizedContentHash(`${event.time_mark}|${event.event}`),
          status: extracted.needs_manual_review ? ExtractedStatus.extracted : ExtractedStatus.confirmed,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async runAndPersistContinuity(args: {
    chapter: Chapter;
    version: ChapterVersion;
  }) {
    const [glossary, characters, facts] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where: { project_id: args.chapter.project_id } }),
      this.prisma.character.findMany({ where: { project_id: args.chapter.project_id } }),
      this.prisma.fact.findMany({ where: { project_id: args.chapter.project_id } }),
    ]);

    const report = runContinuityCheck({
      versionId: args.version.id,
      textHash: args.version.text_hash,
      chapterNo: args.chapter.chapter_no,
      text: args.version.text,
      glossary: glossary.map((g) => ({ term: g.term, canonical_form: g.canonical_form })),
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        age: c.age,
        abilities: (c.abilities as Record<string, unknown> | null) ?? null,
      })),
      facts: facts.map((f) => ({
        id: f.id,
        content: f.content,
        chapter_no: f.chapter_no,
        known_by_character_ids: f.known_by_character_ids,
      })),
    });

    const saved = await this.prisma.consistencyReport.create({
      data: {
        chapter_id: args.chapter.id,
        version_id: args.version.id,
        report: report as Prisma.InputJsonObject,
        severity: this.highestSeverity(report),
      },
    });

    return { report, saved };
  }

  async generate(chapterId: string, stage: Exclude<Stage, "fix">, dto: GenerateStageDto, idempotencyKey?: string) {
    const idemKey = this.requireIdempotencyKey(idempotencyKey);
    const stageEnum = normalizeStage(stage);
    const reqHash = this.requestHash(stage, dto);

    const requestState = await this.loadOrCreateRequest({
      chapterId,
      stage: stageEnum,
      idempotencyKey: idemKey,
      requestHash: reqHash,
    });

    if (requestState.replay?.version) {
      return {
        replay: true,
        version: requestState.replay.version,
        continuity_report: requestState.replay.report?.report ?? null,
      };
    }

    try {
      const { chapter } = await this.resolveChapter(chapterId);
      const k = dto.k ?? 50;
      const retrieved = await this.retrieveMemory(chapter, dto.query_entities ?? [], k);
      const assembled = buildGenerationContext({ k, retrieved });

      const snapshot = await this.prisma.generationContextSnapshot.create({
        data: {
          chapter_id: chapter.id,
          stage: stageEnum,
          context: toRequiredJson(assembled.context),
          trace_map: toRequiredJson(assembled.traceMap),
          retriever_meta: toRequiredJson(assembled.retrieverMeta),
          context_hash: assembled.contextHash,
          build_version: process.env.APP_BUILD_VERSION ?? "dev",
        },
      });

      const latestVersion = await this.prisma.chapterVersion.findFirst({
        where: { chapter_id: chapter.id },
        orderBy: { version_no: "desc" },
      });

      const generatedText = await this.generateText(stage, chapter, assembled.context, dto.instruction);

      const version = await this.createVersion({
        chapterId: chapter.id,
        stage,
        text: generatedText,
        parentVersionId: latestVersion?.id,
        meta: {
          provider: this.provider?.name ?? "mock",
          model:
            stage === "beats"
              ? this.modelConfig.beats
              : stage === "draft"
                ? this.modelConfig.draft
                : this.modelConfig.polish,
          idempotency_key: idemKey,
          context_hash: assembled.contextHash,
        },
      });

      const extracted = await this.extractMemoryText(generatedText);
      await this.saveExtractedMemory({ chapter, version, extracted });
      const continuity = await this.runAndPersistContinuity({ chapter, version });
      await this.markRequestSucceeded(requestState.request.id, version.id, continuity.saved.id);

      return {
        replay: false,
        stage,
        version,
        generation_context: assembled.context,
        context_hash: assembled.contextHash,
        retriever_meta: assembled.retrieverMeta,
        snapshot_id: snapshot.id,
        extracted_memory: extracted,
        continuity_report: continuity.report,
      };
    } catch (error) {
      await this.markRequestFailed(
        requestState.request.id,
        error instanceof Error ? error.message : "Unknown generation error",
      );
      throw error;
    }
  }

  async checkContinuity(chapterId: string, dto: CheckContinuityDto) {
    const { chapter } = await this.resolveChapter(chapterId);

    const version = dto.version_id
      ? await this.prisma.chapterVersion.findFirst({ where: { id: dto.version_id, chapter_id: chapterId } })
      : await this.prisma.chapterVersion.findFirst({
          where: { chapter_id: chapterId },
          orderBy: { version_no: "desc" },
        });

    if (!version) {
      throw new NotFoundException("No version available for continuity check");
    }

    const continuity = await this.runAndPersistContinuity({ chapter, version });
    return {
      version_id: version.id,
      report_id: continuity.saved.id,
      continuity_report: continuity.report,
    };
  }

  private resolveTargetSpan(baseVersion: ChapterVersion, mode: FixRequest["mode"], fixRequest: FixRequest, sceneList: unknown) {
    if (mode === "replace_span") {
      return fixRequest.span!;
    }

    if (mode === "rewrite_chapter") {
      return { from: 0, to: baseVersion.text.length };
    }

    const scenes = Array.isArray(sceneList) ? sceneList : [];
    const target = scenes.find(
      (scene) =>
        typeof scene === "object" &&
        scene !== null &&
        (scene as { scene_index?: number }).scene_index === fixRequest.section?.scene_index,
    ) as { anchor_span?: { from?: number; to?: number } } | undefined;

    if (!target?.anchor_span || typeof target.anchor_span.from !== "number" || typeof target.anchor_span.to !== "number") {
      throw new UnprocessableEntityException("SECTION_ANCHOR_MISSING");
    }

    return { from: target.anchor_span.from, to: target.anchor_span.to };
  }

  async fix(chapterId: string, payload: unknown, idempotencyKey?: string) {
    const idemKey = this.requireIdempotencyKey(idempotencyKey);
    const request = fixRequestSchema.parse(payload);
    const reqHash = this.requestHash("fix", request);

    const requestState = await this.loadOrCreateRequest({
      chapterId,
      stage: VersionStage.fix,
      idempotencyKey: idemKey,
      requestHash: reqHash,
    });

    if (requestState.replay?.version && requestState.replay?.report) {
      const report = requestState.replay.report.report;
      const replayMeta = (requestState.replay.version.meta ?? {}) as Record<string, unknown>;
      const replayPatch = (replayMeta.patch ?? {
        type: "offset_replace",
        from: 0,
        to: 0,
        replacement: "",
        unified_diff: "",
      }) as {
        type: "offset_replace";
        from: number;
        to: number;
        replacement: string;
        unified_diff: string;
      };
      return {
        replay: true,
        new_version_id: requestState.replay.version.id,
        new_version_no: requestState.replay.version.version_no,
        base_version_id: request.base_version_id,
        mode: request.mode,
        target_span: { from: replayPatch.from, to: replayPatch.to },
        patch: replayPatch,
        continuity_report: report,
      };
    }

    try {
      const { chapter } = await this.resolveChapter(chapterId);

      const baseVersion = await this.prisma.chapterVersion.findFirst({
        where: { id: request.base_version_id, chapter_id: chapterId },
      });
      if (!baseVersion) {
        throw new NotFoundException("Base version not found");
      }

      const latestMemory = await this.prisma.chapterMemory.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      });

      const targetSpan = this.resolveTargetSpan(baseVersion, request.mode, request, latestMemory?.scene_list);
      const before = baseVersion.text.slice(0, targetSpan.from);
      const target = baseVersion.text.slice(targetSpan.from, targetSpan.to);
      const after = baseVersion.text.slice(targetSpan.to);

      const k = 50;
      const retrieved = await this.retrieveMemory(chapter, [], k);
      const assembled = buildGenerationContext({ k, retrieved });

      await this.prisma.generationContextSnapshot.create({
        data: {
          chapter_id: chapter.id,
          stage: VersionStage.fix,
          context: toRequiredJson(assembled.context),
          trace_map: toRequiredJson(assembled.traceMap),
          retriever_meta: toRequiredJson(assembled.retrieverMeta),
          context_hash: assembled.contextHash,
          build_version: process.env.APP_BUILD_VERSION ?? "dev",
        },
      });

      const replacement = await this.generateText(
        "fix",
        chapter,
        assembled.context,
        [
          `修复模式: ${request.mode}`,
          request.strategy_id ? `strategy_id: ${request.strategy_id}` : "",
          request.issue_ids?.length ? `issue_ids: ${request.issue_ids.join(",")}` : "",
          request.instruction ? `instruction: ${request.instruction}` : "",
          "待修复片段:",
          target,
        ]
          .filter(Boolean)
          .join("\n"),
      );

      const newText = `${before}${replacement}${after}`;
      const patch = {
        type: "offset_replace" as const,
        from: targetSpan.from,
        to: targetSpan.to,
        replacement,
        unified_diff: createPatch("chapter", baseVersion.text, newText),
      };

      const version = await this.createVersion({
        chapterId,
        stage: "fix",
        text: newText,
        parentVersionId: baseVersion.id,
        meta: {
          mode: request.mode,
          base_version_id: baseVersion.id,
          idempotency_key: idemKey,
          strategy_id: request.strategy_id,
          issue_ids: request.issue_ids,
          patch,
        },
      });

      const extracted = await this.extractMemoryText(newText);
      await this.saveExtractedMemory({ chapter, version, extracted });
      const continuity = await this.runAndPersistContinuity({ chapter, version });
      await this.markRequestSucceeded(requestState.request.id, version.id, continuity.saved.id);

      return fixResponseSchema.parse({
        new_version_id: version.id,
        new_version_no: version.version_no,
        base_version_id: baseVersion.id,
        mode: request.mode,
        target_span: targetSpan,
        patch,
        continuity_report: continuity.report,
      });
    } catch (error) {
      await this.markRequestFailed(requestState.request.id, error instanceof Error ? error.message : "fix failed");
      throw error;
    }
  }

  async updateFactStatus(chapterId: string, factId: string, status: ExtractedStatus) {
    await this.resolveChapter(chapterId);
    return this.prisma.fact.update({ where: { id: factId }, data: { status } });
  }

  async updateSeedStatus(chapterId: string, seedId: string, status: ExtractedStatus) {
    await this.resolveChapter(chapterId);
    return this.prisma.seed.update({ where: { id: seedId }, data: { extraction_status: status } });
  }

  async updateTimelineStatus(chapterId: string, eventId: string, status: ExtractedStatus) {
    await this.resolveChapter(chapterId);
    return this.prisma.timelineEvent.update({ where: { id: eventId }, data: { status } });
  }
}
