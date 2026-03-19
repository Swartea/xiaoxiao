import { StoryosService } from "./storyos.service";

function makeEvaluation(overrides?: Partial<any>) {
  return {
    overall_score: 5.4,
    quality: {
      opening_hook: { score: 5.5, reason: "" },
      conflict_strength: { score: 5.8, reason: "" },
      pacing: { score: 5.2, reason: "" },
      dialogue_quality: { score: 6, reason: "" },
      dialogue_naturalness: { score: 6, reason: "" },
      character_voice: { score: 6.5, reason: "" },
      scene_vividness: { score: 5.4, reason: "" },
      exposition_control: { score: 5.7, reason: "" },
      ai_tone_risk: { score: 6.2, reason: "" },
      ending_hook: { score: 5.3, reason: "" },
      platform_fit: { score: 6, reason: "" },
    },
    continuity: {
      world_rule_conflict: [],
      timeline_conflict: [],
      relationship_conflict: [],
      character_ooc: [],
      seed_payoff_miss: [],
    },
    diagnostics: [{ issue_type: "weak_scene", severity: "medium", score: 5.4, reason: "场景弱", evidence: [], suggested_actions: [] }],
    summary: "需要继续修复",
    ...overrides,
  };
}

describe("StoryosService soft fuse", () => {
  it("blocks review after auto-fix rounds are exhausted", async () => {
    const prisma = {
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          status: "draft",
          review_block_reason: null,
          review_block_meta: null,
        }),
      },
    };

    const qualityEngine = {
      evaluateChapter: jest
        .fn()
        .mockResolvedValueOnce({
          version_id: "version-1",
          evaluation: makeEvaluation(),
          continuity_report_id: "continuity-1",
        })
        .mockResolvedValueOnce({
          version_id: "version-2",
          evaluation: makeEvaluation({ overall_score: 5.6 }),
          continuity_report_id: "continuity-2",
        })
        .mockResolvedValueOnce({
          version_id: "version-3",
          evaluation: makeEvaluation({ overall_score: 5.8 }),
          continuity_report_id: "continuity-3",
        }),
    };

    const directorAgent = {
      review: jest.fn().mockReturnValue({
        decision: "fix",
        should_regenerate: false,
        fix_plan: {
          issue_type: "weak_scene",
          fix_goal: "增强场景画面感",
          keep_elements: ["剧情主干"],
          forbidden_changes: ["改变结局"],
          target_intensity: "medium",
        },
        pacing_direction: "",
        hook_upgrade: "",
        arc_correction: "",
        summary: "建议修复",
      }),
    };

    const directorEngine = {
      persistReview: jest.fn().mockResolvedValue({ id: "review-1" }),
    };

    const fixAgent = {
      apply: jest
        .fn()
        .mockResolvedValueOnce({ task_id: "task-1", fix_result: { new_version_id: "version-2" } })
        .mockResolvedValueOnce({ task_id: "task-2", fix_result: { new_version_id: "version-3" } }),
    };

    const chaptersService = {
      assertAutomationAllowed: jest.fn(),
      blockChapterReview: jest.fn().mockResolvedValue({
        status: "blocked_review",
        review_block_reason: "自动修复已达 2 轮，仍未通过阈值 7。",
        review_block_meta: { source: "fix_exhaustion" },
      }),
    };

    const service = new StoryosService(
      prisma as never,
      {} as never,
      {} as never,
      directorAgent as never,
      fixAgent as never,
      {} as never,
      {} as never,
      qualityEngine as never,
      directorEngine as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { logAgentRun: jest.fn() } as never,
      chaptersService as never,
    );

    const result = await service.reviewChapterByDirector("chapter-1", { auto_fix: true });

    expect(chaptersService.blockChapterReview).toHaveBeenCalledWith(
      expect.objectContaining({
        chapterId: "chapter-1",
        source: "fix_exhaustion",
      }),
    );
    expect((result.blocked_review as any)?.meta?.source).toBe("fix_exhaustion");
  });
});
