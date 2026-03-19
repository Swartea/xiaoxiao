import { fallbackExtractMemory } from "./extractor";
import { isLikelyFactNoise, sanitizeExtractedFacts } from "./fact-sanitizer";

describe("fact-sanitizer", () => {
  it("filters markdown labels and dangling quote fragments", () => {
    const sanitized = sanitizeExtractedFacts([
      { content: "# 第一章：流民冲城", confidence: 80, source_span: { from: 0, to: 8 } },
      { content: "**地点**：洛阳城东门外", confidence: 80, source_span: { from: 9, to: 20 } },
      { content: "“官仓有粮", confidence: 80, source_span: { from: 21, to: 28 } },
      { content: "晨雾还贴着夯土城墙游走", confidence: 80, source_span: { from: 29, to: 40 } },
    ]);

    expect(sanitized).toEqual([
      { content: "晨雾还贴着夯土城墙游走", confidence: 80, source_span: { from: 29, to: 40 } },
    ]);
  });

  it("deduplicates and trims fact content", () => {
    const sanitized = sanitizeExtractedFacts([
      { content: "  官仓账载五百石  ", confidence: 80, source_span: { from: 0, to: 10 } },
      { content: "官仓账载五百石", confidence: 60, source_span: { from: 11, to: 20 } },
    ]);

    expect(sanitized).toEqual([
      { content: "官仓账载五百石", confidence: 80, source_span: { from: 0, to: 10 } },
    ]);
  });

  it("sanitizes fallback extraction output", () => {
    const extracted = fallbackExtractMemory([
      "# 第一章：流民冲城",
      "",
      "**地点**：洛阳东门外",
      "",
      "晨雾还贴着夯土城墙游走。",
      "“开门！",
    ].join("\n"));

    expect(extracted.facts_added.map((item) => item.content)).toEqual([]);
  });

  it("prefers durable fact sentences over ambient description in fallback extraction", () => {
    const extracted = fallbackExtractMemory([
      "脚步声在积水中回响，清晰而压迫。",
      "账上五百石，仓中只剩两百石。",
      "空气里都是潮气和霉味。",
    ].join("\n"));

    expect(extracted.facts_added.map((item) => item.content)).toEqual(["账上五百石，仓中只剩两百石"]);
  });

  it("classifies pure punctuation as noise", () => {
    expect(isLikelyFactNoise("---")).toBe(true);
    expect(isLikelyFactNoise("”")).toBe(true);
  });

  it("filters dialogue and cognition fragments from fallback extraction", () => {
    const extracted = fallbackExtractMemory([
      "“记住，先看谁怕你开口，再决定这账怎么记。”",
      "他第一次清楚地意识到，这趟差不是来查仓，是被人往坑里领。",
      "账载五百石，仓中只剩两百石。",
    ].join("\n"));

    expect(extracted.facts_added.map((item) => item.content)).toEqual(["账载五百石，仓中只剩两百石"]);
  });
});
