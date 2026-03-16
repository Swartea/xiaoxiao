import { WorkspaceService } from "./workspace.service";

describe("WorkspaceService", () => {
  it("returns a StoryOS-first workspace payload for the chapter", async () => {
    const now = new Date("2026-03-15T10:00:00.000Z");
    const prisma = {
      chapter: {
        findUnique: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          chapter_no: 1,
          project: { id: "project-1" },
        }),
      },
      chapterVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-2",
          version_no: 2,
          stage: "polish",
          created_at: now,
          parent_version_id: "version-1",
          meta: {
            mode: "replace_span",
            strategy_id: "strategy-1",
            instruction: "把钩子再拉强一点",
          },
          text: "最新版本正文",
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "version-2",
            version_no: 2,
            stage: "polish",
            created_at: now,
            parent_version_id: "version-1",
            meta: {
              mode: "replace_span",
              strategy_id: "strategy-1",
              instruction: "把钩子再拉强一点",
            },
          },
          {
            id: "version-1",
            version_no: 1,
            stage: "draft",
            created_at: now,
            parent_version_id: null,
            meta: null,
          },
        ]),
      },
      generationContextSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "legacy-snapshot",
          stage: "draft",
          context_hash: "legacy-hash",
          context: {
            bible_summary: "旧流程上下文",
            constraints: ["旧约束"],
          },
        }),
      },
      consistencyReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "legacy-report",
          version_id: "version-2",
          created_at: now,
          report: {
            issues: [{ issue_id: "legacy-1", type: "timeline_conflict", message: "旧冲突" }],
            fix_strategies: ["局部替换"],
          },
        }),
      },
      chapterMemory: {
        findFirst: jest.fn().mockResolvedValue({
          id: "memory-1",
          scene_list: [],
        }),
      },
      qualityReport: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "quality-1",
            version_id: "version-2",
            overall_score: 8.4,
            opening_hook: 8,
            conflict_strength: 8,
            pacing: 8,
            dialogue_quality: 8,
            ending_hook: 9,
          },
        ]),
      },
      directorReview: {
        findFirst: jest.fn().mockResolvedValue({
          id: "director-1",
          decision: "accept",
        }),
      },
      fixTask: {
        findMany: jest.fn().mockResolvedValue([
          { id: "fix-1", issue_type: "opening_hook", status: "applied" },
        ]),
      },
      contextSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "context-1",
          stage: "polish",
          tags: ["recent_plot"],
          context_hash: "storyos-hash",
          context_brief: {
            chapter_mission: "推进主线",
            must_remember: ["A"],
            must_not_violate: ["B"],
            active_relationships: [],
            payoff_targets: [],
            danger_points: [],
          },
        }),
      },
      continuityReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "continuity-1",
          version_id: "version-2",
          created_at: now,
          overall_pass: false,
          report: {
            mapped: {},
            raw: {
              issues: [
                { issue_id: "rule-1", type: "regex_rule_hit", message: "命中规则" },
                { issue_id: "rel-1", type: "relationship_conflict", message: "关系冲突" },
              ],
              fix_strategies: ["局部替换", "场景重写", "章节重写"],
            },
          },
        }),
      },
      chapterIntent: {
        findFirst: jest.fn().mockResolvedValue({
          id: "intent-1",
          version_no: 3,
          chapter_mission: "推进主线冲突",
          advance_goal: "逼主角做选择",
          conflict_target: "把外部压力顶满",
          hook_target: "章末必须留下代价",
          pacing_direction: "提速",
          must_payoff_seed_ids: ["seed-1"],
          updated_at: now,
        }),
      },
      agentRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "run-1",
            agent_name: "PolishAgent",
            prompt_name: "polish_prompt",
            prompt_version: "v3",
            prompt_template_version_id: "prompt-version-3",
            platform_variant: "toutiao-fiction",
            style_preset: "toutiao-fiction",
            model: "gpt-4.1",
            context_hash: "ctx-123",
            created_at: now,
            input_payload: {
              prompt_input_summary: {
                instruction: "强化开头钩子",
              },
            },
            version: {
              stage: "polish",
              version_no: 2,
            },
            promptTemplateVersion: {
              promptTemplate: {
                prompt_name: "polish_prompt",
              },
            },
          },
        ]),
      },
      fact: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      seed: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      timelineEvent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const storyReferenceService = {
      getChapterReferences: jest.fn().mockResolvedValue({
        summary: {
          total: 2,
          confirmed: 1,
          inferred: 1,
          ignored: 0,
        },
        references: {
          characters: [
            {
              id: "ref-1",
              resource_type: "character",
              resource_id: "char-1",
              state: "confirmed",
              occurrence_count: 3,
              stats: { total_hits: 3 },
              resource: { name: "林舟" },
            },
          ],
          glossary: [],
          relationships: [],
          timeline: [],
          sensitive_words: [],
          regex_rules: [],
        },
      }),
    };
    const service = new WorkspaceService(prisma as never, storyReferenceService as never);

    const result = await service.getWorkspace("chapter-1");

    expect(result.latest_version_text).toBe("最新版本正文");
    expect(result.context_brief).toEqual(
      expect.objectContaining({
        context_hash: "storyos-hash",
        source: "storyos",
      }),
    );
    expect(result.latest_intent).toEqual(
      expect.objectContaining({
        id: "intent-1",
        chapter_mission: "推进主线冲突",
      }),
    );
    expect(result.publish_readiness).toEqual(
      expect.objectContaining({
        label: "建议小修",
      }),
    );
    expect(result.handoff_brief).toEqual(
      expect.objectContaining({
        next_opening_options: expect.any(Array),
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        latest_quality: expect.objectContaining({ overall_score: 8.4 }),
        continuity: expect.objectContaining({ id: "continuity-1" }),
        latest_intent: expect.objectContaining({ id: "intent-1" }),
        publish_readiness: expect.objectContaining({ label: "建议小修" }),
      }),
    );
    expect(result.diagnostics.rule_hits).toEqual([
      expect.objectContaining({ issue_id: "rule-1" }),
    ]);
    expect(result.versions[0]).toEqual(
      expect.objectContaining({
        id: "version-2",
        fix_mode: "replace_span",
        strategy_id: "strategy-1",
      }),
    );
    expect(result.resource_summary).toEqual(
      expect.objectContaining({
        total: 2,
      }),
    );
    expect(result.prompt_trace).toEqual([
      expect.objectContaining({
        stage: "polish",
        prompt_name: "polish_prompt",
        prompt_version: "v3",
        platform_variant: "toutiao-fiction",
        style_preset_name: "toutiao-fiction",
      }),
    ]);
  });
});
