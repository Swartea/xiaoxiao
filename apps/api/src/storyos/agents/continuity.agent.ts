import { Inject, Injectable } from "@nestjs/common";
import { ContinuityEvaluatorEngine } from "../engines/continuity-evaluator.engine";

@Injectable()
export class ContinuityAgent {
  constructor(@Inject(ContinuityEvaluatorEngine) private readonly continuity: ContinuityEvaluatorEngine) {}

  evaluate(input: Parameters<ContinuityEvaluatorEngine["evaluate"]>[0]) {
    return this.continuity.evaluate(input);
  }
}
