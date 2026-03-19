import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { GenerationRequestStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider } from "@novel-factory/llm";
import { sha256FromCanonicalJson } from "@novel-factory/memory";
import { PrismaService } from "../prisma.service";
import { BibleService } from "../bible/bible.service";
import { DEFAULT_CHAPTER_WORD_TARGET } from "../chapters/chapter-length";
import { ChaptersService } from "../chapters/chapters.service";
import { GenerationService } from "../generation/generation.service";
import { OutlineService } from "../outline/outline.service";
import { BootstrapProjectDto } from "./dto";

export type BootstrapGenreTemplate =
  | "historical-romance"
  | "palace-politics"
  | "household-drama"
  | "modern-romance"
  | "xianxia-fantasy"
  | "suspense"
  | "general-webnovel";

export function normalizeBootstrapGenre(genre: string): BootstrapGenreTemplate {
  const normalized = genre.trim().toLowerCase();
  if (!normalized) {
    return "general-webnovel";
  }
  if (
    ["古言", "古偶", "古风", "历史言情", "historical-romance", "historical romance"].some((item) =>
      normalized.includes(item),
    )
  ) {
    return "historical-romance";
  }
  if (["宫斗", "宫廷", "后宫", "palace-politics", "palace politics"].some((item) => normalized.includes(item))) {
    return "palace-politics";
  }
  if (["宅斗", "家族", "门第", "household-drama", "household drama"].some((item) => normalized.includes(item))) {
    return "household-drama";
  }
  if (
    ["现言", "都市", "都市言情", "现代言情", "modern-romance", "modern romance"].some((item) => normalized.includes(item))
  ) {
    return "modern-romance";
  }
  if (["仙侠", "玄幻", "修真", "xianxia-fantasy", "xianxia fantasy"].some((item) => normalized.includes(item))) {
    return "xianxia-fantasy";
  }
  if (["悬疑", "推理", "惊悚", "suspense", "mystery"].some((item) => normalized.includes(item))) {
    return "suspense";
  }
  return "general-webnovel";
}

function dedupeStrings(items: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      items
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
}

function formatToneTags(tags?: string[]) {
  const normalized = dedupeStrings(tags ?? []);
  return normalized.length > 0 ? normalized.join(" / ") : "未指定";
}

function buildGenreGuide(template: BootstrapGenreTemplate) {
  switch (template) {
    case "historical-romance":
      return "题材关注点：身份秩序、礼制场景、情感压抑与关系禁忌并进。";
    case "palace-politics":
      return "题材关注点：权力位阶、宫规禁忌、竞争关系、局势试探。";
    case "household-drama":
      return "题材关注点：家族利益、婚配压力、门第秩序、日常场景里的暗战。";
    case "modern-romance":
      return "题材关注点：现实处境、职业或生活压力、情感推进与个人成长互相咬合。";
    case "xianxia-fantasy":
      return "题材关注点：修行规则、门派立场、代价体系、情感与大道冲突。";
    case "suspense":
      return "题材关注点：信息差、误导线索、危机升级、人物动机遮蔽。";
    default:
      return "题材关注点：强冲突、清晰动机、稳定推进、持续钩子。";
  }
}

export function buildBootstrapPromptContext(dto: BootstrapProjectDto) {
  const normalizedGenre = dto.genre.trim();
  const template = normalizeBootstrapGenre(normalizedGenre);
  const toneTagText = formatToneTags(dto.tone_tags);

  return {
    genre: normalizedGenre,
    template,
    toneTagText,
    lines: [
      `genre: ${normalizedGenre}`,
      `genre_template: ${template}`,
      `logline: ${dto.logline}`,
      `central_conflict: ${dto.central_conflict}`,
      `protagonist_brief: ${dto.protagonist_brief}`,
      `relationship_hook: ${dto.relationship_hook}`,
      `status_tension: ${dto.status_tension}`,
      `opening_scene: ${dto.opening_scene}`,
      `tone_tags: ${toneTagText}`,
      buildGenreGuide(template),
    ],
  };
}

type BootstrapBeatsInitResult =
  | { state: "completed"; versionId?: string }
  | { state: "timed_out" }
  | { state: "failed"; errorMessage: string };

const bootstrapBibleSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string(),
        aliases: z.array(z.string()).default([]),
        age: z.number().int().optional().nullable(),
        appearance: z.string().optional().nullable(),
        personality: z.string().optional().nullable(),
        visual_anchors: z.string().optional().nullable(),
        personality_tags: z.string().optional().nullable(),
        current_status: z.string().optional().nullable(),
        motivation: z.string().optional().nullable(),
        secrets: z.string().optional().nullable(),
        catchphrases: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(6),
  glossary: z
    .array(
      z.object({
        term: z.string(),
        canonical_form: z.string(),
        notes: z.string().optional().nullable(),
      }),
    )
    .max(12)
    .default([]),
  entities: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
        constraints: z.string().optional().nullable(),
        cost: z.string().optional().nullable(),
        first_appearance_chapter_no: z.number().int().optional().nullable(),
      }),
    )
    .max(10)
    .default([]),
});

const outlineSchema = z.object({
  nodes: z
    .array(
      z.object({
        phase_no: z.number().int().min(1),
        title: z.string(),
        summary: z.string(),
        goal: z.string().optional().nullable(),
        conflict: z.string().optional().nullable(),
        milestone_chapter_no: z.number().int().optional().nullable(),
      }),
    )
    .min(3)
    .max(5),
});

function normalizeJson<T extends Record<string, unknown>>(value: T): Prisma.InputJsonObject {
  return value as unknown as Prisma.InputJsonObject;
}

@Injectable()
export class BootstrapService {
  private provider: LlmProvider | null;
  private readonly model: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BibleService) private readonly bibleService: BibleService,
    @Inject(OutlineService) private readonly outlineService: OutlineService,
    @Inject(ChaptersService) private readonly chaptersService: ChaptersService,
    @Inject(GenerationService) private readonly generationService: GenerationService,
  ) {
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
    this.model =
      process.env.MODEL_BOOTSTRAP ?? (usingDeepSeek ? "deepseek-chat" : usingXai ? "grok-3-mini-beta" : "gpt-4.1-mini");
  }

  private requireIdempotencyKey(idempotencyKey?: string, sourceLabel = "Idempotency-Key header") {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException(`${sourceLabel} is required`);
    }
    return idempotencyKey.trim();
  }

  private requestHash(payload: unknown) {
    return sha256FromCanonicalJson({ scope: "project_bootstrap", payload });
  }

  private async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private fallbackCharacterName(brief: string) {
    const first = brief.split(/[，,。\n]/)[0]?.trim();
    return first && first.length <= 20 ? first : "主角";
  }

  private fallbackBibleDraft(dto: BootstrapProjectDto) {
    const mainName = this.fallbackCharacterName(dto.protagonist_brief);
    const promptContext = buildBootstrapPromptContext(dto);
    return {
      characters: [
        {
          name: mainName,
          aliases: [],
          age: null,
          appearance: dto.protagonist_brief,
          personality: `题材：${promptContext.genre}；处境：${dto.status_tension}`,
          visual_anchors: dto.protagonist_brief,
          personality_tags: dedupeStrings([dto.status_tension, ...dedupeStrings(dto.tone_tags ?? [])]).join("、") || "目标未明、局势压迫",
          current_status: dto.opening_scene,
          motivation: dto.central_conflict,
          secrets: dto.relationship_hook,
          catchphrases: [],
        },
      ],
      glossary: [
        { term: "故事题材", canonical_form: promptContext.genre, notes: `模板：${promptContext.template}` },
        { term: "主线冲突", canonical_form: dto.central_conflict, notes: "来自开局向导" },
        { term: "开局场景", canonical_form: dto.opening_scene, notes: "来自开局向导" },
      ],
      entities: [
        {
          type: "rule",
          name: `${promptContext.genre}核心规则`,
          description: `${dto.central_conflict} 必须持续驱动角色行动。`,
          constraints: `${dto.status_tension} 不能在前期被轻易解除。`,
          cost: dto.relationship_hook,
          first_appearance_chapter_no: 1,
        },
      ],
    };
  }

  private fallbackOutline(dto: BootstrapProjectDto) {
    return {
      nodes: [
        {
          phase_no: 1,
          title: "开局入局",
          summary: `在“${dto.opening_scene}”中引爆“${dto.central_conflict}”，迫使主角正式入局。`,
          goal: "建立主角初始困境与行动理由",
          conflict: dto.status_tension,
          milestone_chapter_no: 1,
        },
        {
          phase_no: 2,
          title: "第一次反制",
          summary: `主角围绕“${dto.central_conflict}”第一次主动出手，同时关系张力开始回咬。`,
          goal: "展示能力、限制与关系代价",
          conflict: dto.relationship_hook,
          milestone_chapter_no: 8,
        },
        {
          phase_no: 3,
          title: "中盘失衡",
          summary: "处境压力和关系错位一起升级，局部问题拖成全局危机。",
          goal: "把冲突从个人处境抬高到更大局势",
          conflict: dto.central_conflict,
          milestone_chapter_no: 20,
        },
        {
          phase_no: 4,
          title: "终局对决",
          summary: "回收前文承诺，逼主角在代价与欲望之间完成最终抉择。",
          goal: "兑现主线冲突并完成关系收束",
          conflict: `${dto.central_conflict} 的终极代价浮出水面`,
          milestone_chapter_no: 40,
        },
      ],
    };
  }

  private resolveBootstrapBeatsSyncTimeoutMs() {
    const fromEnv = Number.parseInt(process.env.BOOTSTRAP_BEATS_SYNC_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30_000;
  }

  private resolveBootstrapLlmTimeoutMs() {
    const fromEnv = Number.parseInt(process.env.BOOTSTRAP_LLM_TIMEOUT_MS ?? "", 10);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 30_000;
  }

  private async initializeBootstrapBeats(args: {
    chapterId: string;
    queryEntities: string[];
    instructionLines: string[];
    idempotencyKey: string;
  }): Promise<BootstrapBeatsInitResult> {
    const beatsTask = this.generationService
      .generate(
        args.chapterId,
        "beats",
        {
          k: 50,
          query_entities: args.queryEntities,
          instruction: [
            "这是新项目的开局破冰章节。",
            "章节必须显式建立当前处境、冲突触发与后续牵引点。",
            ...args.instructionLines,
          ].join("\n"),
        },
        `${args.idempotencyKey}:bootstrap:beats`,
      )
      .then((result) => ({
        state: "completed" as const,
        versionId: (result as { version?: { id?: string } })?.version?.id,
      }))
      .catch((error) => ({
        state: "failed" as const,
        errorMessage: error instanceof Error ? error.message : "Bootstrap beats generation failed",
      }));

    const timeoutMs = this.resolveBootstrapBeatsSyncTimeoutMs();
    let timer: NodeJS.Timeout | null = null;
    const timeoutTask = new Promise<BootstrapBeatsInitResult>((resolve) => {
      timer = setTimeout(() => resolve({ state: "timed_out" }), timeoutMs);
    });

    const settled = await Promise.race([beatsTask, timeoutTask]);
    if (timer) {
      clearTimeout(timer);
    }

    return settled;
  }

  private async generateBibleDraft(dto: BootstrapProjectDto) {
    if (!this.provider) {
      return this.fallbackBibleDraft(dto);
    }

    try {
      const promptContext = buildBootstrapPromptContext(dto);
      const result = await this.provider.generateText({
        model: this.model,
        system: "你是小说开局策划助手。输出严格 JSON，不要输出 Markdown。",
        user: [
          "根据用户输入，初始化故事圣经。",
          "所有角色、术语、规则都必须围绕 central_conflict 组织，不能只复述 logline。",
          "开局必须明确：当前处境、冲突触发、关系钩子、后续牵引点。",
          "要求：必须返回 characters/glossary/entities 三个字段。",
          "characters 至少1个主角，需包含 visual_anchors/personality_tags/current_status。",
          "glossary 生成 3-8 条世界观关键术语。",
          "entities 至少 1 条 rule。",
          ...promptContext.lines,
        ].join("\n\n"),
        schema: bootstrapBibleSchema,
        temperature: 0.4,
        maxTokens: 1800,
        timeoutMs: this.resolveBootstrapLlmTimeoutMs(),
      });

      if (result.parsed) {
        return result.parsed;
      }
      return this.fallbackBibleDraft(dto);
    } catch {
      return this.fallbackBibleDraft(dto);
    }
  }

  private async generateOutline(dto: BootstrapProjectDto, bibleDraft: z.infer<typeof bootstrapBibleSchema>) {
    if (!this.provider) {
      return this.fallbackOutline(dto);
    }

    try {
      const protagonist = bibleDraft.characters[0]?.name ?? "主角";
      const promptContext = buildBootstrapPromptContext(dto);
      const result = await this.provider.generateText({
        model: this.model,
        system: "你是长篇小说结构规划器。输出严格 JSON，不要输出 Markdown。",
        user: [
          "根据用户输入与主角设定，生成 3-5 阶段全局大纲。",
          "所有阶段必须围绕 central_conflict 推进，不能偏成平行支线。",
          "开局阶段必须写清当前处境、冲突触发和下一阶段牵引点。",
          "每个阶段都要有 title/summary，并尽量给出 goal/conflict。",
          `protagonist: ${protagonist}`,
          ...promptContext.lines,
        ].join("\n\n"),
        schema: outlineSchema,
        temperature: 0.5,
        maxTokens: 1600,
        timeoutMs: this.resolveBootstrapLlmTimeoutMs(),
      });

      if (result.parsed) {
        return result.parsed;
      }
      return this.fallbackOutline(dto);
    } catch {
      return this.fallbackOutline(dto);
    }
  }

  private async loadOrCreateRequest(args: {
    projectId: string;
    idempotencyKey: string;
    requestHash: string;
  }) {
    const existing = await this.prisma.bootstrapRequest.findUnique({
      where: {
        project_id_idempotency_key: {
          project_id: args.projectId,
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
        throw new BadRequestException(existing.error_message ?? "Previous bootstrap request failed");
      }

      if (existing.response_chapter_id && existing.response_chapter_no) {
        return {
          request: existing,
          replay: {
            chapter_id: existing.response_chapter_id,
            chapter_no: existing.response_chapter_no,
          },
        };
      }

      return { request: existing, replay: null };
    }

    const request = await this.prisma.bootstrapRequest.create({
      data: {
        project_id: args.projectId,
        idempotency_key: args.idempotencyKey,
        request_hash: args.requestHash,
        status: GenerationRequestStatus.in_progress,
      },
    });

    return { request, replay: null };
  }

  private async markRequestFailed(requestId: string, message: string) {
    await this.prisma.bootstrapRequest.update({
      where: { id: requestId },
      data: {
        status: GenerationRequestStatus.failed,
        error_message: message,
      },
    });
  }

  private async markRequestSucceeded(requestId: string, chapterId: string, chapterNo: number) {
    await this.prisma.bootstrapRequest.update({
      where: { id: requestId },
      data: {
        status: GenerationRequestStatus.succeeded,
        response_chapter_id: chapterId,
        response_chapter_no: chapterNo,
      },
    });
  }

  async getBootstrapStatus(projectId: string, idempotencyKey?: string) {
    await this.ensureProject(projectId);

    const idemKey = this.requireIdempotencyKey(idempotencyKey, "idempotency_key query");
    const request = await this.prisma.bootstrapRequest.findUnique({
      where: {
        project_id_idempotency_key: {
          project_id: projectId,
          idempotency_key: idemKey,
        },
      },
    });

    if (!request) {
      throw new NotFoundException("Bootstrap request not found");
    }

    const chapterNo = request.response_chapter_no ?? null;
    const chapterId = request.response_chapter_id ?? null;

    return {
      project_id: projectId,
      request_id: request.id,
      idempotency_key: idemKey,
      status: request.status,
      chapter_id: chapterId,
      chapter_no: chapterNo,
      workspace_path:
        chapterNo && chapterId ? `/projects/${projectId}/chapters/${chapterNo}/workspace` : null,
      error_message: request.error_message ?? null,
      updated_at: request.updated_at.toISOString(),
    };
  }

  async bootstrapProject(projectId: string, dto: BootstrapProjectDto, idempotencyKey?: string) {
    const project = await this.ensureProject(projectId);

    const idemKey = this.requireIdempotencyKey(idempotencyKey);
    const reqHash = this.requestHash(dto);

    const requestState = await this.loadOrCreateRequest({
      projectId,
      idempotencyKey: idemKey,
      requestHash: reqHash,
    });

    if (requestState.replay) {
      return {
        replay: true,
        project_id: projectId,
        chapter_id: requestState.replay.chapter_id,
        chapter_no: requestState.replay.chapter_no,
        workspace_path: `/projects/${projectId}/chapters/${requestState.replay.chapter_no}/workspace`,
      };
    }

    try {
      const promptContext = buildBootstrapPromptContext(dto);
      if ((project.genre ?? "") !== dto.genre.trim()) {
        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            genre: dto.genre.trim(),
          },
        });
      }

      const bibleDraft = await this.generateBibleDraft(dto);

      await this.bibleService.patchBible(projectId, {
        characters: bibleDraft.characters.map((character) => ({
          name: character.name,
          aliases: character.aliases ?? [],
          age: character.age ?? undefined,
          appearance: character.appearance ?? undefined,
          personality: character.personality ?? undefined,
          visual_anchors: character.visual_anchors ?? undefined,
          personality_tags: character.personality_tags ?? undefined,
          current_status: character.current_status ?? undefined,
          motivation: character.motivation ?? undefined,
          secrets: character.secrets ?? undefined,
          abilities: {},
          catchphrases: character.catchphrases ?? [],
        })),
        entities: bibleDraft.entities.map((entity) => ({
          type: entity.type,
          name: entity.name,
          description: entity.description ?? undefined,
          constraints: entity.constraints ?? undefined,
          cost: entity.cost ?? undefined,
          first_appearance_chapter_no: entity.first_appearance_chapter_no ?? undefined,
        })),
        glossary: bibleDraft.glossary.map((term) => ({
          term: term.term,
          canonical_form: term.canonical_form,
          notes: term.notes ?? undefined,
        })),
      });

      const outlineDraft = await this.generateOutline(dto, bibleDraft);
      const outline = await this.outlineService.patchOutline(projectId, {
        nodes: outlineDraft.nodes.map((node, index) => ({
          phase_no: node.phase_no || index + 1,
          title: node.title,
          summary: node.summary,
          goal: node.goal ?? undefined,
          conflict: node.conflict ?? undefined,
          milestone_chapter_no: node.milestone_chapter_no ?? undefined,
        })),
      });

      const firstNode = outline[0];
      let chapter = await this.prisma.chapter.findFirst({
        where: { project_id: projectId, chapter_no: 1 },
      });

      if (!chapter) {
        chapter = await this.chaptersService.createChapter(projectId, {
          chapter_no: 1,
          title: firstNode?.title ?? "第一章",
          goal: firstNode?.goal ?? firstNode?.summary ?? dto.logline,
          conflict: firstNode?.conflict ?? "开局冲突待推进",
          twist: undefined,
          cliffhanger: undefined,
          word_target: DEFAULT_CHAPTER_WORD_TARGET,
          status: "outline",
        });
      }

      await this.prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          goal: firstNode?.goal ?? chapter.goal,
          conflict: firstNode?.conflict ?? chapter.conflict,
        },
      });

      const beatsResult = await this.initializeBootstrapBeats({
        chapterId: chapter.id,
        queryEntities: bibleDraft.characters.slice(0, 6).map((c) => c.name),
        instructionLines: promptContext.lines,
        idempotencyKey: idemKey,
      });

      await this.markRequestSucceeded(requestState.request.id, chapter.id, chapter.chapter_no);

      return {
        replay: false,
        project_id: projectId,
        bible_initialized: {
          characters: bibleDraft.characters.length,
          glossary: bibleDraft.glossary.length,
          entities: bibleDraft.entities.length,
        },
        outline_nodes: outline.length,
        chapter_id: chapter.id,
        chapter_no: chapter.chapter_no,
        beats_version_id: beatsResult.state === "completed" ? beatsResult.versionId ?? null : null,
        beats_pending: beatsResult.state === "timed_out",
        beats_error: beatsResult.state === "failed" ? beatsResult.errorMessage : null,
        workspace_path: `/projects/${projectId}/chapters/${chapter.chapter_no}/workspace`,
        status: [
          { step: "init_bible", done: true },
          { step: "init_outline", done: true },
          beatsResult.state === "completed"
            ? { step: "init_chapter1_beats", done: true }
            : beatsResult.state === "timed_out"
              ? {
                  step: "init_chapter1_beats",
                  done: false,
                  note: `后台继续生成（同步等待已超过 ${Math.ceil(this.resolveBootstrapBeatsSyncTimeoutMs() / 1000)} 秒）`,
                }
              : {
                  step: "init_chapter1_beats",
                  done: false,
                  note: beatsResult.errorMessage,
                },
        ],
      };
    } catch (error) {
      await this.markRequestFailed(
        requestState.request.id,
        error instanceof Error ? error.message : "Unknown bootstrap error",
      );
      throw error;
    }
  }
}
