import { Inject, Injectable } from "@nestjs/common";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider } from "@novel-factory/llm";
import { PrismaService } from "../prisma.service";
import { WorkspaceService } from "./workspace.service";
import type { AuthorAdviceDto } from "./dto/author-advice.dto";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function truncateText(value: string, maxLength = 160) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function sanitizeSuggestionReply(text: string) {
  const sanitized = text
    .replace(/（如[^）]*）/g, "")
    .replace(/\(如[^)]*\)/g, "")
    .replace(/例如[:：]?[^\n。！？]*[。！？]?/g, "")
    .replace(/例如[，,][^\n。！？]*[。！？]?/g, "")
    .replace(/比如[，,][^\n。！？]*[。！？]?/g, "")
    .replace(/如[，,][^\n。！？]*[。！？]?/g, "")
    .replace(/如“[^”]+”/g, "")
    .replace(/“[^”]+”/g, "")
    .replace(/“[^”]{10,}”/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (sanitized === text.trim()) {
    return sanitized;
  }

  return `${sanitized}\n\n注：已省略可直接贴进正文的示例句，仅保留方向性建议。`;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 5) {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
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
export class AuthorAdvisorService {
  private readonly provider: LlmProvider | null;
  private readonly model: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
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

    this.model =
      process.env.MODEL_CHECK ??
      (providerName === "deepseek"
        ? "deepseek-chat"
        : providerName === "xai"
          ? "grok-3-mini-beta"
          : "gpt-4.1-mini");
  }

  private buildFallbackAdvice(args: {
    chapterNo: number;
    publishReadiness: Record<string, unknown> | null;
    handoffBrief: Record<string, unknown> | null;
    director: Record<string, unknown> | null;
    question: string;
  }) {
    const publishActions = toArray<string>(args.publishReadiness?.top_actions);
    const pressure = toArray<string>(args.handoffBrief?.carry_over_pressure);
    const openingOptions = toArray<string>(args.handoffBrief?.next_opening_options);
    const statusLabel = String(args.publishReadiness?.label ?? "待评估");
    const strongestPoint = String(args.publishReadiness?.strongest_point ?? "暂无突出卖点");

    const lines = [
      `先给你作者视角结论：第 ${args.chapterNo} 章当前更接近“${statusLabel}”。`,
      `这章现在最值得保住的卖点是：${strongestPoint}。`,
      publishActions[0] ? `优先建议 1：${publishActions[0]}` : "",
      publishActions[1] ? `优先建议 2：${publishActions[1]}` : "",
      typeof args.director?.hook_upgrade === "string" ? `钩子方向：${args.director.hook_upgrade}` : "",
      pressure[0] ? `下一章最好延续的压力：${pressure[0]}` : "",
      openingOptions[0] ? `如果你现在卡住，可以从这个开篇切口起：${openingOptions[0]}` : "",
      `你刚才的问题是：“${truncateText(args.question, 80)}”。如果你愿意，我建议下一轮直接问更具体的点，比如“这章开头弱在哪里”或“下一章第一场怎么接”。`,
    ].filter(Boolean);

    return lines.join("\n");
  }

  private buildWorkspaceDigest(workspace: Record<string, unknown>, draftText: string) {
    const chapter = toRecord(workspace.chapter);
    const latestIntent = toRecord(workspace.latest_intent);
    const publishReadiness = toRecord(workspace.publish_readiness);
    const handoffBrief = toRecord(workspace.handoff_brief);
    const contextBrief = toRecord(workspace.context_brief);
    const contextPayload = toRecord(contextBrief?.context_brief);
    const director = toRecord(workspace.director_review);
    const diagnostics = toRecord(workspace.diagnostics);
    const latestQuality = toRecord(diagnostics?.latest_quality ?? workspace.quality_report);
    const continuity = toRecord(diagnostics?.continuity ?? workspace.continuity_report);
    const continuityRaw = toRecord(toRecord(continuity?.report)?.raw) ?? toRecord(continuity?.report);
    const continuityIssues = toArray<Record<string, unknown>>(continuityRaw?.issues);
    const promptTrace = toArray<Record<string, unknown>>(diagnostics?.prompt_trace ?? workspace.prompt_trace);

    return {
      chapter_no: Number(chapter?.chapter_no ?? 0),
      chapter_title: String(chapter?.title ?? ""),
      chapter_goal: String(chapter?.goal ?? ""),
      chapter_conflict: String(chapter?.conflict ?? ""),
      chapter_cliffhanger: String(chapter?.cliffhanger ?? ""),
      latest_intent: latestIntent
        ? {
            chapter_mission: String(latestIntent.chapter_mission ?? ""),
            advance_goal: String(latestIntent.advance_goal ?? ""),
            conflict_target: String(latestIntent.conflict_target ?? ""),
            hook_target: String(latestIntent.hook_target ?? ""),
            pacing_direction: String(latestIntent.pacing_direction ?? ""),
          }
        : null,
      publish_readiness: publishReadiness,
      director_review: director
        ? {
            decision: String(director.decision ?? ""),
            summary: String(director.summary ?? ""),
            pacing_direction: String(director.pacing_direction ?? ""),
            hook_upgrade: String(director.hook_upgrade ?? ""),
            arc_correction: String(director.arc_correction ?? ""),
          }
        : null,
      context_brief: contextPayload
        ? {
            chapter_mission: String(contextPayload.chapter_mission ?? ""),
            must_remember: toArray<string>(contextPayload.must_remember).slice(0, 6),
            must_not_violate: toArray<string>(contextPayload.must_not_violate).slice(0, 6),
            active_relationships: toArray<string>(contextPayload.active_relationships).slice(0, 6),
            payoff_targets: toArray<string>(contextPayload.payoff_targets).slice(0, 6),
            danger_points: toArray<string>(contextPayload.danger_points).slice(0, 6),
          }
        : null,
      handoff_brief: handoffBrief,
      quality: latestQuality
        ? {
            overall_score: Number(latestQuality.overall_score ?? 0),
            summary: String(latestQuality.summary ?? ""),
          }
        : null,
      continuity_issues: continuityIssues.slice(0, 6).map((issue) => ({
        type: String(issue.type ?? ""),
        severity: String(issue.severity ?? ""),
        message: String(issue.message ?? ""),
      })),
      current_prompt_strategy: promptTrace.slice(0, 4).map((item) => ({
        stage: String(item.stage ?? ""),
        prompt_name: String(item.prompt_name ?? ""),
        prompt_version: String(item.prompt_version ?? ""),
        platform_variant: String(item.platform_variant ?? ""),
        style_preset_name: String(item.style_preset_name ?? ""),
      })),
      draft_excerpt: truncateText(draftText.replace(/\s+/g, " ").trim(), 2000),
    };
  }

  async advise(chapterId: string, dto: AuthorAdviceDto) {
    const workspace = (await this.workspaceService.getWorkspace(chapterId)) as Record<string, unknown>;
    const chapter = toRecord(workspace.chapter);
    const versionId = dto.version_id?.trim();
    const storedText =
      versionId && versionId !== String(toRecord(workspace.latest_version)?.id ?? "")
        ? await this.prisma.chapterVersion.findFirst({
            where: { id: versionId, chapter_id: chapterId },
            select: { text: true },
          })
        : null;
    const draftText = dto.draft_text?.trim() || storedText?.text || String(workspace.latest_version_text ?? "");
    const digest = this.buildWorkspaceDigest(workspace, draftText);
    const publishReadiness = toRecord(workspace.publish_readiness);
    const handoffBrief = toRecord(workspace.handoff_brief);
    const director = toRecord(workspace.director_review);

    if (!this.provider) {
      return {
        mode: "suggestion_only",
        fallback: true,
        reply: this.buildFallbackAdvice({
          chapterNo: Number(chapter?.chapter_no ?? 0),
          publishReadiness,
          handoffBrief,
          director,
          question: dto.question,
        }),
        quick_prompts: [
          "这章开头弱在哪里？",
          "如果下一章要更抓人，第一场怎么起？",
          "当前最该优先修的 3 个问题是什么？",
        ],
      };
    }

    const messages = uniqueStrings(
      toArray<{ role: "user" | "assistant"; content: string }>(dto.messages)
        .slice(-6)
        .map((message) => `${message.role === "assistant" ? "AI" : "作者"}：${message.content}`),
      6,
    );

    const system = [
      "你是 StoryOS 的作者陪跑顾问。",
      "你的职责只有诊断、建议、拆解创作问题，不要代替作者直接改稿。",
      "禁止输出完整章节、完整场景重写、长段落润色稿。",
      "不要给任何可直接粘贴进正文的示例句、示例段或替换稿。",
      "如果你想举例，只能描述改法，不要写出具体台词、具体旁白或完整句子。",
      "如果作者要求你直接写正文，你要礼貌拒绝，并改为给 3-5 条可执行建议。",
      "回答请使用简洁中文，优先给结论，再给建议，再给下一步。",
      "尽量围绕章节目标、冲突升级、信息增量、追更钩子、人物关系推进来判断。",
    ].join("\n");

    const user = [
      "以下是当前章节工作台摘要：",
      JSON.stringify(digest, null, 2),
      messages.length > 0 ? `最近对话：\n${messages.join("\n")}` : "",
      `作者当前问题：${dto.question}`,
      "请给建议型回答，结构尽量是：1) 一句话判断 2) 3-5条建议 3) 一个最推荐的下一步。",
      "再次强调：不要提供任何可直接贴进正文的示例句，不要用“例如”写替代文本。",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await this.provider.generateText({
      system,
      user,
      model: this.model,
      temperature: 0.7,
      maxTokens: 900,
      timeoutMs: 90_000,
    });

    return {
      mode: "suggestion_only",
      fallback: false,
      model: result.model,
      reply: sanitizeSuggestionReply(result.text),
      quick_prompts: [
        "这章现在最影响追更欲的问题是什么？",
        "下一章开篇最抓人的处理方式是什么？",
        "如果只改 3 处，优先改哪里？",
      ],
    };
  }
}
