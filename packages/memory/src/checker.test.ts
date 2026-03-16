import { runContinuityCheck } from "./checker";

describe("runContinuityCheck", () => {
  it("reports high when fact appears from future chapter", () => {
    const report = runContinuityCheck({
      versionId: "7f6c68cb-b807-4f96-b496-7564288f1f35",
      textHash: "abc",
      chapterNo: 2,
      text: "林川提到王城在第三章才揭示的秘钥。",
      glossary: [],
      characters: [{ id: "c1", name: "林川", age: 18, abilities: null }],
      facts: [
        {
          id: "f1",
          content: "王城在第三章才揭示的秘钥",
          chapter_no: 3,
          known_by_character_ids: ["c1"],
        },
      ],
    });

    expect(report.summary.high).toBeGreaterThanOrEqual(1);
    expect(report.issues.some((i) => i.type === "knowledge_time_travel")).toBe(true);
  });

  it("reports resource rule hits and missing confirmed references", () => {
    const report = runContinuityCheck({
      versionId: "7f6c68cb-b807-4f96-b496-7564288f1f35",
      textHash: "abc",
      chapterNo: 2,
      text: "林川说出了禁词，并且留下了 12345678 这个号码。",
      glossary: [],
      characters: [{ id: "c1", name: "林川", age: 18, abilities: null }],
      facts: [],
      sensitive_words: [{ id: "sw1", term: "禁词", replacement: "替代表达", severity: "high" }],
      regex_rules: [{ id: "rr1", name: "长数字", pattern: "\\d{8,}", flags: "g", severity: "med" }],
      confirmed_references: [{ type: "character", name: "苏岚" }],
    });

    expect(report.issues.some((i) => i.type === "sensitive_word_hit")).toBe(true);
    expect(report.issues.some((i) => i.type === "regex_rule_hit")).toBe(true);
    expect(report.issues.some((i) => i.type === "confirmed_reference_missing")).toBe(true);
  });
});
