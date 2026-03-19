import { isRetrievableMemoryStatus, validateExtractedMemoryLifecycle } from "./lifecycle";

describe("memory lifecycle", () => {
  it("treats only confirmed items as retrievable", () => {
    expect(isRetrievableMemoryStatus("confirmed")).toBe(true);
    expect(isRetrievableMemoryStatus("extracted")).toBe(false);
    expect(isRetrievableMemoryStatus("rejected")).toBe(false);
    expect(isRetrievableMemoryStatus("superseded")).toBe(false);
  });

  it("rejects clear conflicts and supersedes duplicates", () => {
    const results = validateExtractedMemoryLifecycle({
      candidates: [
        {
          id: "fact-1",
          kind: "fact",
          content: "林川还活着",
          chapter_no: 8,
        },
        {
          id: "fact-2",
          kind: "fact",
          content: "苏岚中毒",
          chapter_no: 8,
        },
      ],
      world_rules: [],
      confirmed_facts: [
        { id: "fact-old", content: "林川已经死亡", chapter_no: 7 },
        { id: "fact-known", content: "苏岚中毒", chapter_no: 7 },
      ],
      confirmed_seeds: [],
      confirmed_timeline: [],
      characters: [{ id: "c1", name: "林川" }, { id: "c2", name: "苏岚" }],
      character_state_snapshot: {},
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: "fact-1",
        status: "rejected",
        reasons: expect.arrayContaining(["confirmed_fact_conflict:fact-old"]),
      }),
      expect.objectContaining({
        id: "fact-2",
        status: "superseded",
        reasons: expect.arrayContaining(["duplicate_confirmed_fact:fact-known"]),
      }),
    ]);
  });
});
