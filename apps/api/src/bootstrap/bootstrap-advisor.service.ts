import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DeepSeekProvider, OpenAiProvider, XAiProvider, type LlmProvider } from "@novel-factory/llm";
import { PrismaService } from "../prisma.service";
import { BootstrapAdviceDto } from "./dto";

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

function truncateText(value: string, maxLength = 120) {
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
    .replace(/“[^”]+”/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    text: sanitized,
    changed: sanitized !== text.trim(),
  };
}

@Injectable()
export class BootstrapAdvisorService {
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
      process.env.MODEL_BOOTSTRAP ??
      (usingDeepSeek ? "deepseek-chat" : usingXai ? "grok-3-mini-beta" : "gpt-4.1-mini");
  }

  private async resolveProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private buildFallbackAdvice(args: {
    title: string;
    logline: string;
    protagonistBrief: string;
    toneSetting: string;
    question: string;
    chapterCount: number;
  }) {
    const suggestions = uniqueStrings([
      args.logline
        ? "先检查 logline 里有没有“谁、在什么压力下、必须做什么、否则会失去什么”这 4 个要素。缺一项，开局牵引力通常就不够。"
        : "先把 logline 补成一条完整冲突句，至少要写清主角、压力、行动目标和失败代价。",
      args.protagonistBrief
        ? "主角速写里优先补“表层身份 + 隐性缺口 + 最容易被戳中的软肋”，这样第一章更容易写出抓人的反应。"
        : "主角速写别只写外形，最好补上身份、欲望和最怕失去什么。",
      args.toneSetting
        ? `当前基调是“${args.toneSetting}”，第一章建议让冲突和信息释放方式都服务这个基调，不要一开篇既想铺世界观又想塞多条支线。`
        : "先定一个主基调，再决定第一章是先打冲突、先抛谜团，还是先立角色。",
      args.chapterCount > 0
        ? "项目已经有章节了，这次更适合把向导当成“方向校正器”，不要让新 logline 和现有章节冲突。"
        : "开局最值钱的不是设定多，而是第一章能不能让读者立刻知道“这事麻烦大了”。",
    ], 4);

    return {
      mode: "suggestion_only",
      fallback: true,
      reply: [
        `先给你开局判断：《${args.title}》现在更该优先校准“核心冲突句”和“第一章钩子”。`,
        ...suggestions.map((item, index) => `${index + 1}. ${item}`),
        `最推荐的下一步：围绕“${truncateText(args.question, 40)}”先只改一处，不要同时重写 logline、主角和基调。`,
      ].join("\n"),
      quick_prompts: [
        "我的 logline 还不够抓人吗？",
        "主角速写现在最缺哪一块？",
        "这个基调适合怎样的第一章钩子？",
      ],
    };
  }

  async advise(projectId: string, dto: BootstrapAdviceDto) {
    const project = await this.resolveProject(projectId);
    const [outlineCount, chapterCount] = await Promise.all([
      this.prisma.storyOutlineNode.count({ where: { project_id: projectId } }),
      this.prisma.chapter.count({ where: { project_id: projectId } }),
    ]);

    const logline = dto.logline?.trim() ?? "";
    const protagonistBrief = dto.protagonist_brief?.trim() ?? "";
    const toneSetting = dto.tone_setting?.trim() || project.genre || "";

    if (!this.provider) {
      return this.buildFallbackAdvice({
        title: project.title,
        logline,
        protagonistBrief,
        toneSetting,
        question: dto.question,
        chapterCount,
      });
    }

    const messages = uniqueStrings(
      (dto.messages ?? [])
        .slice(-6)
        .map((message) => `${message.role === "assistant" ? "AI" : "作者"}：${message.content}`),
      6,
    );

    const system = [
      "你是 StoryOS 的故事开局向导顾问。",
      "你的任务是帮作者诊断开局思路、logline、主角速写、基调和第一章钩子。",
      "你只能提建议，不能直接代写正文、代写完整 logline、代写完整开篇段落。",
      "不要输出任何可直接粘贴进小说正文的句子、段落、对白或旁白。",
      "如果需要举例，只能描述改法和方向，不能给可直接使用的文本。",
      "回答尽量简洁，优先给判断，再给 3-5 条建议，最后给一个最推荐的下一步。",
    ].join("\n");

    const user = [
      "下面是当前故事开局向导信息：",
      JSON.stringify(
        {
          project_title: project.title,
          genre: project.genre ?? "",
          target_platform: project.target_platform ?? "",
          existing_outline_nodes: outlineCount,
          existing_chapters: chapterCount,
          logline,
          protagonist_brief: protagonistBrief,
          tone_setting: toneSetting,
        },
        null,
        2,
      ),
      messages.length > 0 ? `最近对话：\n${messages.join("\n")}` : "",
      `作者当前问题：${dto.question}`,
      "请以“只提建议、不直接代写”的方式回答。",
    ]
      .filter(Boolean)
      .join("\n\n");

    const result = await this.provider.generateText({
      model: this.model,
      system,
      user,
      temperature: 0.7,
      maxTokens: 800,
      timeoutMs: 90_000,
    });

    const sanitized = sanitizeSuggestionReply(result.text);
    if (sanitized.changed) {
      return this.buildFallbackAdvice({
        title: project.title,
        logline,
        protagonistBrief,
        toneSetting,
        question: dto.question,
        chapterCount,
      });
    }

    return {
      mode: "suggestion_only",
      fallback: false,
      model: result.model,
      reply: sanitized.text,
      quick_prompts: [
        "我的 logline 还不够抓人吗？",
        "主角速写现在最缺哪一块？",
        "这个基调适合怎样的第一章钩子？",
      ],
    };
  }
}
