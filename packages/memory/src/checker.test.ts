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
});
