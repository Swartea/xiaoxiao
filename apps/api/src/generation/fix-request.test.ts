import { fixRequestSchema } from "@novel-factory/shared";

describe("fixRequestSchema", () => {
  it("rejects replace_span without span", () => {
    expect(() =>
      fixRequestSchema.parse({
        base_version_id: "7f6c68cb-b807-4f96-b496-7564288f1f35",
        mode: "replace_span",
        instruction: "fix this",
      }),
    ).toThrow(/span is required/);
  });

  it("accepts rewrite_section with scene_index", () => {
    const parsed = fixRequestSchema.parse({
      base_version_id: "7f6c68cb-b807-4f96-b496-7564288f1f35",
      mode: "rewrite_section",
      section: { scene_index: 1 },
      strategy_id: "strategy-1",
      fix_goal: "收紧冲突表达",
      keep_elements: ["主线冲突", "关键数字"],
      forbidden_changes: ["时间线", "人物关系"],
      target_intensity: "medium",
    });

    expect(parsed.mode).toBe("rewrite_section");
    expect(parsed.fix_goal).toBe("收紧冲突表达");
    expect(parsed.keep_elements).toEqual(["主线冲突", "关键数字"]);
    expect(parsed.target_intensity).toBe("medium");
  });
});
