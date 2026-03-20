import { AuthorAdvisorService } from "./author-advisor.service";

describe("AuthorAdvisorService", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  const originalXaiApiKey = process.env.XAI_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    if (originalDeepSeekApiKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = originalDeepSeekApiKey;
    }
    if (originalXaiApiKey === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = originalXaiApiKey;
    }
    if (originalProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalProvider;
    }
  });

  it("returns fallback author advice when no LLM provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.LLM_PROVIDER = "openai";

    const prisma = {
      chapterVersion: {
        findFirst: jest.fn(),
      },
    };
    const workspaceService = {
      getWorkspace: jest.fn().mockResolvedValue({
        chapter: {
          chapter_no: 3,
        },
        latest_version: {
          id: "version-3",
        },
        latest_version_text: "正文片段",
        publish_readiness: {
          label: "建议小修",
          strongest_point: "结尾钩子最强（8.2分）",
          top_actions: ["先补强冲突升级", "再压缩解释段落"],
        },
        handoff_brief: {
          carry_over_pressure: ["上一章的代价必须立刻兑现"],
          next_opening_options: ["开篇直接承接章末代价的后果。"],
        },
        director_review: {
          hook_upgrade: "章末再留半个答案",
        },
      }),
    };

    const service = new AuthorAdvisorService(prisma as never, workspaceService as never);
    const result = await service.advise("chapter-1", {
      question: "这一章现在最该先改什么？",
      draft_text: "正文片段",
      messages: [],
    });

    expect(result.fallback).toBe(true);
    expect(result.mode).toBe("suggestion_only");
    expect(result.reply).toContain("建议小修");
    expect(result.reply).toContain("先补强冲突升级");
  });
});
