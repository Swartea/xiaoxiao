import { BootstrapAdvisorService } from "./bootstrap-advisor.service";

describe("BootstrapAdvisorService", () => {
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

  it("returns fallback bootstrap advice when no llm provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.LLM_PROVIDER = "openai";

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          title: "开局测试项目",
          genre: "权谋",
          target_platform: "webnovel",
        }),
      },
      storyOutlineNode: {
        count: jest.fn().mockResolvedValue(0),
      },
      chapter: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const service = new BootstrapAdvisorService(prisma as never);
    const result = await service.advise("project-1", {
      question: "我的 logline 还不够抓人吗？",
      logline: "少年在宗门清洗前夜发现师门真正要献祭的是自己。",
      protagonist_brief: "少年外冷内烈，最怕再次被抛弃。",
      tone_setting: "暗黑修真",
      messages: [],
    });

    expect(result.fallback).toBe(true);
    expect(result.mode).toBe("suggestion_only");
    expect(result.reply).toContain("核心冲突句");
    expect(result.quick_prompts).toEqual(expect.arrayContaining(["我的 logline 还不够抓人吗？"]));
  });
});
