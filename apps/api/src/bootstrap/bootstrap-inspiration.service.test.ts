import { BootstrapInspirationService } from "./bootstrap-inspiration.service";

describe("BootstrapInspirationService", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
  const originalXaiApiKey = process.env.XAI_API_KEY;
  const originalProvider = process.env.LLM_PROVIDER;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.XAI_API_KEY;
    process.env.LLM_PROVIDER = "openai";
  });

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

  function createService() {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          title: "测试项目",
          genre: "未设定",
          target_platform: "webnovel",
        }),
      },
    };

    return {
      prisma,
      service: new BootstrapInspirationService(prisma as never),
    };
  }

  it("exposes the initial inspiration taxonomy with the required counts", () => {
    const { service } = createService();
    const result = service.getTaxonomy();

    expect(result.genres).toHaveLength(5);
    for (const genre of result.genres) {
      expect(genre.sub_genres).toHaveLength(6);
      expect(genre.tropes).toHaveLength(12);
      expect(genre.story_seeds).toHaveLength(20);
      expect(genre.protagonist_templates).toHaveLength(8);
    }
  });

  it("returns curated story seed options when no llm provider is configured", async () => {
    const { service } = createService();
    const taxonomy = service.getTaxonomy();
    const historical = taxonomy.genres.find((genre) => genre.id === "historical");
    expect(historical).toBeTruthy();
    const result = await service.generateStorySeedOptions("project-1", {
      genre: "historical",
      sub_genre: historical!.sub_genres[0].id,
      tropes: [historical!.tropes[0].id, historical!.tropes[1].id],
      exclude_ids: [],
    });

    expect(result.fallback).toBe(true);
    expect(result.options).toHaveLength(6);
    expect(result.options[0].label.length).toBeGreaterThan(1);
    expect(result.options[0].setup.length).toBeGreaterThan(3);
  });

  it("generates a complete random setup with fallback options", async () => {
    const { service } = createService();
    const result = await service.generateRandomIdea("project-1");

    expect(result.setup.genre).toBeTruthy();
    expect(result.setup.sub_genre).toBeTruthy();
    expect(result.setup.tropes.length).toBeGreaterThanOrEqual(2);
    expect(result.setup.story_seed.label).toBeTruthy();
    expect(result.setup.protagonist_template.role_identity).toBeTruthy();
    expect(result.setup.selected_title).toBeTruthy();
    expect(result.setup.selected_logline).toBeTruthy();
    expect(result.setup.selected_volume_plan.chapter_missions).toHaveLength(5);
    expect(result.options.story_seeds).toHaveLength(6);
    expect(result.options.titles).toHaveLength(6);
    expect(result.options.loglines).toHaveLength(4);
  });
});
