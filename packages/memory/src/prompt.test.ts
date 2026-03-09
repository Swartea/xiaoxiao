import { injectCharacterDepth } from "./prompt";

describe("injectCharacterDepth", () => {
  it("returns empty string when no depth anchors", () => {
    expect(injectCharacterDepth([{ name: "林川" }])).toBe("");
  });

  it("builds prompt block for anchored characters", () => {
    const text = injectCharacterDepth([
      {
        name: "小帅",
        visual_anchors: "偏窄鹅蛋脸、薄唇",
        personality_tags: "强撑威仪、内里心虚",
        current_status: "惊恐",
      },
    ]);

    expect(text).toContain("【核心角色描写约束】");
    expect(text).toContain("角色：小帅");
    expect(text).toContain("外貌锚点：偏窄鹅蛋脸、薄唇");
    expect(text).toContain("气质底色：强撑威仪、内里心虚");
    expect(text).toContain("当前状态：惊恐");
  });
});
