export type EvaluationContinuityBuckets = {
  world_rule_conflict: string[];
  timeline_conflict: string[];
  relationship_conflict: string[];
  character_ooc: string[];
  seed_payoff_miss: string[];
};

export function createEmptyEvaluationContinuityBuckets(): EvaluationContinuityBuckets {
  return {
    world_rule_conflict: [],
    timeline_conflict: [],
    relationship_conflict: [],
    character_ooc: [],
    seed_payoff_miss: [],
  };
}

export function isAnnotationOnlyContinuityIssueType(type: string) {
  return type.trim().toLowerCase() === "knowledge_unknown";
}

export function isAnnotationOnlyContinuityMessage(message: string) {
  return message.includes("尚未确认知情角色");
}

export function mapContinuityIssuesForEvaluation(issues: Array<{ type: string; message: string }>) {
  const mapped = createEmptyEvaluationContinuityBuckets();

  for (const issue of issues) {
    if (isAnnotationOnlyContinuityIssueType(issue.type)) {
      continue;
    }

    if (issue.type.includes("glossary") || issue.type.includes("ability")) {
      mapped.world_rule_conflict.push(issue.message);
      continue;
    }
    if (issue.type.includes("time") || issue.type.includes("knowledge")) {
      mapped.timeline_conflict.push(issue.message);
      continue;
    }
    if (issue.type.includes("relationship")) {
      mapped.relationship_conflict.push(issue.message);
      continue;
    }
    if (issue.type.includes("character") || issue.type.includes("ooc")) {
      mapped.character_ooc.push(issue.message);
      continue;
    }
    mapped.seed_payoff_miss.push(issue.message);
  }

  return mapped;
}

export function filterBlockingEvaluationContinuityDetails(details: string[]) {
  return details.filter((detail) => !isAnnotationOnlyContinuityMessage(detail));
}
