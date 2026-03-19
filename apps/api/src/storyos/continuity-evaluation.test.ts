import {
  filterBlockingEvaluationContinuityDetails,
  mapContinuityIssuesForEvaluation,
} from "./continuity-evaluation";

describe("continuity-evaluation", () => {
  it("drops knowledge_unknown issues from evaluation buckets", () => {
    const mapped = mapContinuityIssuesForEvaluation([
      { type: "knowledge_unknown", message: "事实“开门...”尚未确认知情角色" },
      { type: "knowledge_time_travel", message: "事实在未来章节才出现" },
      { type: "glossary_consistency", message: "术语应统一" },
    ]);

    expect(mapped.timeline_conflict).toEqual(["事实在未来章节才出现"]);
    expect(mapped.world_rule_conflict).toEqual(["术语应统一"]);
  });

  it("filters annotation-only continuity messages from blocking details", () => {
    const filtered = filterBlockingEvaluationContinuityDetails([
      "事实“开门...”尚未确认知情角色",
      "术语“粮案”应统一为“洛阳粮案”",
    ]);

    expect(filtered).toEqual(["术语“粮案”应统一为“洛阳粮案”"]);
  });
});
