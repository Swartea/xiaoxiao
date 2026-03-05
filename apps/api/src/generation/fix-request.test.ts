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
    });

    expect(parsed.mode).toBe("rewrite_section");
  });
});
