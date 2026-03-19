import { ExtractedStatus } from "@prisma/client";
import { GenerationService } from "./generation.service";

describe("GenerationService retrieveMemory", () => {
  it("excludes extracted items from default retrieval context", async () => {
    const prisma = {
      bibleEntity: { findMany: jest.fn().mockResolvedValue([]) },
      glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
      chapterMemory: { findMany: jest.fn().mockResolvedValue([]) },
      character: { findMany: jest.fn().mockResolvedValue([]) },
      fact: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "fact-extracted",
            content: "未确认事实",
            chapter_no: 3,
            known_by_character_ids: [],
            status: ExtractedStatus.extracted,
            entities: {},
            source_span: null,
          },
          {
            id: "fact-confirmed",
            content: "已确认事实",
            chapter_no: 2,
            known_by_character_ids: [],
            status: ExtractedStatus.confirmed,
            entities: {},
            source_span: null,
          },
        ]),
      },
      seed: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "seed-extracted",
            content: "未确认伏笔",
            status: "planted",
            planted_chapter_no: 3,
            extraction_status: ExtractedStatus.extracted,
            related_fact_ids: [],
          },
          {
            id: "seed-confirmed",
            content: "已确认伏笔",
            status: "planted",
            planted_chapter_no: 2,
            extraction_status: ExtractedStatus.confirmed,
            related_fact_ids: [],
          },
        ]),
      },
      timelineEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "timeline-extracted",
            time_mark: "第3夜",
            event: "未确认事件",
            chapter_no_ref: 3,
            status: ExtractedStatus.extracted,
          },
          {
            id: "timeline-confirmed",
            time_mark: "第2夜",
            event: "已确认事件",
            chapter_no_ref: 2,
            status: ExtractedStatus.confirmed,
          },
        ]),
      },
      relationship: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const service = new GenerationService(
      prisma as never,
      { assertAutomationAllowed: jest.fn() } as never,
      { buildGenerationGuardrail: jest.fn().mockResolvedValue({ payload: {}, lines: [] }) } as never,
    );
    const result = await (service as any).retrieveMemory(
      {
        id: "chapter-1",
        project_id: "project-1",
        chapter_no: 4,
        title: "第四章",
        goal: null,
        conflict: null,
        twist: null,
      },
      [],
      20,
    );

    expect(result.facts.map((item: any) => item.id)).toEqual(["fact-confirmed"]);
    expect(result.seeds.map((item: any) => item.id)).toEqual(["seed-confirmed"]);
    expect(result.timeline.map((item: any) => item.id)).toEqual(["timeline-confirmed"]);
    expect(result.retrieverMeta.ids_selected).toEqual([
      "fact-confirmed",
      "seed-confirmed",
      "timeline-confirmed",
    ]);
  });

  it("injects style preset anti-ai constraints into generation prompt", () => {
    const service = new GenerationService(
      {} as never,
      { assertAutomationAllowed: jest.fn() } as never,
      { buildGenerationGuardrail: jest.fn().mockResolvedValue({ payload: {}, lines: [] }) } as never,
    );
    const stylePreset = (service as any).toStylePromptConfig({
      name: "webnovel",
      target_platform: "webnovel",
      sentence_length: "medium",
      paragraph_density: "medium",
      dialogue_ratio_min: 0.25,
      dialogue_ratio_max: 0.4,
      exposition_limit: 0.2,
      opening_hook_required: true,
      ending_hook_required: true,
      tone: "长线连载",
      pacing: "balanced",
      banned_words: ["然而", "不禁"],
      taboo_rules: ["禁止结尾软收"],
      favored_devices: ["用动作显化情绪"],
      constraints: {
        sentence_rhythm: {
          allow_short_sentence: true,
          max_sentences_per_paragraph: 4,
          alternating_bias: "high",
          explanatory_sentence_tolerance: 1,
        },
        show_dont_tell_bias: {
          sensory_detail: "high",
          action_detail: "high",
          direct_emotion_tolerance: "low",
          theme_statement_tolerance: "low",
        },
      },
    });

    const prompt = (service as any).buildGenerationPrompt(
      "draft",
      {
        id: "chapter-1",
        project_id: "project-1",
        chapter_no: 2,
        title: "第二章",
      },
      { constraints: [] },
      undefined,
      null,
      stylePreset,
    );

    expect(prompt.system).toContain("StylePreset 约束");
    expect(prompt.system).toContain("禁用套话：然而、不禁");
    expect(prompt.system).toContain("连续解释性句子不超过 1 句");
    expect(prompt.system).toContain("少直接贴情绪标签");
    expect(prompt.system).toContain("连续定语尽量不超过 2 层");
    expect(prompt.system).toContain("对白控制：少整段说明");
  });

  it("enforces short chapter range and single-unit pacing in draft prompts", () => {
    const service = new GenerationService(
      {} as never,
      { assertAutomationAllowed: jest.fn() } as never,
      { buildGenerationGuardrail: jest.fn().mockResolvedValue({ payload: {}, lines: [] }) } as never,
    );

    const prompt = (service as any).buildGenerationPrompt(
      "draft",
      {
        id: "chapter-1",
        project_id: "project-1",
        chapter_no: 1,
        title: "第一章",
      },
      { constraints: [] },
      undefined,
      {
        versionId: "version-1",
        stage: "beats",
        text: "场景一：流民冲城。\n场景二：查仓任务。",
        numericAnchors: [],
      },
      null,
      null,
    );

    expect(prompt.user).toContain("章节字数控制在 2600-3400 字，优先贴近 3000 字");
    expect(prompt.system).toContain("目标字数：2600-3400 字");
    expect(prompt.system).toContain("优先贴近 3000 字");
    expect(prompt.system).toContain("单章只推进一个核心单元");
  });

  it("blocks generate when chapter is under blocked_review", async () => {
    const prisma = {
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          chapter_no: 2,
          status: "blocked_review",
          review_block_reason: "严重时间线冲突",
          review_block_meta: null,
        }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          target_platform: "webnovel",
          style_preset_id: null,
        }),
      },
    };

    const service = new GenerationService(
      prisma as never,
      {
        assertAutomationAllowed: jest.fn(() => {
          throw new Error("当前章节处于 blocked_review");
        }),
      } as never,
      { buildGenerationGuardrail: jest.fn().mockResolvedValue({ payload: {}, lines: [] }) } as never,
    );

    await expect(
      service.generate("chapter-1", "draft", { k: 20 }, "idem-blocked"),
    ).rejects.toThrow("当前章节处于 blocked_review");
  });

  it("builds structured fix constraint lines from custom fix payload", () => {
    const service = new GenerationService(
      {} as never,
      { assertAutomationAllowed: jest.fn() } as never,
      { buildGenerationGuardrail: jest.fn().mockResolvedValue({ payload: {}, lines: [] }) } as never,
    );

    const lines = (service as any).buildFixConstraintLines({
      mode: "rewrite_chapter",
      base_version_id: "7f6c68cb-b807-4f96-b496-7564288f1f35",
      strategy_id: "custom-rewrite_chapter",
      fix_goal: "压缩解释段，强化冲突推进",
      keep_elements: ["主线冲突", "关键数字"],
      forbidden_changes: ["时间线", "人物关系"],
      target_intensity: "medium",
    });

    expect(lines).toContain("修复目标：压缩解释段，强化冲突推进");
    expect(lines).toContain("必须保留：主线冲突、关键数字");
    expect(lines).toContain("绝对禁止改动：时间线、人物关系");
    expect(lines).toContain("改动强度：medium。允许句段级调整，但不要无故扩散改动范围。");
  });
});
