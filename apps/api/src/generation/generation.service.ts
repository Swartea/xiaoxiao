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
  type Project,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { createPatch } from "diff";
import {
  buildMergedCharacterStateSnapshot,
  buildGenerationContext,
  deriveCurrentStatusFromStateSnapshot,
  fallbackExtractMemory,
  flattenCharacterStateSnapshot,
  injectCharacterDepth,
  isRetrievableMemoryStatus,
  sanitizeExtractedFacts,
  normalizedContentHash,
  parseExtractorJson,
  runContinuityCheck,
  sha256FromCanonicalJson,
  validateExtractedMemoryLifecycle,
  type ExtractedMemoryValidationResult,
  type RetrievedMemoryPackage,
} from "@novel-factory/memory";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider, type StageModelConfig } from "@novel-factory/llm";
import {
  fixRequestSchema,
  fixResponseSchema,
  type FixRequest,
  type GenerationContext,
  type VersionStage as SharedVersionStage,
} from "@novel-factory/shared";
import { PrismaService } from "../prisma.service";
import { ChaptersService } from "../chapters/chapters.service";
import {
  SHORT_CHAPTER_MAX_CHARS,
  SHORT_CHAPTER_MIN_CHARS,
  SHORT_CHAPTER_NORMALIZE_TARGET,
} from "../chapters/chapter-length";
import { detectSevereConsistencyBlock } from "../chapters/review-block";
import { OutlineService } from "../outline/outline.service";
import { CheckContinuityDto, GenerateStageDto } from "./dto";

type Stage = Exclude<SharedVersionStage, "fix"> | "fix";

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function extractNumericAnchors(text: string, limit = 24): string[] {
  const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const unique: string[] = [];
  for (const value of matches) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

function toSafeInstruction(value: string | undefined) {
  return (value ?? "").toLowerCase();
}

type StageBaseInput = {
  versionId: string;
  stage: VersionStage;
  text: string;
  numericAnchors: string[];
};

type SentenceRhythmPromptConfig = {
  allowShortSentence: boolean;
  maxSentencesPerParagraph: number | null;
  alternatingBias: "low" | "medium" | "high" | null;
  explanatorySentenceTolerance: number | null;
};

type ShowDontTellPromptConfig = {
  sensoryDetail: "low" | "medium" | "high" | null;
  actionDetail: "low" | "medium" | "high" | null;
  directEmotionTolerance: "low" | "medium" | "high" | null;
  themeStatementTolerance: "low" | "medium" | "high" | null;
};

type StylePresetPromptConfig = {
  name: string;
  targetPlatform: string | null;
  sentenceLength: string | null;
  paragraphDensity: string | null;
  expositionLimit: number | null;
  dialogueRatioMin: number | null;
  dialogueRatioMax: number | null;
  tone: string | null;
  pacing: string | null;
  bannedWords: string[];
  tabooRules: string[];
  favoredDevices: string[];
  sentenceRhythm: SentenceRhythmPromptConfig;
  showDontTellBias: ShowDontTellPromptConfig;
};

type MemoryValidationBucket = {
  extracted: number;
  confirmed: number;
  rejected: number;
  superseded: number;
};

type MemoryValidationSummary = {
  facts: MemoryValidationBucket;
  seeds: MemoryValidationBucket;
  timeline: MemoryValidationBucket;
  needs_manual_review: boolean;
  review_notes: string | null;
};

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

const MAJOR_STATUS_KEYWORDS = [
  "重伤",
  "濒死",
  "昏迷",
  "极度恐慌",
  "惊恐",
  "恐慌",
  "崩溃",
  "失控",
  "中毒",
  "虚弱",
];

const BASELINE_STATUS_KEYWORDS = ["常态", "正常", "平静", "稳定", "无异常", "健康"];
const CHAPTER_MIN_CHARS = SHORT_CHAPTER_MIN_CHARS;
const CHAPTER_MAX_CHARS = SHORT_CHAPTER_MAX_CHARS;
const ABSTRACT_TERMS_TO_WATCH = [
  "权谋",
  "代价",
  "命运",
  "未知",
  "危机",
  "阴影",
  "恐惧",
  "压迫",
  "冰冷",
  "沉默",
];
const TERM_MAX_COUNTS: Record<string, number> = {
  "代价": 2,
  "权谋": 1,
  "未知": 1,
};

function roughChapterChars(text: string) {
  return text.replace(/\s+/g, "").replace(/[#>*`~\-]/g, "").length;
}

function termCount(text: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(term, from);
    if (idx < 0) break;
    count += 1;
    from = idx + term.length;
  }
  return count;
}

function readConstraintObject(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const exact = record[key];
  if (exact && typeof exact === "object" && !Array.isArray(exact)) {
    return exact as Record<string, unknown>;
  }

  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  const alt = record[camel];
  if (alt && typeof alt === "object" && !Array.isArray(alt)) {
    return alt as Record<string, unknown>;
  }

  return null;
}

function readConstraintString(
  source: Record<string, unknown> | null,
  key: string,
  allowed?: readonly string[],
): string | null {
  if (!source) return null;
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  const value = source[key] ?? source[camel];
  if (typeof value !== "string") {
    return null;
  }
  if (allowed && !allowed.includes(value)) {
    return null;
  }
  return value;
}

function readConstraintNumber(source: Record<string, unknown> | null, key: string): number | null {
  if (!source) return null;
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  const value = source[key] ?? source[camel];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readConstraintBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  if (!source) return null;
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  const value = source[key] ?? source[camel];
  return typeof value === "boolean" ? value : null;
}

function emptyValidationBucket(): MemoryValidationBucket {
  return {
    extracted: 0,
    confirmed: 0,
    rejected: 0,
    superseded: 0,
  };
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      out.push(trimmed);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return out;
  }

  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectStrings(nested, out);
    }
  }

  return out;
}

function summarizeValidationResults(
  input: Pick<MemoryValidationSummary, "facts" | "seeds" | "timeline">,
  reasons: string[],
  existingNotes?: string | null,
): Pick<MemoryValidationSummary, "needs_manual_review" | "review_notes"> {
  const reviewParts = [];
  if (existingNotes?.trim()) {
    reviewParts.push(existingNotes.trim());
  }

  const rejectedCount = input.facts.rejected + input.seeds.rejected + input.timeline.rejected;
  const extractedCount = input.facts.extracted + input.seeds.extracted + input.timeline.extracted;

  reviewParts.push(
    [
      `facts 确认 ${input.facts.confirmed} / 驳回 ${input.facts.rejected} / 挂起 ${input.facts.extracted} / superseded ${input.facts.superseded}`,
      `seeds 确认 ${input.seeds.confirmed} / 驳回 ${input.seeds.rejected} / 挂起 ${input.seeds.extracted} / superseded ${input.seeds.superseded}`,
      `timeline 确认 ${input.timeline.confirmed} / 驳回 ${input.timeline.rejected} / 挂起 ${input.timeline.extracted} / superseded ${input.timeline.superseded}`,
    ].join("；"),
  );

  if (reasons.length > 0) {
    reviewParts.push(`validator: ${Array.from(new Set(reasons)).slice(0, 8).join(" | ")}`);
  }

  return {
    needs_manual_review: rejectedCount > 0 || extractedCount > 0,
    review_notes: reviewParts.filter(Boolean).join("\n"),
  };
}

@Injectable()
export class GenerationService {
  private provider: LlmProvider | null;
  private readonly modelConfig: StageModelConfig;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChaptersService) private readonly chaptersService: ChaptersService,
    @Inject(OutlineService) private readonly outlineService: OutlineService,
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

  private agentNameByStage(stage: Stage) {
    if (stage === "beats") return "BeatAgent";
    if (stage === "draft") return "DraftAgent";
    if (stage === "polish") return "PolishAgent";
    return "FixAgent";
  }

  private async recordAgentRun(args: {
    runId: string;
    projectId: string;
    chapterId: string;
    versionId: string;
    stage: Stage;
    model: string;
    stylePreset?: string | null;
    retrieverStrategy?: string;
    contextHash?: string;
    qualityScore?: number;
    inputPayload?: Record<string, unknown>;
    outputPayload?: Record<string, unknown>;
  }) {
    await this.prisma.agentRun.create({
      data: {
        run_id: args.runId,
        project_id: args.projectId,
        chapter_id: args.chapterId,
        version_id: args.versionId,
        agent_name: this.agentNameByStage(args.stage),
        prompt_version: "legacy:v1",
        model: args.model,
        style_preset: args.stylePreset ?? undefined,
        retriever_strategy: args.retrieverStrategy ?? "hybrid-sql-v1",
        context_hash: args.contextHash ?? undefined,
        token_usage: toJson({}),
        quality_score: args.qualityScore ?? null,
        input_payload: toJson(args.inputPayload ?? {}),
        output_payload: toJson(args.outputPayload ?? {}),
      },
    });
  }

  private normalizeStatusValue(value: unknown): string | null {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value !== "object" || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const candidates = [record.current_status, record.status, record.emotion, record.state, record.condition];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return null;
  }

  private hasKeyword(status: string, keywords: string[]) {
    return keywords.some((keyword) => status.includes(keyword));
  }

  private shouldPersistCharacterStatus(previousStatus: string | null | undefined, nextStatus: string) {
    const next = nextStatus.trim();
    const previous = previousStatus?.trim() ?? "";

    if (!next || previous === next) {
      return false;
    }

    if (this.hasKeyword(next, MAJOR_STATUS_KEYWORDS)) {
      return true;
    }

    if (!previous || this.hasKeyword(previous, BASELINE_STATUS_KEYWORDS)) {
      return this.hasKeyword(next, MAJOR_STATUS_KEYWORDS);
    }

    return false;
  }

  private contextCharactersForDepth(context: unknown): Array<{
    name: string;
    visual_anchors?: string | null;
    personality_tags?: string | null;
    current_status?: string | null;
  }> {
    if (!context || typeof context !== "object") {
      return [];
    }

    const involved = (context as Partial<GenerationContext>).involved_characters;
    if (!Array.isArray(involved)) {
      return [];
    }

    return involved
      .map((item) => {
        if (!item || typeof item !== "object" || typeof item.name !== "string") {
          return null;
        }
        return {
          name: item.name,
          visual_anchors:
            typeof item.visual_anchors === "string"
              ? item.visual_anchors
              : item.visual_anchors === null
                ? null
                : undefined,
          personality_tags:
            typeof item.personality_tags === "string"
              ? item.personality_tags
              : item.personality_tags === null
                ? null
                : undefined,
          current_status:
            typeof item.current_status === "string"
              ? item.current_status
              : item.current_status === null
                ? null
                : undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
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

  private async resolveStylePresetForProject(project: Pick<Project, "id" | "style_preset_id" | "target_platform">) {
    if (project.style_preset_id) {
      const preset = await this.prisma.stylePreset.findUnique({ where: { id: project.style_preset_id } });
      if (preset) {
        return preset;
      }
    }

    if (project.target_platform) {
      return this.prisma.stylePreset.findFirst({
        where: {
          OR: [{ name: project.target_platform }, { target_platform: project.target_platform }],
        },
        orderBy: [{ is_system: "desc" }, { name: "asc" }],
      });
    }

    return null;
  }

  private toStylePromptConfig(stylePreset: Awaited<ReturnType<GenerationService["resolveStylePresetForProject"]>>) {
    if (!stylePreset) {
      return null;
    }

    const constraints =
      stylePreset.constraints && typeof stylePreset.constraints === "object" && !Array.isArray(stylePreset.constraints)
        ? (stylePreset.constraints as Record<string, unknown>)
        : null;

    const sentenceRhythmSource = readConstraintObject(constraints, "sentence_rhythm");
    const showDontTellSource = readConstraintObject(constraints, "show_dont_tell_bias");

    return {
      name: stylePreset.name,
      targetPlatform: stylePreset.target_platform,
      sentenceLength: stylePreset.sentence_length,
      paragraphDensity: stylePreset.paragraph_density,
      expositionLimit: stylePreset.exposition_limit,
      dialogueRatioMin: stylePreset.dialogue_ratio_min,
      dialogueRatioMax: stylePreset.dialogue_ratio_max,
      tone: stylePreset.tone,
      pacing: stylePreset.pacing,
      bannedWords: stylePreset.banned_words ?? [],
      tabooRules: stylePreset.taboo_rules ?? [],
      favoredDevices: stylePreset.favored_devices ?? [],
      sentenceRhythm: {
        allowShortSentence: readConstraintBoolean(sentenceRhythmSource, "allow_short_sentence") ?? true,
        maxSentencesPerParagraph: readConstraintNumber(sentenceRhythmSource, "max_sentences_per_paragraph"),
        alternatingBias:
          (readConstraintString(sentenceRhythmSource, "alternating_bias", ["low", "medium", "high"] as const) as
            | "low"
            | "medium"
            | "high"
            | null) ?? null,
        explanatorySentenceTolerance: readConstraintNumber(
          sentenceRhythmSource,
          "explanatory_sentence_tolerance",
        ),
      },
      showDontTellBias: {
        sensoryDetail:
          (readConstraintString(showDontTellSource, "sensory_detail", ["low", "medium", "high"] as const) as
            | "low"
            | "medium"
            | "high"
            | null) ?? null,
        actionDetail:
          (readConstraintString(showDontTellSource, "action_detail", ["low", "medium", "high"] as const) as
            | "low"
            | "medium"
            | "high"
            | null) ?? null,
        directEmotionTolerance:
          (readConstraintString(showDontTellSource, "direct_emotion_tolerance", ["low", "medium", "high"] as const) as
            | "low"
            | "medium"
            | "high"
            | null) ?? null,
        themeStatementTolerance:
          (readConstraintString(showDontTellSource, "theme_statement_tolerance", ["low", "medium", "high"] as const) as
            | "low"
            | "medium"
            | "high"
            | null) ?? null,
      },
    } satisfies StylePresetPromptConfig;
  }

  private buildStyleDirectiveLines(stylePreset: StylePresetPromptConfig | null, stage: Stage) {
    const lines: string[] = [];

    if (!stylePreset) {
      return lines;
    }

    lines.push(`风格预设：${stylePreset.name}${stylePreset.targetPlatform ? ` / ${stylePreset.targetPlatform}` : ""}`);

    if (stylePreset.sentenceLength === "short") {
      lines.push("句长倾向：短句优先，但不要全篇同长度。");
    } else if (stylePreset.sentenceLength === "medium") {
      lines.push("句长倾向：中短句混排，避免平均句长过于整齐。");
    }

    if (stylePreset.paragraphDensity === "high") {
      lines.push("段落密度：多用短段，单段信息集中，不要连续长段讲解。");
    } else if (stylePreset.paragraphDensity === "medium") {
      lines.push("段落密度：以中短段为主，单段避免堆满解释。");
    } else if (stylePreset.paragraphDensity === "low") {
      lines.push("段落密度：允许留出停顿，但每段仍需有动作或信息推进。");
    }

    if (stylePreset.expositionLimit !== null) {
      lines.push(`说明性段落控制：纯交代/纯总结段落占比尽量低于 ${Math.round(stylePreset.expositionLimit * 100)}%。`);
    }

    if (stylePreset.dialogueRatioMin !== null || stylePreset.dialogueRatioMax !== null) {
      const ratioMin = stylePreset.dialogueRatioMin === null ? "0" : stylePreset.dialogueRatioMin.toFixed(2);
      const ratioMax = stylePreset.dialogueRatioMax === null ? "1" : stylePreset.dialogueRatioMax.toFixed(2);
      lines.push(`对白密度参考：正文对白占比维持在 ${ratioMin}-${ratioMax} 之间。`);
    }

    const maxSentences = stylePreset.sentenceRhythm.maxSentencesPerParagraph;
    if (maxSentences) {
      lines.push(`句段节奏：单段尽量不超过 ${maxSentences} 句。`);
    }
    if (stylePreset.sentenceRhythm.allowShortSentence) {
      lines.push("句段节奏：允许必要的极短句，给冲突和动作留顿点。");
    }
    if (stylePreset.sentenceRhythm.alternatingBias === "high") {
      lines.push("句段节奏：主动拉开长短句差异，避免每句长度都落在同一档。");
    } else if (stylePreset.sentenceRhythm.alternatingBias === "medium") {
      lines.push("句段节奏：适度穿插短句打断说明段。");
    }
    if (stylePreset.sentenceRhythm.explanatorySentenceTolerance !== null) {
      lines.push(
        `句段节奏：连续解释性句子不超过 ${stylePreset.sentenceRhythm.explanatorySentenceTolerance} 句。`,
      );
    }

    if (stylePreset.showDontTellBias.sensoryDetail === "high" || stylePreset.showDontTellBias.actionDetail === "high") {
      lines.push("展示偏好：优先可见动作、五感细节、环境反应，不要先下抽象判断。");
    }
    if (stylePreset.showDontTellBias.directEmotionTolerance === "low") {
      lines.push("展示偏好：少直接贴情绪标签，多用身体反应、停顿、对话失真来显化情绪。");
    }
    if (stylePreset.showDontTellBias.themeStatementTolerance === "low") {
      lines.push("展示偏好：压缩主题总结句，结尾不要自己解释意义。");
    }

    if (stylePreset.tabooRules.length > 0) {
      lines.push(`禁区：${stylePreset.tabooRules.join("；")}`);
    }
    if (stylePreset.favoredDevices.length > 0) {
      lines.push(`优先手法：${stylePreset.favoredDevices.join("；")}`);
    }
    if (stylePreset.bannedWords.length > 0 && stage !== "beats") {
      lines.push(`禁用套话：${stylePreset.bannedWords.slice(0, 18).join("、")}`);
    }
    if (stylePreset.tone) {
      lines.push(`语气方向：${stylePreset.tone}`);
    }
    if (stylePreset.pacing) {
      lines.push(`节奏方向：${stylePreset.pacing}`);
    }

    return lines;
  }

  private buildEditingConstraintLines(stylePreset: StylePresetPromptConfig | null) {
    const lines = [
      "减少修饰词堆砌，句式更自然，避免网络常见 AI 文风。",
      "定语控制：同一名词前连续定语尽量不超过 2 层，能拆成动作句就不要压成“XX的XX的XX”。",
      "名词和动词优先于形容词堆叠，保留最必要的一两个修饰即可。",
      "对白控制：能拆成两三句的，不要写成一整段完整说明；多用打断、反问、短命令句。",
      "禁止输出场景小标题（如 ## 场景一）。",
      "优先把抽象总结改成动作、对白、可见细节，不要机械替换近义词。",
      "环境描写连续两句后，必须接动作、对白或结果，不能长时间只写风、光、冷、气味。",
      "场景控制：关键段至少给一个器物反馈、身体反应或声响，避免只有概括没有触感。",
    ];

    if (!stylePreset) {
      return lines;
    }

    if (stylePreset.bannedWords.length > 0) {
      lines.push(`避免出现这些套话：${stylePreset.bannedWords.slice(0, 18).join("、")}`);
    }

    if (stylePreset.sentenceRhythm.maxSentencesPerParagraph) {
      lines.push(`单段尽量不超过 ${stylePreset.sentenceRhythm.maxSentencesPerParagraph} 句。`);
    }

    if (stylePreset.showDontTellBias.directEmotionTolerance === "low") {
      lines.push("删除显式心理标签，改用动作、停顿、环境反应承载情绪。");
    }

    return lines;
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
          status: ExtractedStatus.confirmed,
        },
        orderBy: [{ chapter_no: "desc" }],
        take: 120,
      }),
      this.prisma.seed.findMany({
        where: {
          project_id: chapter.project_id,
          extraction_status: ExtractedStatus.confirmed,
        },
        orderBy: [{ planted_chapter_no: "desc" }],
        take: 120,
      }),
      this.prisma.timelineEvent.findMany({
        where: {
          project_id: chapter.project_id,
          status: ExtractedStatus.confirmed,
        },
        orderBy: [{ chapter_no_ref: "desc" }],
        take: 120,
      }),
    ]);

    const confirmedFacts = facts.filter((fact) => isRetrievableMemoryStatus(fact.status));
    const confirmedSeeds = seeds.filter((seed) => isRetrievableMemoryStatus(seed.extraction_status));
    const confirmedTimeline = timeline.filter((event) => isRetrievableMemoryStatus(event.status));

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
        ...character,
        snapshot: stateSnapshot[character.id] ?? {},
        currentStatus:
          deriveCurrentStatusFromStateSnapshot(stateSnapshot[character.id] ?? {}) ?? character.current_status,
        snapshotText: flattenCharacterStateSnapshot(stateSnapshot[character.id] ?? {}).join(" "),
      }))
      .map(({ snapshot, currentStatus, snapshotText, ...character }) => ({
        id: character.id,
        data: {
          id: character.id,
          name: character.name,
          visual_anchors: character.visual_anchors,
          personality_tags: character.personality_tags,
          current_status: currentStatus,
          state_snapshot: snapshot,
          key_traits: [character.personality, character.personality_tags, character.motivation]
            .filter(Boolean)
            .map((item) => String(item)),
        },
        rank: 0,
        score: scoreByMatch({
          text: `${character.name} ${character.personality ?? ""} ${character.personality_tags ?? ""} ${character.visual_anchors ?? ""} ${currentStatus ?? ""} ${character.motivation ?? ""} ${snapshotText}`,
          queryEntities: resolvedEntities,
          recencyDelta: 0,
          typeWeight: 10,
        }),
        source_table: "characters",
        source_id: character.id,
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

    const factsItems = confirmedFacts
      .map((fact) => ({
        id: fact.id,
        data: {
          fact_id: fact.id,
          content: fact.content,
          chapter_no: fact.chapter_no,
          known_by_character_ids: fact.known_by_character_ids,
          extraction_status: fact.status,
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

    const seedItems = confirmedSeeds
      .map((seed) => ({
        id: seed.id,
        data: {
          seed_id: seed.id,
          content: seed.content,
          status: seed.status,
          planted_chapter_no: seed.planted_chapter_no,
          extraction_status: seed.extraction_status,
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

    const timelineItems = confirmedTimeline
      .map((event) => ({
        id: event.id,
        data: {
          event_id: event.id,
          time_mark: event.time_mark,
          event: event.event,
          chapter_no_ref: event.chapter_no_ref,
          extraction_status: event.status,
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

  private async resolveBaseInput(chapterId: string, stage: Exclude<Stage, "fix">): Promise<StageBaseInput | null> {
    if (stage === "beats") {
      return null;
    }

    let baseVersion: ChapterVersion | null = null;

    if (stage === "draft") {
      baseVersion = await this.prisma.chapterVersion.findFirst({
        where: {
          chapter_id: chapterId,
          stage: VersionStage.beats,
        },
        orderBy: { version_no: "desc" },
      });
    } else if (stage === "polish") {
      baseVersion = await this.prisma.chapterVersion.findFirst({
        where: {
          chapter_id: chapterId,
          stage: {
            in: [VersionStage.draft, VersionStage.fix, VersionStage.polish],
          },
        },
        orderBy: { version_no: "desc" },
      });
    }

    if (!baseVersion) {
      baseVersion = await this.prisma.chapterVersion.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
      });
    }

    if (!baseVersion) {
      return null;
    }

    return {
      versionId: baseVersion.id,
      stage: baseVersion.stage,
      text: baseVersion.text,
      numericAnchors: extractNumericAnchors(baseVersion.text),
    };
  }

  private buildGenerationPrompt(
    stage: Stage,
    chapter: Chapter,
    context: unknown,
    instruction?: string,
    baseInput?: StageBaseInput | null,
    stylePreset?: StylePresetPromptConfig | null,
    outlineGuardrail?: { payload: Record<string, unknown>; lines: string[] } | null,
  ) {
    const stageIntent: Record<Stage, string> = {
      beats: "输出场景骨架，每个场景都要明确冲突与转折",
      draft: "基于场景骨架扩写为章节初稿，保持人物信息边界与术语一致，章节字数控制在 2600-3400 字，优先贴近 3000 字",
      polish: "基于已有正文润色语言节奏，不改动关键事实和数字锚点，章节字数控制在 2600-3400 字，优先贴近 3000 字",
      fix: "按修复目标重写指定范围文本，保证上下文衔接",
    };

    const depthConstraint =
      stage === "beats" || stage === "draft"
        ? injectCharacterDepth(this.contextCharactersForDepth(context))
        : "";

    const systemLines = [
      "你是中文小说创作引擎。",
      "必须遵守 GenerationContext 中的约束、术语、时间线和人物状态。",
      "不得凭空引入未在 context 中出现的关键设定。",
    ];
    if (outlineGuardrail?.lines.length) {
      systemLines.push("必须优先服从 OutlineConstraints 中的主线、阶段、章节与 beats 约束；若与自由发挥冲突，以 OutlineConstraints 为准。");
    }
    if (depthConstraint) {
      systemLines.push(depthConstraint);
    }
    if (stage === "draft" || stage === "polish" || stage === "fix") {
      systemLines.push("语言风格：减少堆叠修饰词和空泛形容，优先动作、对白、具体细节。");
      systemLines.push("定语控制：同一名词前连续定语尽量不超过 2 层；能拆成动词句或短句，就不要写成长定语链。");
      systemLines.push("描写控制：环境与器物描写只保留推动冲突、交代时代或制造压力所必需的部分。");
      systemLines.push("对白控制：少整段说明，多截句、反问、命令句；同一人物不要连续讲太满。");
      systemLines.push("场景控制：每个关键段尽量给出声响、光影、器物、触感中的至少一项，让动作落地。");
      systemLines.push("短章节奏：单章只推进一个核心单元，优先完成一个钩子、一次任务推进和一个明确尾钩，不要把多个大事件硬塞进同一章。");
      systemLines.push("避免高频 AI 味表达：避免连续使用“仿佛/宛如/骤然/蓦地/极其/非常/无比”等副词形容词堆叠。");
      systemLines.push("段落控制：单段尽量不超过 4 句，避免同义反复和句式复读。");
      systemLines.push("禁止元叙述：不得出现“故事基调是…/本章主题是…/读者看到…”这类跳出故事的句子。");
    }
    const styleDirectiveLines = this.buildStyleDirectiveLines(stylePreset ?? null, stage);
    if (styleDirectiveLines.length > 0) {
      systemLines.push(`StylePreset 约束：\n${styleDirectiveLines.map((line) => `- ${line}`).join("\n")}`);
    }
    if (stage === "draft" && baseInput?.text) {
      systemLines.push("draft 阶段：必须承接 BaseText 中已有骨架与场景顺序，不得跳过关键场景。");
      systemLines.push(`目标字数：${CHAPTER_MIN_CHARS}-${CHAPTER_MAX_CHARS} 字（汉字近似计数），优先贴近 ${SHORT_CHAPTER_NORMALIZE_TARGET} 字。`);
    }
    if (stage === "polish" && baseInput?.text) {
      systemLines.push("polish 阶段：只做表达优化，不得重写剧情，不得改动人物关系与事件顺序。");
      systemLines.push("polish 阶段：数字、时间、年龄、金额、数量、章回编号必须保持与 BaseText 一致。");
      systemLines.push(`目标字数：${CHAPTER_MIN_CHARS}-${CHAPTER_MAX_CHARS} 字（汉字近似计数），优先贴近 ${SHORT_CHAPTER_NORMALIZE_TARGET} 字。`);
    }

    const baseLines: string[] = [];
    if (baseInput?.text) {
      baseLines.push(
        `BaseText(version_id=${baseInput.versionId}, stage=${baseInput.stage}):`,
        baseInput.text,
      );
      if (baseInput.numericAnchors.length > 0 && (stage === "draft" || stage === "polish")) {
        baseLines.push(
          `数字锚点（默认不得改动）: ${baseInput.numericAnchors.join("、")}`,
        );
      }
    }

    return {
      system: systemLines.join("\n\n"),
      user: [
        `任务阶段: ${stage}`,
        `阶段目标: ${stageIntent[stage]}`,
        `章节信息: no=${chapter.chapter_no}, title=${chapter.title ?? "未命名"}`,
        instruction ? `额外指令: ${instruction}` : "",
        outlineGuardrail?.lines.length ? `OutlineConstraints(JSON):\n${JSON.stringify(outlineGuardrail.payload, null, 2)}` : "",
        ...baseLines,
        "GenerationContext(JSON):",
        JSON.stringify(context, null, 2),
        "请只输出最终文本，不要输出解释。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }

  private async generateText(
    stage: Stage,
    chapter: Chapter,
    context: unknown,
    instruction?: string,
    baseInput?: StageBaseInput | null,
    stylePreset?: StylePresetPromptConfig | null,
    outlineGuardrail?: { payload: Record<string, unknown>; lines: string[] } | null,
  ) {
    const prompt = this.buildGenerationPrompt(stage, chapter, context, instruction, baseInput, stylePreset, outlineGuardrail);

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

    const configuredBeatsTimeout = Number.parseInt(process.env.LLM_TIMEOUT_BEATS_MS ?? "", 10);
    const configuredDraftTimeout = Number.parseInt(process.env.LLM_TIMEOUT_DRAFT_MS ?? "", 10);
    const configuredPolishTimeout = Number.parseInt(process.env.LLM_TIMEOUT_POLISH_MS ?? "", 10);
    const configuredFixTimeout = Number.parseInt(process.env.LLM_TIMEOUT_FIX_MS ?? "", 10);
    const beatsTimeoutMs =
      Number.isFinite(configuredBeatsTimeout) && configuredBeatsTimeout > 0 ? configuredBeatsTimeout : 240_000;
    const draftTimeoutMs =
      Number.isFinite(configuredDraftTimeout) && configuredDraftTimeout > 0 ? configuredDraftTimeout : 300_000;
    const polishTimeoutMs =
      Number.isFinite(configuredPolishTimeout) && configuredPolishTimeout > 0 ? configuredPolishTimeout : 480_000;
    const fixTimeoutMs = Number.isFinite(configuredFixTimeout) && configuredFixTimeout > 0 ? configuredFixTimeout : 420_000;

    const timeoutMs =
      stage === "beats"
        ? beatsTimeoutMs
        : stage === "draft"
          ? draftTimeoutMs
          : stage === "polish"
            ? polishTimeoutMs
            : fixTimeoutMs;

    const result = await this.provider.generateText({
      system: prompt.system,
      user: prompt.user,
      model,
      temperature: stage === "polish" ? 0.8 : 0.6,
      maxTokens: 3000,
      timeoutMs,
    });

    return result.text;
  }

  private async normalizeDraftPolishLengthAndStyle(args: {
    stage: Exclude<Stage, "fix" | "beats">;
    chapter: Chapter;
    text: string;
    stylePreset?: StylePresetPromptConfig | null;
  }) {
    const charCount = roughChapterChars(args.text);
    if (charCount >= CHAPTER_MIN_CHARS && charCount <= CHAPTER_MAX_CHARS) {
      return args.text;
    }
    if (!this.provider) {
      return args.text;
    }

    const target = SHORT_CHAPTER_NORMALIZE_TARGET;
    const direction = charCount < CHAPTER_MIN_CHARS ? "扩写" : "压缩";
    const configuredPolishTimeout = Number.parseInt(process.env.LLM_TIMEOUT_POLISH_MS ?? "", 10);
    const polishTimeoutMs =
      Number.isFinite(configuredPolishTimeout) && configuredPolishTimeout > 0 ? configuredPolishTimeout : 480_000;

    const result = await this.provider.generateText({
      model: this.modelConfig.polish,
      system: "你是小说文本编辑器。输出连续正文，不要解释。",
      user: [
        `请对以下章节进行${direction}，目标约 ${target} 字，允许范围 ${CHAPTER_MIN_CHARS}-${CHAPTER_MAX_CHARS} 字，优先贴近 ${SHORT_CHAPTER_NORMALIZE_TARGET} 字。`,
        "必须保持剧情事实、人物关系、时间线、数字信息一致。",
        ...this.buildEditingConstraintLines(args.stylePreset ?? null),
        "",
        args.text,
      ].join("\n"),
      temperature: 0.4,
      maxTokens: 3500,
      timeoutMs: polishTimeoutMs,
    });

    return result.text;
  }

  private detectOverusedAbstractTerms(text: string) {
    return ABSTRACT_TERMS_TO_WATCH.map((term) => ({
      term,
      count: termCount(text, term),
      max: TERM_MAX_COUNTS[term] ?? 3,
    }))
      .filter((item) => item.count > item.max)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  private async normalizeLexicalRepetition(args: {
    text: string;
    overused: Array<{ term: string; count: number; max: number }>;
    stylePreset?: StylePresetPromptConfig | null;
  }) {
    if (!this.provider || args.overused.length === 0) {
      return args.text;
    }

    const configuredPolishTimeout = Number.parseInt(process.env.LLM_TIMEOUT_POLISH_MS ?? "", 10);
    const polishTimeoutMs =
      Number.isFinite(configuredPolishTimeout) && configuredPolishTimeout > 0 ? configuredPolishTimeout : 480_000;

    const result = await this.provider.generateText({
      model: this.modelConfig.polish,
      system: "你是小说文本编辑器。输出连续正文，不要解释。",
      user: [
        "请只做“降重复词”编辑：在不改变剧情事实、人物关系、时间线、数字信息的前提下，减少高频抽象词重复。",
        "禁止出现元叙述句（如：故事基调是…）。",
        ...this.buildEditingConstraintLines(args.stylePreset ?? null),
        `需降频词与上限：${args.overused.map((item) => `${item.term}(${item.count}-><=${item.max})`).join("、")}`,
        "",
        args.text,
      ].join("\n"),
      temperature: 0.3,
      maxTokens: 3500,
      timeoutMs: polishTimeoutMs,
    });

    return result.text;
  }

  private shouldRunRepetitionFixLoop(request: FixRequest) {
    const strategy = (request.strategy_id ?? "").toLowerCase();
    const instruction = toSafeInstruction(request.instruction);
    return strategy.includes("reduce-word-repetition") || instruction.includes("降重复词");
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
          "从正文中抽取 summary, scene_list, facts_added, seeds_added, timeline_events_added, character_state_snapshot, character_status_updates, state_change_events。",
          "facts_added 只保留后续章节需要记住的稳定事实：身份、时间、地点、数量、决定、发现、关系变化、关键线索、物品得失、伤病与状态变化。",
          "不要把以下内容放进 facts_added：章节标题、Markdown 标记、场景标签、提纲字段、氛围描写、单纯动作特写、残句、半句对白、口号、比喻句、纯环境描写。",
          "如果一句话只是描写光线、气味、脚步声、风雨、表情或镜头感，但没有形成可持续约束的事实，不要抽。",
          "character_status_updates 字段用于记录角色状态重大变化，元素结构为 {character_id?, character_name?, from_status?, to_status, source_span?}。",
          "state_change_events 字段用于记录关键状态传播，元素结构为 {character_id?, character_name?, category, action, value, from_value?, seed_id?, seed_content?, source_span?}。",
          "category 只允许 inventory/condition/ability/identity/allegiance/seed；action 只允许 add/remove/set/paid_off。",
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

  private async maybeBlockForContinuity(args: {
    chapter: Chapter;
    version: ChapterVersion;
    report: ReturnType<typeof runContinuityCheck>;
    reportId?: string;
  }) {
    const blocked = detectSevereConsistencyBlock(args.report);
    if (!blocked) {
      return null;
    }

    return this.chaptersService.blockChapterReview({
      chapterId: args.chapter.id,
      reason: blocked.reason,
      source: blocked.source,
      details: blocked.details,
      versionId: args.version.id,
      reportId: args.reportId ?? null,
    });
  }

  private shouldGuardNumericFix(request: FixRequest) {
    const strategy = (request.strategy_id ?? "").toLowerCase();
    const instruction = toSafeInstruction(request.instruction);
    return strategy.includes("numeric-consistency") || instruction.includes("numeric-consistency");
  }

  private assertNumericFixStability(baseText: string, newText: string) {
    const baseLen = Math.max(baseText.length, 1);
    const newLen = newText.length;
    const ratio = newLen / baseLen;
    if (ratio < 0.85 || ratio > 1.15) {
      throw new UnprocessableEntityException("NUMERIC_FIX_TOO_AGGRESSIVE");
    }

    const anchors = extractNumericAnchors(baseText, 40);
    if (anchors.length === 0) return;
    const missing = anchors.filter((anchor) => !newText.includes(anchor));
    // 允许少量锚点被合法清理，超过 20% 视为过度重写。
    if (missing.length > Math.max(1, Math.floor(anchors.length * 0.2))) {
      throw new UnprocessableEntityException("NUMERIC_ANCHOR_DROPPED");
    }
  }

  private async applyCharacterStatusUpdates(args: {
    chapter: Chapter;
    version: ChapterVersion;
    extracted: ReturnType<typeof fallbackExtractMemory>;
    mergedStateSnapshot: Record<string, unknown>;
    characters: Array<{ id: string; name: string; current_status: string | null }>;
  }) {
    const { chapter, version, extracted, mergedStateSnapshot, characters } = args;
    const updates = characters
      .map((character) => {
        const status = deriveCurrentStatusFromStateSnapshot(mergedStateSnapshot[character.id]);
        if (!status) return null;
        if (!this.shouldPersistCharacterStatus(character.current_status, status)) return null;
        return {
          id: character.id,
          name: character.name,
          status,
        };
      })
      .filter((item): item is { id: string; name: string; status: string } => item !== null);

    const payoffCandidates = (extracted.state_change_events ?? []).filter(
      (event) => event.category === "seed" && event.action === "paid_off",
    );
    const existingSeeds =
      payoffCandidates.length > 0
        ? await this.prisma.seed.findMany({
            where: {
              project_id: chapter.project_id,
              status: { in: ["planted", "in_progress"] },
              extraction_status: ExtractedStatus.confirmed,
            },
            select: { id: true, content: true, fingerprint: true },
          })
        : [];

    await this.prisma.$transaction(async (tx) => {
      if (updates.length > 0) {
        await Promise.all(
          updates.map((update) =>
            tx.character.update({
              where: { id: update.id },
              data: { current_status: update.status },
            }),
          ),
        );

        await tx.timelineEvent.createMany({
          data: updates.map((update) => ({
            project_id: chapter.project_id,
            time_mark: `第${chapter.chapter_no}章`,
            event: `角色状态变化：${update.name} -> ${update.status}`,
            involved_entities: { character_ids: [update.id] } as Prisma.InputJsonObject,
            chapter_no_ref: chapter.chapter_no,
            source_version_id: version.id,
            fingerprint: normalizedContentHash(`status_update|${update.id}|${update.status}`),
            status: ExtractedStatus.extracted,
          })),
          skipDuplicates: true,
        });
      }

      for (const event of payoffCandidates) {
        const match = existingSeeds.find((seed) => {
          if (event.seed_id && seed.id === event.seed_id) {
            return true;
          }
          const targetHash = normalizedContentHash(event.seed_content ?? event.value);
          return seed.fingerprint === targetHash;
        });
        if (!match) {
          continue;
        }
        await tx.seed.update({
          where: { id: match.id },
          data: {
            status: "paid_off",
            payoff_method: `state_sync_chapter_${chapter.chapter_no}`,
          },
        });
      }
    });
  }

  private async saveExtractedMemory(args: {
    chapter: Chapter;
    version: ChapterVersion;
    extracted: ReturnType<typeof fallbackExtractMemory>;
  }) {
    const { chapter, version, extracted } = args;
    const [characters, previousMemory] = await Promise.all([
      this.prisma.character.findMany({
        where: { project_id: chapter.project_id },
        select: { id: true, name: true, current_status: true },
      }),
      this.prisma.chapterMemory.findFirst({
        where: {
          chapter: {
            project_id: chapter.project_id,
            chapter_no: { lt: chapter.chapter_no },
          },
        },
        orderBy: { created_at: "desc" },
      }),
    ]);

    const mergedStateSnapshot = buildMergedCharacterStateSnapshot({
      previousSnapshot: (previousMemory?.character_state_snapshot as Record<string, unknown> | null) ?? undefined,
      characters,
      rawSnapshot: extracted.character_state_snapshot,
      characterStatusUpdates: extracted.character_status_updates,
      stateChangeEvents: extracted.state_change_events,
      chapterNo: chapter.chapter_no,
      versionId: version.id,
    });

    await this.prisma.chapterMemory.create({
      data: {
        chapter_id: chapter.id,
        extracted_from_version_id: version.id,
        summary: extracted.summary,
        scene_list: toJson(extracted.scene_list),
        character_state_snapshot: toJson(mergedStateSnapshot),
        needs_manual_review: extracted.needs_manual_review,
        review_notes: extracted.review_notes,
      },
    });

    const sanitizedFacts = sanitizeExtractedFacts(extracted.facts_added);

    if (sanitizedFacts.length > 0) {
      await this.prisma.fact.createMany({
        data: sanitizedFacts.map((fact) => ({
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
          status: ExtractedStatus.extracted,
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
          extraction_status: ExtractedStatus.extracted,
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
          status: ExtractedStatus.extracted,
        })),
        skipDuplicates: true,
      });
    }

    await this.applyCharacterStatusUpdates({
      chapter,
      version,
      extracted,
      mergedStateSnapshot,
      characters,
    });
  }

  private updateValidationBucket(
    bucket: MemoryValidationBucket,
    status: ExtractedMemoryValidationResult["status"],
  ) {
    bucket[status] += 1;
  }

  private async validateExtractedMemoryLifecycleForVersion(args: {
    chapter: Chapter;
    version: ChapterVersion;
  }): Promise<MemoryValidationSummary> {
    const [versionFacts, versionSeeds, versionTimeline, confirmedFacts, confirmedSeeds, confirmedTimeline, characters, bibleRules, latestBlueprint, previousMemory, chapterMemory] =
      await Promise.all([
        this.prisma.fact.findMany({
          where: {
            source_version_id: args.version.id,
            status: ExtractedStatus.extracted,
          },
          orderBy: { chapter_no: "asc" },
        }),
        this.prisma.seed.findMany({
          where: {
            source_version_id: args.version.id,
            extraction_status: ExtractedStatus.extracted,
          },
          orderBy: { planted_chapter_no: "asc" },
        }),
        this.prisma.timelineEvent.findMany({
          where: {
            source_version_id: args.version.id,
            status: ExtractedStatus.extracted,
          },
          orderBy: { chapter_no_ref: "asc" },
        }),
        this.prisma.fact.findMany({
          where: {
            project_id: args.chapter.project_id,
            status: ExtractedStatus.confirmed,
            source_version_id: { not: args.version.id },
          },
          orderBy: { chapter_no: "desc" },
          take: 200,
        }),
        this.prisma.seed.findMany({
          where: {
            project_id: args.chapter.project_id,
            extraction_status: ExtractedStatus.confirmed,
            source_version_id: { not: args.version.id },
          },
          orderBy: { planted_chapter_no: "desc" },
          take: 200,
        }),
        this.prisma.timelineEvent.findMany({
          where: {
            project_id: args.chapter.project_id,
            status: ExtractedStatus.confirmed,
            source_version_id: { not: args.version.id },
          },
          orderBy: { chapter_no_ref: "desc" },
          take: 200,
        }),
        this.prisma.character.findMany({
          where: { project_id: args.chapter.project_id },
          select: { id: true, name: true, current_status: true },
        }),
        this.prisma.bibleEntity.findMany({
          where: { project_id: args.chapter.project_id, type: { in: ["rule", "ability"] } },
          orderBy: { first_appearance_chapter_no: "asc" },
        }),
        this.prisma.storyBlueprint.findFirst({
          where: { project_id: args.chapter.project_id },
          orderBy: { version_no: "desc" },
        }),
        this.prisma.chapterMemory.findFirst({
          where: {
            chapter: {
              project_id: args.chapter.project_id,
              chapter_no: { lt: args.chapter.chapter_no },
            },
          },
          include: { chapter: true },
          orderBy: { created_at: "desc" },
        }),
        this.prisma.chapterMemory.findFirst({
          where: {
            chapter_id: args.chapter.id,
            extracted_from_version_id: args.version.id,
          },
          orderBy: { created_at: "desc" },
        }),
      ]);

    const summary: MemoryValidationSummary = {
      facts: emptyValidationBucket(),
      seeds: emptyValidationBucket(),
      timeline: emptyValidationBucket(),
      needs_manual_review: chapterMemory?.needs_manual_review ?? false,
      review_notes: chapterMemory?.review_notes ?? null,
    };

    if (versionFacts.length === 0 && versionSeeds.length === 0 && versionTimeline.length === 0) {
      return summary;
    }

    const worldRules = [
      ...bibleRules.map((entity) => [entity.name, entity.constraints ?? entity.description ?? ""].filter(Boolean).join("：")),
      ...collectStrings(latestBlueprint?.world_rule_map),
    ].filter(Boolean);

    const results = validateExtractedMemoryLifecycle({
      candidates: [
        ...versionFacts.map((fact) => ({
          id: fact.id,
          kind: "fact" as const,
          content: fact.content,
          chapter_no: fact.chapter_no,
        })),
        ...versionSeeds.map((seed) => ({
          id: seed.id,
          kind: "seed" as const,
          content: seed.content,
          chapter_no: seed.planted_chapter_no,
        })),
        ...versionTimeline.map((event) => ({
          id: event.id,
          kind: "timeline" as const,
          content: event.event,
          chapter_no: event.chapter_no_ref,
          time_mark: event.time_mark,
        })),
      ],
      world_rules: worldRules,
      confirmed_facts: confirmedFacts
        .filter((fact) => isRetrievableMemoryStatus(fact.status))
        .map((fact) => ({
          id: fact.id,
          content: fact.content,
          chapter_no: fact.chapter_no,
        })),
      confirmed_seeds: confirmedSeeds
        .filter((seed) => isRetrievableMemoryStatus(seed.extraction_status))
        .map((seed) => ({
          id: seed.id,
          content: seed.content,
          planted_chapter_no: seed.planted_chapter_no,
        })),
      confirmed_timeline: confirmedTimeline
        .filter((event) => isRetrievableMemoryStatus(event.status))
        .map((event) => ({
          id: event.id,
          time_mark: event.time_mark,
          event: event.event,
          chapter_no_ref: event.chapter_no_ref,
        })),
      characters,
      character_state_snapshot:
        ((previousMemory?.character_state_snapshot as Record<string, unknown> | null) ?? undefined) ?? undefined,
    });

    const reasons = results.flatMap((result) => result.reasons);

    await this.prisma.$transaction(async (tx) => {
      for (const result of results) {
        if (result.kind === "fact") {
          this.updateValidationBucket(summary.facts, result.status);
          await tx.fact.update({
            where: { id: result.id },
            data: { status: result.status as ExtractedStatus },
          });
          continue;
        }

        if (result.kind === "seed") {
          this.updateValidationBucket(summary.seeds, result.status);
          await tx.seed.update({
            where: { id: result.id },
            data: { extraction_status: result.status as ExtractedStatus },
          });
          continue;
        }

        this.updateValidationBucket(summary.timeline, result.status);
        await tx.timelineEvent.update({
          where: { id: result.id },
          data: { status: result.status as ExtractedStatus },
        });
      }

      const reviewState = summarizeValidationResults(summary, reasons, chapterMemory?.review_notes);
      summary.needs_manual_review = reviewState.needs_manual_review;
      summary.review_notes = reviewState.review_notes;

      if (chapterMemory) {
        await tx.chapterMemory.update({
          where: { id: chapterMemory.id },
          data: {
            needs_manual_review: reviewState.needs_manual_review,
            review_notes: reviewState.review_notes,
          },
        });
      }
    });

    return summary;
  }

  private async runAndPersistContinuity(args: {
    chapter: Chapter;
    version: ChapterVersion;
  }) {
    const [glossary, characters, facts, previousMemory] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where: { project_id: args.chapter.project_id } }),
      this.prisma.character.findMany({ where: { project_id: args.chapter.project_id } }),
      this.prisma.fact.findMany({
        where: { project_id: args.chapter.project_id, status: ExtractedStatus.confirmed },
      }),
      this.prisma.chapterMemory.findFirst({
        where: {
          chapter: {
            project_id: args.chapter.project_id,
            chapter_no: { lt: args.chapter.chapter_no },
          },
        },
        orderBy: { created_at: "desc" },
      }),
    ]);

    const confirmedFacts = facts.filter((fact) => isRetrievableMemoryStatus(fact.status));
    const priorSnapshot = (previousMemory?.character_state_snapshot ?? {}) as Record<string, unknown>;

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
        current_status: deriveCurrentStatusFromStateSnapshot(priorSnapshot[c.id]) ?? c.current_status,
        state_snapshot: (priorSnapshot[c.id] as Record<string, unknown> | null) ?? null,
      })),
      facts: confirmedFacts.map((f) => ({
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

    const memoryValidation = await this.validateExtractedMemoryLifecycleForVersion(args);

    return { report, saved, memoryValidation };
  }

  async generate(chapterId: string, stage: Exclude<Stage, "fix">, dto: GenerateStageDto, idempotencyKey?: string) {
    const idemKey = this.requireIdempotencyKey(idempotencyKey);
    const stageEnum = normalizeStage(stage);
    const reqHash = this.requestHash(stage, dto);
    const { chapter, project } = await this.resolveChapter(chapterId);
    this.chaptersService.assertAutomationAllowed(chapter, this.stageLabel(stage));

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
      const stylePreset = this.toStylePromptConfig(await this.resolveStylePresetForProject(project));
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

      const baseInput = await this.resolveBaseInput(chapter.id, stage);
      const outlineGuardrail = await this.outlineService.buildGenerationGuardrail(chapter.id).catch(() => null);
      let generatedText = await this.generateText(
        stage,
        chapter,
        assembled.context,
        dto.instruction,
        baseInput,
        stylePreset,
        outlineGuardrail,
      );
      if (stage === "draft" || stage === "polish") {
        generatedText = await this.normalizeDraftPolishLengthAndStyle({
          stage,
          chapter,
          text: generatedText,
          stylePreset,
        });
        const overused = this.detectOverusedAbstractTerms(generatedText);
        if (overused.length > 0) {
          generatedText = await this.normalizeLexicalRepetition({
            text: generatedText,
            overused,
            stylePreset,
          });
        }
      }

      const version = await this.createVersion({
        chapterId: chapter.id,
        stage,
        text: generatedText,
        parentVersionId: latestVersion?.id,
        meta: {
          source_stage: stage,
          prompt_template_version: null,
          provider: this.provider?.name ?? "mock",
          model:
            stage === "beats"
              ? this.modelConfig.beats
              : stage === "draft"
                ? this.modelConfig.draft
                : this.modelConfig.polish,
          style_preset: stylePreset?.name ?? project.target_platform ?? null,
          quality_score: null,
          manual_accepted: false,
          idempotency_key: idemKey,
          context_hash: assembled.contextHash,
          base_version_id: baseInput?.versionId ?? null,
          base_stage: baseInput?.stage ?? null,
          numeric_anchors: baseInput?.numericAnchors ?? [],
          outline_constraints: outlineGuardrail?.payload ?? null,
        },
      });

      const extracted = await this.extractMemoryText(generatedText);
      await this.saveExtractedMemory({ chapter, version, extracted });
      const continuity = await this.runAndPersistContinuity({ chapter, version });
      const blockedReview = await this.maybeBlockForContinuity({
        chapter,
        version,
        report: continuity.report,
        reportId: continuity.saved.id,
      });
      await this.recordAgentRun({
        runId: requestState.request.id,
        projectId: project.id,
        chapterId: chapter.id,
        versionId: version.id,
        stage,
        model:
          stage === "beats"
            ? this.modelConfig.beats
            : stage === "draft"
              ? this.modelConfig.draft
              : this.modelConfig.polish,
        stylePreset: stylePreset?.name ?? project.target_platform,
        retrieverStrategy: "hybrid-sql-v1",
        contextHash: assembled.contextHash,
        inputPayload: {
          instruction: dto.instruction,
          query_entities: dto.query_entities ?? [],
          k,
          idempotency_key: idemKey,
          outline_constraints: outlineGuardrail?.payload ?? null,
        },
        outputPayload: {
          version_id: version.id,
          continuity_report_id: continuity.saved.id,
        },
      });
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
        memory_validation: continuity.memoryValidation,
        continuity_report: continuity.report,
        blocked_review: blockedReview
          ? {
              status: blockedReview.status,
              reason: blockedReview.review_block_reason,
              meta: blockedReview.review_block_meta,
            }
          : null,
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
    const blockedReview = await this.maybeBlockForContinuity({
      chapter,
      version,
      report: continuity.report,
      reportId: continuity.saved.id,
    });
    return {
      version_id: version.id,
      report_id: continuity.saved.id,
      memory_validation: continuity.memoryValidation,
      continuity_report: continuity.report,
      blocked_review: blockedReview
        ? {
            status: blockedReview.status,
            reason: blockedReview.review_block_reason,
            meta: blockedReview.review_block_meta,
          }
        : null,
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

  private extractPreviewTokens(text: string, limit = 24) {
    const matches = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) ?? [];
    const unique: string[] = [];
    for (const token of matches) {
      const normalized = token.trim();
      if (!normalized || unique.includes(normalized)) {
        continue;
      }
      unique.push(normalized);
      if (unique.length >= limit) {
        break;
      }
    }
    return unique;
  }

  private inferPreviewRisk(mode: FixRequest["mode"], impactRatio: number) {
    if (mode === "rewrite_chapter") {
      return "high" as const;
    }
    if (mode === "rewrite_section") {
      return impactRatio > 0.5 ? ("high" as const) : ("medium" as const);
    }
    if (impactRatio > 0.2) {
      return "medium" as const;
    }
    return "low" as const;
  }

  private normalizeFixList(values?: string[]) {
    return Array.from(
      new Set(
        (values ?? [])
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0),
      ),
    );
  }

  private fixIntensityInstruction(intensity?: FixRequest["target_intensity"]) {
    if (intensity === "low") {
      return "改动强度：low。只改必要片段，尽量保持原句结构与段落顺序。";
    }
    if (intensity === "high") {
      return "改动强度：high。允许明显重写，但仍必须遵守保留元素和禁止改动项。";
    }
    return "改动强度：medium。允许句段级调整，但不要无故扩散改动范围。";
  }

  private buildFixConstraintLines(request: FixRequest) {
    const lines = ["以下自定义修复约束优先级高于一般润色要求。"];
    if (request.fix_goal?.trim()) {
      lines.push(`修复目标：${request.fix_goal.trim()}`);
    }

    const keepElements = this.normalizeFixList(request.keep_elements);
    if (keepElements.length > 0) {
      lines.push(`必须保留：${keepElements.join("、")}`);
    }

    const forbiddenChanges = this.normalizeFixList(request.forbidden_changes);
    if (forbiddenChanges.length > 0) {
      lines.push(`绝对禁止改动：${forbiddenChanges.join("、")}`);
    }

    lines.push(this.fixIntensityInstruction(request.target_intensity));
    return lines;
  }

  async previewFix(chapterId: string, payload: unknown) {
    const request = fixRequestSchema.parse(payload);
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
    const targetText = baseVersion.text.slice(targetSpan.from, targetSpan.to);
    const targetChars = targetText.length;
    const chapterChars = Math.max(baseVersion.text.length, 1);
    const impactRatio = Number((targetChars / chapterChars).toFixed(4));
    const riskLevel = this.inferPreviewRisk(request.mode, impactRatio);
    const tokens = this.extractPreviewTokens(targetText);

    const [characters, seeds, facts] = await Promise.all([
      this.prisma.character.findMany({
        where: { project_id: chapter.project_id },
        select: { id: true, name: true },
        take: 100,
      }),
      this.prisma.seed.findMany({
        where: { project_id: chapter.project_id },
        orderBy: { planted_chapter_no: "desc" },
        select: { id: true, content: true, status: true, planted_chapter_no: true },
        take: 120,
      }),
      this.prisma.fact.findMany({
        where: { project_id: chapter.project_id },
        orderBy: { chapter_no: "desc" },
        select: { id: true, content: true, chapter_no: true },
        take: 120,
      }),
    ]);

    const touchesToken = (content: string) => tokens.some((token) => content.includes(token));
    const touchedCharacters = characters
      .filter((character) => targetText.includes(character.name))
      .map((character) => character.name)
      .slice(0, 12);
    const touchedSeeds = seeds
      .filter((seed) => touchesToken(seed.content))
      .map((seed) => ({
        id: seed.id,
        status: seed.status,
        planted_chapter_no: seed.planted_chapter_no,
        content: seed.content.slice(0, 60),
      }))
      .slice(0, 8);
    const touchedFacts = facts
      .filter((fact) => touchesToken(fact.content))
      .map((fact) => ({
        id: fact.id,
        chapter_no: fact.chapter_no,
        content: fact.content.slice(0, 60),
      }))
      .slice(0, 8);

    const estimatedOperation =
      request.mode === "replace_span"
        ? "仅替换选定片段，正文其他部分保持不变"
        : request.mode === "rewrite_section"
          ? "重写场景级片段，可能影响该场景的对话与节奏"
          : "重写整章，改动范围最大";

    const suggestion =
      request.mode === "replace_span"
        ? "建议先执行低强度修复，修复后立即复评。"
        : request.mode === "rewrite_section"
          ? "建议锁定角色口吻与伏笔，避免场景重写扩散。"
          : "建议先备份当前版本并记录禁止改动项。";

    return {
      preview_id: randomUUID(),
      chapter_id: chapter.id,
      base_version_id: baseVersion.id,
      mode: request.mode,
      target_span: targetSpan,
      target_chars: targetChars,
      chapter_chars: chapterChars,
      impact_ratio: impactRatio,
      risk_level: riskLevel,
      estimated_operation: estimatedOperation,
      fix_instruction: request.instruction ?? null,
      fix_constraints: {
        fix_goal: request.fix_goal ?? null,
        keep_elements: this.normalizeFixList(request.keep_elements),
        forbidden_changes: this.normalizeFixList(request.forbidden_changes),
        target_intensity: request.target_intensity ?? null,
      },
      touched_entities: {
        characters: touchedCharacters,
        seeds: touchedSeeds,
        facts: touchedFacts,
      },
      suggestion,
    };
  }

  async fix(chapterId: string, payload: unknown, idempotencyKey?: string) {
    const idemKey = this.requireIdempotencyKey(idempotencyKey);
    const request = fixRequestSchema.parse(payload);
    const reqHash = this.requestHash("fix", request);
    const { chapter, project } = await this.resolveChapter(chapterId);
    this.chaptersService.assertAutomationAllowed(chapter, "自动修复");

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
      const stylePreset = this.toStylePromptConfig(await this.resolveStylePresetForProject(project));

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
      const outlineGuardrail = await this.outlineService.buildGenerationGuardrail(chapter.id).catch(() => null);

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
          ...this.buildFixConstraintLines(request),
          "待修复片段:",
          target,
        ]
          .filter(Boolean)
          .join("\n"),
        undefined,
        stylePreset,
        outlineGuardrail,
      );

      let newText = `${before}${replacement}${after}`;
      if (this.shouldRunRepetitionFixLoop(request)) {
        for (let i = 0; i < 2; i += 1) {
          const overused = this.detectOverusedAbstractTerms(newText);
          if (overused.length === 0) {
            break;
          }
          newText = await this.normalizeLexicalRepetition({ text: newText, overused, stylePreset });
        }
      }
      if (request.mode === "rewrite_chapter" && this.shouldGuardNumericFix(request)) {
        this.assertNumericFixStability(baseVersion.text, newText);
      }
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
          source_stage: "fix",
          prompt_template_version: null,
          model: this.modelConfig.fix,
          style_preset: stylePreset?.name ?? project.target_platform ?? null,
          quality_score: null,
          manual_accepted: false,
          mode: request.mode,
          base_version_id: baseVersion.id,
          idempotency_key: idemKey,
          strategy_id: request.strategy_id,
          issue_ids: request.issue_ids,
          instruction: request.instruction ?? null,
          fix_goal: request.fix_goal ?? null,
          keep_elements: this.normalizeFixList(request.keep_elements),
          forbidden_changes: this.normalizeFixList(request.forbidden_changes),
          target_intensity: request.target_intensity ?? null,
          outline_constraints: outlineGuardrail?.payload ?? null,
          patch,
        },
      });

      const extracted = await this.extractMemoryText(newText);
      await this.saveExtractedMemory({ chapter, version, extracted });
      const continuity = await this.runAndPersistContinuity({ chapter, version });
      const blockedReview = await this.maybeBlockForContinuity({
        chapter,
        version,
        report: continuity.report,
        reportId: continuity.saved.id,
      });
      await this.recordAgentRun({
        runId: requestState.request.id,
        projectId: project.id,
        chapterId: chapter.id,
        versionId: version.id,
        stage: "fix",
        model: this.modelConfig.fix,
        stylePreset: stylePreset?.name ?? project.target_platform,
        retrieverStrategy: "hybrid-sql-v1",
        contextHash: assembled.contextHash,
        inputPayload: {
          mode: request.mode,
          issue_ids: request.issue_ids ?? [],
          strategy_id: request.strategy_id ?? null,
          instruction: request.instruction ?? null,
          fix_goal: request.fix_goal ?? null,
          keep_elements: this.normalizeFixList(request.keep_elements),
          forbidden_changes: this.normalizeFixList(request.forbidden_changes),
          target_intensity: request.target_intensity ?? null,
          outline_constraints: outlineGuardrail?.payload ?? null,
        },
        outputPayload: {
          new_version_id: version.id,
          continuity_report_id: continuity.saved.id,
          fix_mode: request.mode,
        },
      });
      await this.markRequestSucceeded(requestState.request.id, version.id, continuity.saved.id);

      return fixResponseSchema.parse({
        new_version_id: version.id,
        new_version_no: version.version_no,
        base_version_id: baseVersion.id,
        mode: request.mode,
        target_span: targetSpan,
        patch,
        continuity_report: continuity.report,
        blocked_review: blockedReview
          ? {
              status: blockedReview.status,
              reason: blockedReview.review_block_reason,
              meta: blockedReview.review_block_meta,
            }
          : undefined,
      });
    } catch (error) {
      await this.markRequestFailed(requestState.request.id, error instanceof Error ? error.message : "fix failed");
      throw error;
    }
  }

  async updateFactStatus(chapterId: string, factId: string, status: ExtractedStatus) {
    const { chapter } = await this.resolveChapter(chapterId);
    const fact = await this.prisma.fact.findFirst({
      where: { id: factId, project_id: chapter.project_id },
      select: { id: true },
    });
    if (!fact) {
      throw new NotFoundException("Fact not found");
    }
    return this.prisma.fact.update({ where: { id: factId }, data: { status } });
  }

  async updateSeedStatus(chapterId: string, seedId: string, status: ExtractedStatus) {
    const { chapter } = await this.resolveChapter(chapterId);
    const seed = await this.prisma.seed.findFirst({
      where: { id: seedId, project_id: chapter.project_id },
      select: { id: true },
    });
    if (!seed) {
      throw new NotFoundException("Seed not found");
    }
    return this.prisma.seed.update({ where: { id: seedId }, data: { extraction_status: status } });
  }

  async updateTimelineStatus(chapterId: string, eventId: string, status: ExtractedStatus) {
    const { chapter } = await this.resolveChapter(chapterId);
    const event = await this.prisma.timelineEvent.findFirst({
      where: { id: eventId, project_id: chapter.project_id },
      select: { id: true },
    });
    if (!event) {
      throw new NotFoundException("Timeline event not found");
    }
    return this.prisma.timelineEvent.update({ where: { id: eventId }, data: { status } });
  }
}
