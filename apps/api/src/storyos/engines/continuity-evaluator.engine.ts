import { Injectable } from "@nestjs/common";
import { runContinuityCheck } from "@novel-factory/memory";

@Injectable()
export class ContinuityEvaluatorEngine {
  evaluate(input: Parameters<typeof runContinuityCheck>[0]) {
    const raw = runContinuityCheck(input);
    const mapped = {
      world_rule_conflict: [] as string[],
      timeline_conflict: [] as string[],
      relationship_conflict: [] as string[],
      character_ooc: [] as string[],
      seed_payoff_miss: [] as string[],
    };

    for (const issue of raw.issues) {
      if (issue.type.includes("glossary") || issue.type.includes("ability")) {
        mapped.world_rule_conflict.push(issue.message);
      } else if (issue.type.includes("time") || issue.type.includes("knowledge")) {
        mapped.timeline_conflict.push(issue.message);
      } else if (issue.type.includes("relationship")) {
        mapped.relationship_conflict.push(issue.message);
      } else if (issue.type.includes("character") || issue.type.includes("ooc")) {
        mapped.character_ooc.push(issue.message);
      } else {
        mapped.seed_payoff_miss.push(issue.message);
      }
    }

    return {
      raw,
      mapped,
    };
  }
}
