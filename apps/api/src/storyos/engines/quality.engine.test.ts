import { QualityEngine } from "./quality.engine";

describe("QualityEngine Phase 3 heuristics", () => {
  it("emits ai tone and exposition diagnostics with structured scores", async () => {
    const prisma = {
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          chapter_no: 3,
        }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          style_preset_id: null,
          target_platform: "webnovel",
        }),
      },
      chapterVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          chapter_id: "chapter-1",
          version_no: 2,
          text_hash: "hash-1",
          text: [
            "然而他不禁深吸一口气，盯着那盏发暗的旧灯下那张沾灰的破旧账册，心里想着今晚的命运与危机。",
            "然而这意味着局势已经彻底改变，重要的是他必须明白，这一切本质上都说明了更深的阴影。",
            "总之，这说明他们过去的每一步其实都只是背景的一部分，原来真正的规则从未改变。",
            "换句话说，重要的是先理解设定与局势，这意味着所有人都必须接受这一层更深的解释。",
            "",
            "“其实你应该明白，因为现在的局势已经完全不同，所以我们必须立刻解释清楚所有背景，否则就会出现更加复杂的问题。”",
            "“换句话说，重要的是你先理解规则。”",
            "",
            "门轴没响，风也没动，整段都像在总结。",
            "他看向那盏发暗的旧灯下那张沾灰的破旧账册，又看向那只沾泥的旧靴。",
          ].join("\\n"),
        }),
      },
      stylePreset: {
        findFirst: jest.fn().mockResolvedValue({
          name: "webnovel",
          target_platform: "webnovel",
          sentence_length: "medium",
          paragraph_density: "medium",
          dialogue_ratio_min: 0.25,
          dialogue_ratio_max: 0.4,
          exposition_limit: 0.2,
          opening_hook_required: true,
          ending_hook_required: true,
          banned_words: ["然而", "重要的是", "不禁", "深吸一口气"],
        }),
        findUnique: jest.fn(),
      },
      glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
      character: { findMany: jest.fn().mockResolvedValue([{ id: "c-1", name: "顾川", age: 18, abilities: null }]) },
      fact: { findMany: jest.fn().mockResolvedValue([]) },
      chapterMemory: {
        findFirst: jest.fn().mockResolvedValue({
          scene_list: [
            {
              scene_index: 0,
              anchor_span: { from: 0, to: 260 },
            },
          ],
        }),
      },
    };

    const engine = new QualityEngine(prisma as never);
    const result = await engine.evaluateChapter({
      chapterId: "chapter-1",
      persist: false,
    });

    expect(result.evaluation.quality.dialogue_naturalness.score).toBeLessThan(6.5);
    expect(result.evaluation.quality.exposition_control.score).toBeLessThan(6.5);
    expect(result.evaluation.quality.ai_tone_risk.score).toBeLessThan(6.5);
    expect(
      result.evaluation.diagnostics
        .find((item) => item.issue_type === "ai_tone")
        ?.evidence.some((item) => item.includes("连续定语链")),
    ).toBe(true);
    expect(result.evaluation.diagnostics.some((item) => item.issue_type === "ai_tone")).toBe(true);
    expect(result.evaluation.diagnostics.some((item) => item.issue_type === "exposition_overload")).toBe(true);
  });
});
