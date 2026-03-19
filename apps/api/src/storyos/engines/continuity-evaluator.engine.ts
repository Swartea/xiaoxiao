import { Injectable } from "@nestjs/common";
import { runContinuityCheck } from "@novel-factory/memory";
import { mapContinuityIssuesForEvaluation } from "../continuity-evaluation";

@Injectable()
export class ContinuityEvaluatorEngine {
  evaluate(input: Parameters<typeof runContinuityCheck>[0]) {
    const raw = runContinuityCheck(input);
    const mapped = mapContinuityIssuesForEvaluation(
      raw.issues.map((issue) => ({ type: issue.type, message: issue.message })),
    );

    return {
      raw,
      mapped,
    };
  }
}
