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
import { ChaptersService } from "../chapters/chapters.service";
import { GenerationService } from "../generation/generation.service";
import { OutlineService } from "../outline/outline.service";
import { BootstrapProjectDto } from "./dto";

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

  private requireIdempotencyKey(idempotencyKey?: string) {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException("Idempotency-Key header is required");
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
    return {
      characters: [
        {
          name: mainName,
          aliases: [],
          age: null,
          appearance: dto.protagonist_brief,
          personality: `基调：${dto.tone_setting}`,
          visual_anchors: dto.protagonist_brief,
          personality_tags: "强撑、克制、带有隐性情绪",
          current_status: "开局压抑，目标未明",
          motivation: dto.logline,
          secrets: "待展开",
          catchphrases: [],
        },
      ],
      glossary: [
        { term: "主线冲突", canonical_form: dto.logline.slice(0, 20), notes: "来自开局向导" },
        { term: "故事基调", canonical_form: dto.tone_setting, notes: "来自开局向导" },
      ],
      entities: [
        {
          type: "rule",
          name: `${dto.tone_setting}核心规则`,
          description: "由开局向导自动生成，可后续手动改写。",
          constraints: "每次行动都需付出代价。",
          cost: "心理或现实层面的损耗。",
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
          title: "引爆事件",
          summary: `围绕“${dto.logline}”触发主角被迫行动。`,
          goal: "建立主角初始困境",
          conflict: "外部压力与内部迟疑同时出现",
          milestone_chapter_no: 1,
        },
        {
          phase_no: 2,
          title: "第一次反制",
          summary: "主角尝试主动出手，但代价显现。",
          goal: "展示能力与限制",
          conflict: "规则与欲望冲突升级",
          milestone_chapter_no: 8,
        },
        {
          phase_no: 3,
          title: "中盘失衡",
          summary: "盟友关系和世界规则双重反噬。",
          goal: "把矛盾从局部拉到全局",
          conflict: "主角目标发生偏移",
          milestone_chapter_no: 20,
        },
        {
          phase_no: 4,
          title: "终局对决",
          summary: "回收伏笔并完成关键抉择。",
          goal: "兑现主线冲突",
          conflict: "代价与胜利不可兼得",
          milestone_chapter_no: 40,
        },
      ],
    };
  }

  private async generateBibleDraft(dto: BootstrapProjectDto) {
    if (!this.provider) {
      return this.fallbackBibleDraft(dto);
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: "你是小说开局策划助手。输出严格 JSON，不要输出 Markdown。",
        user: [
          "根据用户输入，初始化故事圣经。",
          "要求：必须返回 characters/glossary/entities 三个字段。",
          "characters 至少1个主角，需包含 visual_anchors/personality_tags/current_status。",
          "glossary 生成 3-8 条世界观关键术语。",
          "entities 至少 1 条 rule。",
          `logline: ${dto.logline}`,
          `protagonist_brief: ${dto.protagonist_brief}`,
          `tone_setting: ${dto.tone_setting}`,
        ].join("\n\n"),
        schema: bootstrapBibleSchema,
        temperature: 0.4,
        maxTokens: 1800,
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
      const result = await this.provider.generateText({
        model: this.model,
        system: "你是长篇小说结构规划器。输出严格 JSON，不要输出 Markdown。",
        user: [
          "根据 logline 与主角设定，生成 3-5 阶段全局大纲。",
          "每个阶段都要有 title/summary，并尽量给出 goal/conflict。",
          `logline: ${dto.logline}`,
          `protagonist: ${protagonist}`,
          `tone_setting: ${dto.tone_setting}`,
        ].join("\n\n"),
        schema: outlineSchema,
        temperature: 0.5,
        maxTokens: 1600,
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

  async bootstrapProject(projectId: string, dto: BootstrapProjectDto, idempotencyKey?: string) {
    await this.ensureProject(projectId);

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
          word_target: 4000,
          status: "outline",
        });
      }

      const queryEntities = bibleDraft.characters.slice(0, 6).map((c) => c.name);
      const beatsResult = await this.generationService.generate(
        chapter.id,
        "beats",
        {
          k: 50,
          query_entities: queryEntities,
          instruction: [
            "这是新项目的开局破冰章节。",
            `logline: ${dto.logline}`,
            `tone_setting: ${dto.tone_setting}`,
            `protagonist_brief: ${dto.protagonist_brief}`,
          ].join("\n"),
        },
        `${idemKey}:bootstrap:beats`,
      );

      await this.prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          goal: firstNode?.goal ?? chapter.goal,
          conflict: firstNode?.conflict ?? chapter.conflict,
        },
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
        beats_version_id: (beatsResult as { version?: { id?: string } })?.version?.id,
        workspace_path: `/projects/${projectId}/chapters/${chapter.chapter_no}/workspace`,
        status: [
          { step: "init_bible", done: true },
          { step: "init_outline", done: true },
          { step: "init_chapter1_beats", done: true },
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
