import { detectSevereEvaluationContinuity } from "./review-block";

describe("detectSevereEvaluationContinuity", () => {
  it("does not block when continuity only contains knowledge annotation reminders", () => {
    const blocked = detectSevereEvaluationContinuity({
      overall_score: 6.8,
      quality: {
        opening_hook: { score: 7, reason: "" },
        conflict_strength: { score: 6, reason: "" },
        pacing: { score: 6, reason: "" },
        dialogue_quality: { score: 6, reason: "" },
        dialogue_naturalness: { score: 6, reason: "" },
        character_voice: { score: 6, reason: "" },
        scene_vividness: { score: 6, reason: "" },
        exposition_control: { score: 6, reason: "" },
        ai_tone_risk: { score: 6, reason: "" },
        ending_hook: { score: 6, reason: "" },
        platform_fit: { score: 6, reason: "" },
      },
      continuity: {
        world_rule_conflict: [],
        timeline_conflict: ["事实“开门...”尚未确认知情角色"],
        relationship_conflict: [],
        character_ooc: [],
        seed_payoff_miss: [],
      },
      diagnostics: [],
      summary: "ok",
    });

    expect(blocked).toBeNull();
  });
});
