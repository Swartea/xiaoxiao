import { FixEngine } from "./fix.engine";

describe("FixEngine router", () => {
  const engine = new FixEngine({} as never, {} as never);

  it("routes opening score < 6 to opening fix", () => {
    const plan = engine.routeFixStrategy({
      overall_score: 6.2,
      quality: {
        opening_hook: { score: 5.5, reason: "" },
        conflict_strength: { score: 7, reason: "" },
        pacing: { score: 7, reason: "" },
        dialogue_quality: { score: 7, reason: "" },
        dialogue_naturalness: { score: 7, reason: "" },
        character_voice: { score: 7, reason: "" },
        scene_vividness: { score: 7, reason: "" },
        exposition_control: { score: 7, reason: "" },
        ai_tone_risk: { score: 7, reason: "" },
        ending_hook: { score: 7, reason: "" },
        platform_fit: { score: 7, reason: "" },
      },
      continuity: {
        world_rule_conflict: [],
        timeline_conflict: [],
        relationship_conflict: [],
        character_ooc: [],
        seed_payoff_miss: [],
      },
      diagnostics: [],
      summary: "",
    });

    expect(plan?.issue_type).toBe("opening_hook");
  });

  it("routes continuity issues to continuity fix", () => {
    const plan = engine.routeFixStrategy({
      overall_score: 7,
      quality: {
        opening_hook: { score: 7, reason: "" },
        conflict_strength: { score: 7, reason: "" },
        pacing: { score: 7, reason: "" },
        dialogue_quality: { score: 7, reason: "" },
        dialogue_naturalness: { score: 7, reason: "" },
        character_voice: { score: 7, reason: "" },
        scene_vividness: { score: 7, reason: "" },
        exposition_control: { score: 7, reason: "" },
        ai_tone_risk: { score: 7, reason: "" },
        ending_hook: { score: 7, reason: "" },
        platform_fit: { score: 7, reason: "" },
      },
      continuity: {
        world_rule_conflict: ["规则冲突"],
        timeline_conflict: [],
        relationship_conflict: [],
        character_ooc: [],
        seed_payoff_miss: [],
      },
      diagnostics: [],
      summary: "",
    });

    expect(plan?.issue_type).toBe("continuity");
  });

  it("routes ai tone diagnostic to localized ai_tone fix", () => {
    const plan = engine.routeFixStrategy({
      overall_score: 6.4,
      quality: {
        opening_hook: { score: 7, reason: "" },
        conflict_strength: { score: 7, reason: "" },
        pacing: { score: 7, reason: "" },
        dialogue_quality: { score: 5.8, reason: "" },
        dialogue_naturalness: { score: 5.8, reason: "" },
        character_voice: { score: 7, reason: "" },
        scene_vividness: { score: 6.6, reason: "" },
        exposition_control: { score: 6.4, reason: "" },
        ai_tone_risk: { score: 4.3, reason: "" },
        ending_hook: { score: 7, reason: "" },
        platform_fit: { score: 6.5, reason: "" },
      },
      continuity: {
        world_rule_conflict: [],
        timeline_conflict: [],
        relationship_conflict: [],
        character_ooc: [],
        seed_payoff_miss: [],
      },
      diagnostics: [
        {
          issue_type: "ai_tone",
          severity: "high",
          score: 4.3,
          reason: "存在套话和对称句",
          evidence: ["命中禁词"],
          suggested_actions: ["删除显式心理标签"],
          focus_span: { from: 120, to: 260 },
        },
      ],
      summary: "",
    });

    expect(plan?.issue_type).toBe("ai_tone");
    expect(plan?.focus_span).toEqual({ from: 120, to: 260 });
    expect(plan?.rewrite_tactics).toContain("删除显式心理标签");
  });
});
