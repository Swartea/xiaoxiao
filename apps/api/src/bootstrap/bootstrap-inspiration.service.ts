import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider } from "@novel-factory/llm";
import { PrismaService } from "../prisma.service";
import {
  getInspirationGenre,
  inspirationCatalog,
  type InspirationChoice,
  type InspirationGenreTaxonomy,
  type InspirationProtagonistTemplate,
  type InspirationStorySeed,
} from "./inspiration-catalog";
import type {
  BootstrapLoglineOptionsDto,
  BootstrapProtagonistTemplateDto,
  BootstrapRandomIdeaDto,
  BootstrapStorySeedDto,
  BootstrapStorySeedOptionsDto,
  BootstrapTitleOptionsDto,
  BootstrapVolumePlanGenerationDto,
} from "./dto";

const storySeedOptionsSchema = z.object({
  options: z
    .array(
      z.object({
        label: z.string().min(2).max(18),
        setup: z.string().min(12).max(120),
      }),
    )
    .length(6),
});

const titleOptionsSchema = z.object({
  options: z.array(z.string().min(4).max(8)).length(6),
});

const loglineOptionsSchema = z.object({
  options: z.array(z.string().min(18).max(180)).length(4),
});

const volumePlanSchema = z.object({
  volume_title: z.string().min(2).max(24),
  main_objective: z.string().min(12).max(160),
  antagonist_force: z.string().min(12).max(160),
  central_mystery: z.string().min(12).max(160),
  first_turning_point: z.string().min(12).max(160),
  chapter_missions: z
    .array(
      z.object({
        chapter_no: z.number().int().min(1).max(5),
        title: z.string().min(2).max(24),
        mission: z.string().min(10).max(180),
      }),
    )
    .length(5),
});

function uniqueStrings(values: Array<string | null | undefined>, limit = 6) {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim().replace(/^《|》$/g, "");
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

function hashId(prefix: string, value: string, index: number) {
  return `${prefix}-${createHash("sha1").update(`${index}:${value}`).digest("hex").slice(0, 12)}`;
}

function compactRoleIdentity(roleIdentity: string) {
  const compact = roleIdentity.split("的").pop()?.trim() ?? roleIdentity.trim();
  return compact.length <= 8 ? compact : compact.slice(0, 8);
}

function fitTitleLength(value: string, fallbackSuffix = "录") {
  const clean = value.replace(/[《》\s]/g, "").trim();
  if (clean.length >= 4 && clean.length <= 8) {
    return clean;
  }
  if (clean.length > 8) {
    return clean.slice(0, 8);
  }
  return `${clean}${fallbackSuffix}`.slice(0, 8);
}

function normalizedStorySeed(seed?: BootstrapStorySeedDto | null) {
  if (!seed) {
    return null;
  }
  const label = seed.label.trim();
  const setup = seed.setup.trim();
  if (!label || !setup) {
    return null;
  }
  return { label, setup };
}

function normalizedTemplate(template?: BootstrapProtagonistTemplateDto | null) {
  if (!template) {
    return null;
  }
  const role_identity = template.role_identity.trim();
  const strength = template.strength.trim();
  const weakness = template.weakness.trim();
  if (!role_identity || !strength || !weakness) {
    return null;
  }
  return { role_identity, strength, weakness };
}

@Injectable()
export class BootstrapInspirationService {
  private readonly provider: LlmProvider | null;
  private readonly model: string;

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
    this.model =
      process.env.MODEL_BOOTSTRAP ?? (usingDeepSeek ? "deepseek-chat" : usingXai ? "grok-3-mini-beta" : "gpt-4.1-mini");
  }

  private async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private requireGenre(genreId: string) {
    const genre = getInspirationGenre(genreId);
    if (!genre) {
      throw new BadRequestException("Unsupported genre");
    }
    return genre;
  }

  private requireSubGenre(genre: InspirationGenreTaxonomy, subGenreId: string) {
    const subGenre = genre.sub_genres.find((item) => item.id === subGenreId);
    if (!subGenre) {
      throw new BadRequestException("Unsupported sub-genre");
    }
    return subGenre;
  }

  private requireTropeChoices(genre: InspirationGenreTaxonomy, tropeIds: string[]) {
    const uniqueIds = Array.from(new Set(tropeIds));
    const tropes = uniqueIds
      .map((id) => genre.tropes.find((item) => item.id === id))
      .filter((item): item is InspirationChoice => Boolean(item));

    if (tropes.length !== uniqueIds.length) {
      throw new BadRequestException("Unsupported trope");
    }

    return tropes;
  }

  private scoreTaggedItem(
    item: { sub_genres: string[]; tropes: string[] },
    subGenreId: string,
    tropeIds: string[],
    preferredKeyword?: string,
  ) {
    let score = 0;
    if (item.sub_genres.includes(subGenreId)) {
      score += 4;
    }
    for (const tropeId of tropeIds) {
      if (item.tropes.includes(tropeId)) {
        score += 2;
      }
    }
    if (preferredKeyword) {
      score += 1;
    }
    return score;
  }

  private sortByScore<T extends { id: string; sub_genres: string[]; tropes: string[] }>(
    items: T[],
    subGenreId: string,
    tropeIds: string[],
    preferredKeyword?: string,
  ) {
    return items
      .map((item) => ({
        item,
        score: this.scoreTaggedItem(item, subGenreId, tropeIds, preferredKeyword),
        rand: Math.random(),
      }))
      .sort((left, right) => right.score - left.score || left.rand - right.rand || left.item.id.localeCompare(right.item.id))
      .map((entry) => entry.item);
  }

  private fallbackStorySeedOptions(genre: InspirationGenreTaxonomy, dto: BootstrapStorySeedOptionsDto) {
    const excluded = new Set(dto.exclude_ids ?? []);
    const preferred = this.sortByScore(genre.story_seeds, dto.sub_genre, dto.tropes);
    const available = preferred.filter((item) => !excluded.has(item.id));
    const selected = (available.length >= 6 ? available : [...available, ...preferred.filter((item) => excluded.has(item.id))]).slice(0, 6);
    return selected.map((seed) => ({
      id: seed.id,
      label: seed.label,
      setup: seed.setup,
    }));
  }

  private titleSuffix(genreId: InspirationGenreTaxonomy["id"]) {
    switch (genreId) {
      case "historical":
        return ["局", "案", "诏", "风起", "录", "惊变"];
      case "urban":
        return ["名单", "计划", "夜话", "风暴", "热搜", "失控"];
      case "fantasy":
        return ["录", "纪", "秘契", "异闻", "之门", "潮汐"];
      case "suspense":
        return ["档案", "倒计时", "盲区", "目击者", "暗线", "未结案"];
      case "romance_ancient":
        return ["婚书", "同心", "夜话", "春信", "心事", "局中人"];
      default:
        return ["之夜"];
    }
  }

  private fallbackTitleOptions(args: {
    genre: InspirationGenreTaxonomy;
    subGenre: InspirationChoice;
    tropes: InspirationChoice[];
    storySeed: { label: string; setup: string };
    protagonist: { role_identity: string; strength: string; weakness: string };
  }) {
    const role = compactRoleIdentity(args.protagonist.role_identity);
    const tropeA = args.tropes[0]?.label ?? args.genre.label;
    const tropeB = args.tropes[1]?.label ?? args.subGenre.label;
    const suffixes = this.titleSuffix(args.genre.id);
    const seedShort = args.storySeed.label.slice(0, Math.min(6, args.storySeed.label.length));
    const seedCore = args.storySeed.label.slice(0, Math.min(4, args.storySeed.label.length));
    return uniqueStrings(
      [
        fitTitleLength(args.storySeed.label, suffixes[0]),
        fitTitleLength(`${seedCore}${suffixes[0]}`, suffixes[0]),
        fitTitleLength(`${role}${suffixes[1]}`, suffixes[1]),
        fitTitleLength(`${seedShort}${suffixes[2]}`, suffixes[2]),
        fitTitleLength(`谁动${seedCore}`, suffixes[3]),
        fitTitleLength(`${tropeA}${suffixes[2]}`, suffixes[2]),
        fitTitleLength(`${role}${seedCore}`, suffixes[4]),
        fitTitleLength(`${tropeB}${suffixes[3]}`, suffixes[3]),
      ],
      6,
    );
  }

  private fallbackLegacyLoglines(project: { title: string; genre: string | null; target_platform: string | null }, dto: BootstrapLoglineOptionsDto) {
    const protagonist = dto.protagonist_brief?.trim() || project.title || "主角";
    const tone = dto.tone_setting?.trim() || project.genre || project.target_platform || "高压困局";
    return uniqueStrings(
      [
        `${protagonist}原以为还能置身事外，却在一场${tone}风暴的前夜被点了名，若不先下手为强，就会成为第一只替罪羊。`,
        `${protagonist}在最不该知道真相的时候看见了禁忌的一角，而这份发现会让他失去现在拥有的一切。`,
        `${protagonist}被卷入一场只准赢家活下来的${tone}游戏，他若不能抢先识破规则，就会连名字都被抹掉。`,
        `${protagonist}以为自己还能退后一步，可当局势第一次失控时，他必须主动出手，否则代价会落到最不该受伤的人身上。`,
      ],
      4,
    );
  }

  private goalByGenre(genreId: InspirationGenreTaxonomy["id"], storySeedLabel: string, tropeLabels: string[]) {
    const trope = tropeLabels[0] ?? "真相";
    switch (genreId) {
      case "historical":
        return `在${storySeedLabel}掀开的局里查清幕后并保住官身与家门`;
      case "urban":
        return `在${storySeedLabel}引爆后自证清白并抢回主动权`;
      case "fantasy":
        return `在${storySeedLabel}带来的异变里活下来并掌握新的规则`;
      case "suspense":
        return `在${storySeedLabel}之后找出真正操盘者并拆穿${trope}`;
      case "romance_ancient":
        return `在${storySeedLabel}逼出来的关系局里保住名声、真心与退路`;
      default:
        return `在${storySeedLabel}之后抢回主动权`;
    }
  }

  private antagonistByGenre(genreId: InspirationGenreTaxonomy["id"], subGenreLabel: string, tropeLabels: string[]) {
    const tropeA = tropeLabels[0] ?? "旧局";
    const tropeB = tropeLabels[1] ?? "暗手";
    switch (genreId) {
      case "historical":
        return `盘踞在${subGenreLabel}里的旧权臣和借${tropeA}掩杀机的既得利益者。`;
      case "urban":
        return `同时掌握资源、舆论和灰色手段的对手，他们会借${tropeA}和${tropeB}一起压人。`;
      case "fantasy":
        return `掌控旧秩序的强敌与被${tropeA}唤醒的更古老威胁。`;
      case "suspense":
        return `一个利用${tropeA}布迷雾、再用${tropeB}误导所有人的高智对手。`;
      case "romance_ancient":
        return `把婚事、名声和权位当筹码的人，以及总想借${tropeA}拆散两人的外力。`;
      default:
        return `一股正在借势扩张的对手力量。`;
    }
  }

  private fallbackLoglineOptions(args: {
    genre: InspirationGenreTaxonomy;
    subGenre: InspirationChoice;
    tropes: InspirationChoice[];
    storySeed: { label: string; setup: string };
    protagonist: { role_identity: string; strength: string; weakness: string };
    selectedTitle?: string;
  }) {
    const role = args.protagonist.role_identity;
    const goal = this.goalByGenre(args.genre.id, args.storySeed.label, args.tropes.map((item) => item.label));
    const antagonist = this.antagonistByGenre(args.genre.id, args.subGenre.label, args.tropes.map((item) => item.label));
    const setup = args.storySeed.setup.replace(/[。！？]$/g, "");
    return uniqueStrings(
      [
        `${role}在${setup}后被迫${goal}，否则他最想守住的一切都会先一步被拿去陪葬。`,
        `${role}因${args.storySeed.label}被推到局面中央，表面上他要先自保，实际上必须抢在所有人之前拆穿${antagonist}`,
        `${role}卷进${args.storySeed.label}时还没来得及站稳脚跟，就发现自己成了最方便的替罪羊，而他唯一的退路就是${goal}`,
        `${args.selectedTitle ? `《${args.selectedTitle}》里，` : ""}${role}必须从${args.storySeed.label}这件具体灾祸里撕开第一道口子，因为真正要命的冲突根本不在表面。`,
      ],
      4,
    );
  }

  private fallbackVolumePlan(args: {
    genre: InspirationGenreTaxonomy;
    subGenre: InspirationChoice;
    tropes: InspirationChoice[];
    storySeed: { label: string; setup: string };
    protagonist: { role_identity: string; strength: string; weakness: string };
    selectedTitle: string;
    selectedLogline: string;
  }) {
    const role = args.protagonist.role_identity;
    const tropeLabels = args.tropes.map((item) => item.label);
    const volume_title = args.selectedTitle || `${args.storySeed.label}卷`;
    const main_objective = `${role}必须在${args.storySeed.label}掀起的第一波危机里站稳脚跟，先保命，再抢回解释权和主动权。`;
    const antagonist_force = this.antagonistByGenre(args.genre.id, args.subGenre.label, tropeLabels);
    const central_mystery = `${args.storySeed.label}为什么会精准砸到${role}身上，真正受益的人到底是谁？`;
    const first_turning_point = `${role}以为自己抓到了第一条真线索，却发现整件事从一开始就在逼他按别人设计的路走。`;

    const chapter_missions =
      args.genre.id === "romance_ancient"
        ? [
            { chapter_no: 1, title: `${args.storySeed.label}当夜`, mission: `让男女主因为${args.storySeed.label}被迫正面绑定，同时把双方最不想暴露的弱点亮出来。` },
            { chapter_no: 2, title: "先保体面", mission: "先处理眼前名声和局势，明确两人暂时结盟的理由。"},
            { chapter_no: 3, title: "第一次并肩", mission: "让两人第一次真正合作，换来一条既能推进关系也能推进主线的线索。"},
            { chapter_no: 4, title: "误会加深", mission: "借外部压力和信息差制造第一次情感挫折，让关系更难退回原点。"},
            { chapter_no: 5, title: "转折来临", mission: "让两人在第一次关键对冲里确认更大的阴谋或更深的情感代价。"},
          ]
        : [
            { chapter_no: 1, title: `${args.storySeed.label}当夜`, mission: `直面${args.storySeed.setup}，让主角先活下来，并确认自己已经成了局里最方便被推出来的人。` },
            { chapter_no: 2, title: "先保自己", mission: "盘点损失、锁定第一个突破口，同时暴露主角最大的弱点。"},
            { chapter_no: 3, title: "换一条路", mission: "拿到一名临时盟友或一件关键资源，让主角第一次主动反制。"},
            { chapter_no: 4, title: "假线索", mission: `顺着${tropeLabels[0] ?? "眼前线索"}挖到表层真相，再发现那只是更大局面的伪装。`},
            { chapter_no: 5, title: "第一次转折", mission: "在首次正面交锋里翻出更大的目标和更狠的敌人，迫使主角改变原计划。"},
          ];

    return {
      volume_title,
      main_objective,
      antagonist_force,
      central_mystery,
      first_turning_point,
      chapter_missions,
    };
  }

  private protagonistPool(genre: InspirationGenreTaxonomy, subGenreId: string, tropeIds: string[], storySeedLabel: string) {
    return this.sortByScore(genre.protagonist_templates, subGenreId, tropeIds, storySeedLabel);
  }

  getTaxonomy() {
    return {
      genres: inspirationCatalog,
    };
  }

  async generateStorySeedOptions(projectId: string, dto: BootstrapStorySeedOptionsDto) {
    await this.ensureProject(projectId);
    const genre = this.requireGenre(dto.genre);
    const subGenre = this.requireSubGenre(genre, dto.sub_genre);
    const tropes = this.requireTropeChoices(genre, dto.tropes);
    const fallbackOptions = this.fallbackStorySeedOptions(genre, dto);

    if (!this.provider) {
      return {
        fallback: true,
        options: fallbackOptions,
      };
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: [
          "You are a web novel idea generator.",
          "Generate 6 story seeds.",
          "Each seed must be a concrete opening event.",
          "Avoid abstract phrases like fate, storm, destiny.",
          "Prefer concrete hooks such as missing grain, murder case, rebellion, disappearance.",
          "输出严格 JSON，不要输出 Markdown。",
        ].join("\n"),
        user: [
          `Genre: ${genre.label}`,
          `SubGenre: ${subGenre.label}`,
          `Tropes: ${tropes.map((item) => item.label).join(", ")}`,
          "Return six JSON items with label and setup.",
          "label 用 4-10 个汉字概括事件，setup 写成一句具体开局事件。",
        ].join("\n\n"),
        schema: storySeedOptionsSchema,
        temperature: 0.9,
        maxTokens: 1200,
        timeoutMs: 90_000,
      });

      const options =
        result.parsed?.options
          ?.map((option, index) => ({
            id: hashId("seed", `${option.label}:${option.setup}`, index),
            label: option.label.trim(),
            setup: option.setup.trim(),
          }))
          .slice(0, 6) ?? [];

      if (options.length === 6) {
        return {
          fallback: false,
          options,
        };
      }
    } catch {
      // Fall through to curated fallback.
    }

    return {
      fallback: true,
      options: fallbackOptions,
    };
  }

  async generateTitleOptions(projectId: string, dto: BootstrapTitleOptionsDto) {
    await this.ensureProject(projectId);
    const genre = this.requireGenre(dto.genre);
    const subGenre = this.requireSubGenre(genre, dto.sub_genre);
    const tropes = this.requireTropeChoices(genre, dto.tropes);
    const storySeed = normalizedStorySeed(dto.story_seed);
    const protagonist = normalizedTemplate(dto.protagonist_template);

    if (!storySeed || !protagonist) {
      throw new BadRequestException("Story seed and protagonist template are required");
    }

    const fallbackOptions = this.fallbackTitleOptions({
      genre,
      subGenre,
      tropes,
      storySeed,
      protagonist,
    });

    if (!this.provider) {
      return {
        fallback: true,
        options: fallbackOptions,
      };
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: [
          "Generate 6 Chinese web novel titles.",
          "Requirements:",
          "- 4-8 Chinese characters",
          "- catchy",
          "- easy to remember",
          "- genre appropriate",
          "输出严格 JSON，不要输出 Markdown。",
        ].join("\n"),
        user: [
          `Genre: ${genre.label}`,
          `Story seed: ${storySeed.setup}`,
          `Protagonist template: ${protagonist.role_identity}`,
          `Tropes: ${tropes.map((item) => item.label).join(", ")}`,
        ].join("\n\n"),
        schema: titleOptionsSchema,
        temperature: 0.9,
        maxTokens: 800,
        timeoutMs: 90_000,
      });

      const options = uniqueStrings((result.parsed?.options ?? []).map((item) => fitTitleLength(item)), 6);
      if (options.length === 6) {
        return {
          fallback: false,
          options,
        };
      }
    } catch {
      // Fall through to fallback.
    }

    return {
      fallback: true,
      options: fallbackOptions,
    };
  }

  async generateLoglineOptions(projectId: string, dto: BootstrapLoglineOptionsDto) {
    const project = await this.ensureProject(projectId);
    const storySeed = normalizedStorySeed(dto.story_seed);
    const protagonist = normalizedTemplate(dto.protagonist_template);

    if (!storySeed || !protagonist || !dto.genre || !dto.sub_genre || !dto.tropes?.length) {
      return {
        fallback: true,
        options: this.fallbackLegacyLoglines(project, dto),
      };
    }

    const genre = this.requireGenre(dto.genre);
    const subGenre = this.requireSubGenre(genre, dto.sub_genre);
    const tropes = this.requireTropeChoices(genre, dto.tropes);
    const fallbackOptions = this.fallbackLoglineOptions({
      genre,
      subGenre,
      tropes,
      storySeed,
      protagonist,
      selectedTitle: dto.selected_title?.trim(),
    });

    if (!this.provider) {
      return {
        fallback: true,
        options: fallbackOptions,
      };
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: [
          "Generate 4 loglines for a web novel.",
          "Each logline must include:",
          "- protagonist identity",
          "- concrete event",
          "- central conflict",
          "Avoid abstract wording.",
          "Length: 1 sentence.",
          "输出严格 JSON，不要输出 Markdown。",
        ].join("\n"),
        user: [
          `Genre: ${genre.label}`,
          `Story seed: ${storySeed.setup}`,
          `Protagonist template: ${protagonist.role_identity}`,
          `Title: ${dto.selected_title?.trim() || ""}`,
        ].join("\n\n"),
        schema: loglineOptionsSchema,
        temperature: 0.8,
        maxTokens: 1200,
        timeoutMs: 90_000,
      });

      const options = uniqueStrings(result.parsed?.options ?? [], 4);
      if (options.length === 4) {
        return {
          fallback: false,
          options,
        };
      }
    } catch {
      // Fall through to fallback.
    }

    return {
      fallback: true,
      options: fallbackOptions,
    };
  }

  async generateVolumePlan(projectId: string, dto: BootstrapVolumePlanGenerationDto) {
    await this.ensureProject(projectId);
    const genre = this.requireGenre(dto.genre);
    const subGenre = this.requireSubGenre(genre, dto.sub_genre);
    const tropes = this.requireTropeChoices(genre, dto.tropes);
    const storySeed = normalizedStorySeed(dto.story_seed);
    const protagonist = normalizedTemplate(dto.protagonist_template);

    if (!storySeed || !protagonist) {
      throw new BadRequestException("Story seed and protagonist template are required");
    }

    const fallbackPlan = this.fallbackVolumePlan({
      genre,
      subGenre,
      tropes,
      storySeed,
      protagonist,
      selectedTitle: dto.selected_title.trim(),
      selectedLogline: dto.selected_logline.trim(),
    });

    if (!this.provider) {
      return {
        fallback: true,
        plan: fallbackPlan,
      };
    }

    try {
      const result = await this.provider.generateText({
        model: this.model,
        system: [
          "Generate a first volume skeleton.",
          "Output:",
          "Volume title",
          "Main objective",
          "Antagonist force",
          "Central mystery",
          "First turning point",
          "First 5 chapter missions",
          "输出严格 JSON，不要输出 Markdown。",
        ].join("\n"),
        user: [
          `Genre: ${genre.label}`,
          `SubGenre: ${subGenre.label}`,
          `Tropes: ${tropes.map((item) => item.label).join(", ")}`,
          `Story seed: ${storySeed.setup}`,
          `Protagonist template: ${protagonist.role_identity}`,
          `Title: ${dto.selected_title}`,
          `Logline: ${dto.selected_logline}`,
        ].join("\n\n"),
        schema: volumePlanSchema,
        temperature: 0.8,
        maxTokens: 1600,
        timeoutMs: 90_000,
      });

      if (result.parsed) {
        return {
          fallback: false,
          plan: result.parsed,
        };
      }
    } catch {
      // Fall through to fallback.
    }

    return {
      fallback: true,
      plan: fallbackPlan,
    };
  }

  async generateRandomIdea(projectId: string, dto: BootstrapRandomIdeaDto = {}) {
    await this.ensureProject(projectId);
    const genre = dto.genre ? this.requireGenre(dto.genre) : inspirationCatalog[Math.floor(Math.random() * inspirationCatalog.length)];
    const subGenre = genre.sub_genres[Math.floor(Math.random() * genre.sub_genres.length)];
    const tropeCount = Math.random() > 0.5 ? 3 : 2;
    const shuffledTropes = genre.tropes.slice().sort(() => Math.random() - 0.5);
    const selectedTropes = shuffledTropes.slice(0, tropeCount);

    const seedResult = await this.generateStorySeedOptions(projectId, {
      genre: genre.id,
      sub_genre: subGenre.id,
      tropes: selectedTropes.map((item) => item.id),
      exclude_ids: [],
    });
    const selectedStorySeed = seedResult.options[0];
    const selectedProtagonistTemplate = this.protagonistPool(
      genre,
      subGenre.id,
      selectedTropes.map((item) => item.id),
      selectedStorySeed.label,
    )[0];

    const titleResult = await this.generateTitleOptions(projectId, {
      genre: genre.id,
      sub_genre: subGenre.id,
      tropes: selectedTropes.map((item) => item.id),
      story_seed: selectedStorySeed,
      protagonist_template: selectedProtagonistTemplate,
    });
    const selectedTitle = titleResult.options[0];

    const loglineResult = await this.generateLoglineOptions(projectId, {
      genre: genre.id,
      sub_genre: subGenre.id,
      tropes: selectedTropes.map((item) => item.id),
      story_seed: selectedStorySeed,
      protagonist_template: selectedProtagonistTemplate,
      selected_title: selectedTitle,
    });
    const selectedLogline = loglineResult.options[0];

    const volumePlanResult = await this.generateVolumePlan(projectId, {
      genre: genre.id,
      sub_genre: subGenre.id,
      tropes: selectedTropes.map((item) => item.id),
      story_seed: selectedStorySeed,
      protagonist_template: selectedProtagonistTemplate,
      selected_title: selectedTitle,
      selected_logline: selectedLogline,
    });

    return {
      fallback: seedResult.fallback || titleResult.fallback || loglineResult.fallback || volumePlanResult.fallback,
      setup: {
        genre: genre.id,
        sub_genre: subGenre.id,
        tropes: selectedTropes.map((item) => item.id),
        story_seed: selectedStorySeed,
        protagonist_template: selectedProtagonistTemplate,
        selected_title: selectedTitle,
        selected_logline: selectedLogline,
        selected_volume_plan: volumePlanResult.plan,
      },
      options: {
        story_seeds: seedResult.options,
        titles: titleResult.options,
        loglines: loglineResult.options,
      },
    };
  }
}
