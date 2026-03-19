import { buildMergedCharacterStateSnapshot, normalizeCharacterStateSnapshot } from "./snapshot";

describe("buildMergedCharacterStateSnapshot", () => {
  it("merges inventory, allegiance, and paid off seeds into the latest snapshot", () => {
    const snapshot = buildMergedCharacterStateSnapshot({
      previousSnapshot: {
        c1: {
          current_status: "轻伤",
          items_owned: ["佩剑"],
          allegiance: "县衙",
        },
      },
      characters: [{ id: "c1", name: "陈安", current_status: "平静" }],
      rawSnapshot: {},
      characterStatusUpdates: [{ character_id: "c1", to_status: "受伤" }],
      stateChangeEvents: [
        { character_id: "c1", category: "inventory", action: "remove", value: "佩剑" },
        { character_id: "c1", category: "allegiance", action: "set", value: "郡府", from_value: "县衙" },
        { category: "seed", action: "paid_off", value: "古钟异动", seed_id: "s1", seed_content: "古钟异动" },
      ],
      chapterNo: 5,
      versionId: "v5",
    });

    expect(normalizeCharacterStateSnapshot(snapshot.c1)).toEqual(
      expect.objectContaining({
        current_status: "受伤",
        items_owned: [],
        items_missing: ["佩剑"],
        allegiance: "郡府",
        previous_allegiance: "县衙",
      }),
    );
    expect(snapshot.__story__).toEqual(
      expect.objectContaining({
        paid_off_seed_ids: ["s1"],
        paid_off_seed_contents: ["古钟异动"],
      }),
    );
  });
});
