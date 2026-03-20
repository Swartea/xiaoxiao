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
import { BootstrapLoglineOptionsDto, BootstrapProjectDto } from "./dto";

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

const loglineOptionsSchema = z.object({
  options: z.array(z.string().min(12).max(180)).min(4).max(6),
});

function normalizeJson<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 6) {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || result.includes(normalized)) {
      continue;
    }
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
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

  private fallbackLoglineSubject(projectTitle: string, protagonistBrief?: string) {
    const protagonist = this.fallbackCharacterName(protagonistBrief ?? "");
    if (protagonist !== "主角") {
      return protagonist;
    }
    const projectHead = projectTitle.split(/[\s:：\-]/)[0]?.trim();
    return projectHead && projectHead.length <= 12 ? `${projectHead}中的主角` : "一个被逼到绝境的人";
  }

  private fallbackLoglineOptions(
    project: { title: string; genre: string | null; target_platform: string | null },
    dto: BootstrapLoglineOptionsDto,
  ) {
    const tone = dto.tone_setting?.trim() || project.genre || "悬念";
    const protagonist = this.fallbackLoglineSubject(project.title, dto.protagonist_brief);
    const seed = dto.seed_logline?.trim();
    const baseOptions = [
      `${protagonist}在一场${tone}风暴的前夜发现自己正被推向祭台，他若不先下手为强，就会成为局里第一个被牺牲的人。`,
      `${protagonist}原以为自己只是局外人，却在${tone}秩序崩裂的那一夜被迫做出选择：要么吞下真相，要么亲手掀翻整个棋盘。`,
      `${protagonist}在最不该知道真相的时候看见了禁忌的一角，而这份发现会让他失去现在拥有的一切。`,
      `${protagonist}被卷入一场只准赢家活下来的${tone}游戏，他若不能抢先识破规则，就会连名字都被抹掉。`,
      `${protagonist}以为自己还能退后一步，可当局势第一次失控时，他必须主动出手，否则代价会落到最不该受伤的人身上。`,
      `${protagonist}发现自己从来不是故事的旁观者，而是那场${tone}清算里最关键、也最危险的一枚活棋。`,
    ];

    return uniqueStrings(seed ? [seed, ...baseOptions] : baseOptions, 6).slice(0, 6);
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

  private outlineFromVolumePlan(dto: BootstrapProjectDto) {
    const plan = dto.selected_volume_plan;
    if (!plan) {
      return null;
    }

    const chapterSummary = plan.chapter_missions
      .map((mission) => `第${mission.chapter_no}章 ${mission.title}：${mission.mission}`)
      .join(" ");

    return {
      nodes: [
        {
          phase_no: 1,
          title: plan.volume_title,
          summary: chapterSummary,
          goal: plan.main_objective,
          conflict: plan.antagonist_force,
          milestone_chapter_no: 1,
        },
        {
          phase_no: 2,
          title: "谜团加压",
          summary: `围绕“${plan.central_mystery}”持续推进调查与反制。`,
          goal: "逼近真正的敌人与规则",
          conflict: plan.antagonist_force,
          milestone_chapter_no: 3,
        },
        {
          phase_no: 3,
          title: "第一次转折",
          summary: plan.first_turning_point,
          goal: "改写主角原本的阶段目标",
          conflict: plan.antagonist_force,
          milestone_chapter_no: 5,
        },
      ],
    };
  }

  private async persistStoryBlueprint(
    project: { id: string; title: string; genre: string | null; target_platform: string | null },
    dto: BootstrapProjectDto,
  ) {
    if (!dto.selected_volume_plan && !dto.selected_title && !dto.genre && !(dto.tropes?.length ?? 0)) {
      return;
    }

    const latest = await this.prisma.storyBlueprint.findFirst({
      where: { project_id: project.id },
      orderBy: { version_no: "desc" },
    });

    await this.prisma.storyBlueprint.create({
      data: {
        project_id: project.id,
        version_no: (latest?.version_no ?? 0) + 1,
        book_positioning: [dto.genre, dto.sub_genre].filter(Boolean).join(" / ") || project.title,
        genre: dto.genre ?? project.genre ?? "未设定",
        selling_points: dto.tropes ?? [],
        target_platform: project.target_platform ?? "webnovel",
        target_readers: "网文读者",
        pleasure_pacing: dto.selected_volume_plan
          ? `前五章任务：${dto.selected_volume_plan.chapter_missions.map((mission) => mission.title).join(" / ")}`
          : "每章推进 + 章节尾钩",
        main_conflict: dto.logline,
        core_suspense: dto.selected_volume_plan?.central_mystery ?? dto.story_seed ?? "核心悬念待补全",
        character_relation_map: normalizeJson({
          protagonist_template: dto.protagonist_template ?? null,
        }),
        world_rule_map: normalizeJson({
          genre: dto.genre ?? null,
          sub_genre: dto.sub_genre ?? null,
          story_seed: dto.story_seed ?? null,
          tone_setting: dto.tone_setting,
        }),
        volume_structure: normalizeJson(dto.selected_volume_plan ? [dto.selected_volume_plan] : []),
        chapter_targets: normalizeJson(dto.selected_volume_plan?.chapter_missions ?? []),
      },
    });
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
          dto.genre ? `genre: ${dto.genre}` : "",
          dto.sub_genre ? `sub_genre: ${dto.sub_genre}` : "",
          dto.tropes?.length ? `tropes: ${dto.tropes.join(" / ")}` : "",
          dto.story_seed ? `story_seed: ${dto.story_seed}` : "",
          dto.selected_title ? `selected_title: ${dto.selected_title}` : "",
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
    const planOutline = this.outlineFromVolumePlan(dto);
    if (planOutline) {
      return planOutline;
    }

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
          dto.genre ? `genre: ${dto.genre}` : "",
          dto.sub_genre ? `sub_genre: ${dto.sub_genre}` : "",
          dto.story_seed ? `story_seed: ${dto.story_seed}` : "",
          dto.selected_volume_plan ? `volume_plan: ${JSON.stringify(dto.selected_volume_plan)}` : "",
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

  async generateLoglineOptions(projectId: string, dto: BootstrapLoglineOptionsDto) {
    const project = await this.ensureProject(projectId);
    const toneSetting = dto.tone_setting?.trim() || project.genre || project.target_platform || "权谋";
    const protagonistBrief = dto.protagonist_brief?.trim() || "";
    const seedLogline = dto.seed_logline?.trim() || "";

    if (!this.provider) {
      return {
        fallback: true,
        options: this.fallbackLoglineOptions(project, dto),
      };
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: [
          "你是 StoryOS 的故事开局策划助手。",
          "你要生成 4-6 条可直接作为小说 logline 的候选。",
          "每条都要是一句话，强调主角、压力、行动目标和失败代价。",
          "不同候选要有明显差异：有的更偏人物困境，有的更偏悬念，有的更偏世界规则。",
          "输出严格 JSON，不要输出 Markdown。",
        ].join("\n"),
        user: [
          `project_title: ${project.title}`,
          `genre: ${project.genre ?? ""}`,
          `target_platform: ${project.target_platform ?? ""}`,
          `tone_setting: ${toneSetting}`,
          `protagonist_brief: ${protagonistBrief}`,
          seedLogline ? `seed_logline: ${seedLogline}` : "",
          "请生成 4-6 条候选 logline，中文输出，尽量短、狠、清晰。",
        ]
          .filter(Boolean)
          .join("\n\n"),
        schema: loglineOptionsSchema,
        temperature: 0.9,
        maxTokens: 1200,
      });

      const options = uniqueStrings(result.parsed?.options ?? [], 6);
      if (options.length >= 4) {
        return {
          fallback: false,
          options,
        };
      }
    } catch {
      // Fall through to deterministic fallback options.
    }

    return {
      fallback: true,
      options: this.fallbackLoglineOptions(project, dto),
    };
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
      if (dto.selected_title?.trim() || dto.genre?.trim()) {
        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            title: dto.selected_title?.trim() || undefined,
            genre: dto.genre?.trim() || undefined,
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

      let chapter = await this.prisma.chapter.findFirst({
        where: { project_id: projectId, chapter_no: 1 },
      });

      const firstMission = dto.selected_volume_plan?.chapter_missions[0];
      const firstChapterTitle = firstMission?.title ?? outline[0]?.title ?? "第一章";
      const firstChapterGoal = firstMission?.mission ?? outline[0]?.goal ?? outline[0]?.summary ?? dto.logline;
      const firstChapterConflict = dto.selected_volume_plan?.antagonist_force ?? outline[0]?.conflict ?? "开局冲突待推进";

      if (!chapter) {
        chapter = await this.chaptersService.createChapter(projectId, {
          chapter_no: 1,
          title: firstChapterTitle,
          goal: firstChapterGoal,
          conflict: firstChapterConflict,
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
            dto.selected_title ? `selected_title: ${dto.selected_title}` : "",
            dto.genre ? `genre: ${dto.genre}` : "",
            dto.sub_genre ? `sub_genre: ${dto.sub_genre}` : "",
            dto.tropes?.length ? `tropes: ${dto.tropes.join(" / ")}` : "",
            dto.story_seed ? `story_seed: ${dto.story_seed}` : "",
            dto.selected_volume_plan?.chapter_missions[0]
              ? `chapter_1_mission: ${dto.selected_volume_plan.chapter_missions[0].mission}`
              : "",
          ].join("\n"),
        },
        `${idemKey}:bootstrap:beats`,
      );

      await this.prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          title: firstChapterTitle,
          goal: firstChapterGoal,
          conflict: firstChapterConflict,
        },
      });

      await this.persistStoryBlueprint(project, dto);

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
