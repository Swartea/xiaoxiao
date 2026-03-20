import { buildGenerationContext } from "./assembler";
import type { RetrievedMemoryPackage } from "./types";

function item<T>(id: string, data: T, source_table: string, score = 1, rank = 1) {
  return {
    id,
    data,
    score,
    rank,
    source_table,
    source_id: id,
  };
}

describe("buildGenerationContext", () => {
  it("builds context with trace map and hash", () => {
    const retrieved: RetrievedMemoryPackage = {
      bibleRules: [item("b1", { text: "规则 A" }, "bible_entities", 9)],
      glossary: [item("g1", { term: "灵核", canonical_form: "灵核" }, "glossary_terms", 8)],
      recentSummaries: [item("s1", { chapter_no: 1, summary: "第一章" }, "chapter_memory", 7)],
      characterSnapshots: [
        item("c1", { id: "c1", name: "林川", state_snapshot: { emotion: "calm" }, key_traits: ["冷静"] }, "chapter_memory", 7),
      ],
      relationshipSlice: [item("r1", { from: "林川", to: "苏岚", type: "ally", intensity: 80 }, "relationships", 6)],
      facts: [item("f1", { fact_id: "f1", content: "灵核会衰减", chapter_no: 1 }, "facts", 8)],
      seeds: [item("sd1", { seed_id: "sd1", content: "古钟异动", status: "planted", planted_chapter_no: 1 }, "seeds", 8)],
      timeline: [item("t1", { event_id: "t1", time_mark: "第1夜", event: "钟鸣", chapter_no_ref: 1 }, "timeline_events", 8)],
      sensitiveWords: [item("sw1", { term: "禁词", replacement: "替代表达", severity: "med" }, "sensitive_words", 10)],
      regexRules: [item("rr1", { name: "数字规则", pattern: "\\d{8,}", flags: "g", severity: "high" }, "regex_rules", 10)],
      referencedResources: [{ resource_type: "character", resource_id: "c1", state: "confirmed" }],
      retrieverMeta: {
        k: 50,
        query_entities: ["林川"],
        filters: {},
        ordering: ["score_desc"],
        ids_selected: ["f1"],
      },
    };

    const result = buildGenerationContext({ k: 50, retrieved });
    expect(result.context.trace_map.length).toBeGreaterThan(0);
    expect(result.contextHash).toHaveLength(64);
    expect(result.retrieverMeta.k).toBe(50);
    expect(result.context.safety_rules).toHaveLength(2);
    expect(result.context.referenced_resources).toHaveLength(1);
  });
});
