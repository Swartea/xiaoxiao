import { BootstrapService } from "./bootstrap.service";

describe("BootstrapService", () => {
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

  it("returns fallback logline options when no llm provider is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.LLM_PROVIDER = "openai";

    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          title: "献祭之夜",
          genre: "暗黑修真",
          target_platform: "webnovel",
        }),
      },
    };

    const service = new BootstrapService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.generateLoglineOptions("project-1", {
      protagonist_brief: "少年外冷内烈，最怕再次被抛弃。",
      tone_setting: "暗黑修真",
    });

    expect(result.fallback).toBe(true);
    expect(result.options).toHaveLength(6);
    expect(result.options[0]).toContain("少年外冷内烈");
  });
});
