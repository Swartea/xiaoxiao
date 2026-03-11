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
        character_voice: { score: 7, reason: "" },
        scene_vividness: { score: 7, reason: "" },
        exposition_control: { score: 7, reason: "" },
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
        character_voice: { score: 7, reason: "" },
        scene_vividness: { score: 7, reason: "" },
        exposition_control: { score: 7, reason: "" },
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
      summary: "",
    });

    expect(plan?.issue_type).toBe("continuity");
  });
});
