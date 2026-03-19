import { continuityReportSchema, type ContinuityReport } from "@novel-factory/shared";
import { normalizeCharacterStateSnapshot } from "./snapshot";
import type { ContinuityCheckInput, ContinuityIssue } from "./types";

function createIssue(
  partial: Omit<ContinuityIssue, "issue_id">,
  index: number,
): ContinuityIssue {
  return {
    issue_id: `ISSUE-${index + 1}`,
    ...partial,
  };
}

function findEvidence(text: string, needle: string): { from: number; to: number; snippet: string } {
  const from = Math.max(0, text.indexOf(needle));
  const to = from + needle.length;
  const snippet = from >= 0 ? text.slice(Math.max(0, from - 20), Math.min(text.length, to + 20)) : needle;
  return { from: from < 0 ? 0 : from, to: from < 0 ? 0 : to, snippet };
}

function summarizeSeverity(issues: ContinuityIssue[]) {
  const summary = { total_issues: issues.length, high: 0, med: 0, low: 0 };
  for (const issue of issues) {
    if (issue.severity === "high") summary.high += 1;
    if (issue.severity === "med") summary.med += 1;
    if (issue.severity === "low") summary.low += 1;
  }
  return summary;
}

function includesAny(text: string, patterns: string[]) {
  return patterns.some((pattern) => text.includes(pattern));
}

function inventoryConflictPhrases(item: string) {
  return [
    `握住${item}`,
    `握紧${item}`,
    `拔出${item}`,
    `抽出${item}`,
    `佩着${item}`,
    `带着${item}`,
    `背着${item}`,
    `挥动${item}`,
  ];
}

function inventoryRecoveredPhrases(item: string) {
  return [
    `夺回${item}`,
    `取回${item}`,
    `找回${item}`,
    `捡回${item}`,
    `重新拿起${item}`,
    `重新握住${item}`,
    `重新佩上${item}`,
  ];
}

function conditionRegressionPhrases(condition: string) {
  if (includesAny(condition, ["受伤", "重伤", "伤重", "虚弱"])) {
    return ["毫发无伤", "若无其事", "全无异样", "健步如飞", "行动如常"];
  }
  if (condition.includes("中毒")) {
    return ["全无毒发", "若无其事", "面色红润", "气息平稳"];
  }
  if (condition.includes("昏迷")) {
    return ["清醒地", "立刻回答", "自如开口"];
  }
  return [];
}

function abilityRegressionPhrases(flag: string) {
  if (flag.includes("无法") || flag.includes("不能")) {
    const nouns = ["灵力", "功力", "真气", "术法", "能力"];
    const target = nouns.find((noun) => flag.includes(noun));
    if (target) {
      return [`催动${target}`, `运转${target}`, `施展${target}`, `爆发${target}`];
    }
  }
  if (flag.includes("功力尽失")) {
    return ["催动功力", "运起真气", "内力鼓荡"];
  }
  return [];
}

function allegianceConflictPhrases(previous: string) {
  return [`效忠${previous}`, `听命于${previous}`, `归属${previous}`, `仍为${previous}卖命`];
}

export function runContinuityCheck(input: ContinuityCheckInput): ContinuityReport {
  const issues: ContinuityIssue[] = [];

  for (const rule of input.glossary) {
    if (rule.term !== rule.canonical_form && input.text.includes(rule.term)) {
      const evidence = findEvidence(input.text, rule.term);
      issues.push(
        createIssue(
          {
            type: "glossary_consistency",
            severity: "low",
            message: `术语“${rule.term}”应统一为“${rule.canonical_form}”`,
            evidence: {
              version_id: input.versionId,
              text_hash: input.textHash,
              ...evidence,
            },
            suggested_fix: `将 ${rule.term} 替换为 ${rule.canonical_form}`,
          },
          issues.length,
        ),
      );
    }
  }

  for (const character of input.characters) {
    if (!character.age) continue;
    const ageRegex = new RegExp(`${character.name}.{0,6}(\\d{1,3})岁`, "g");
    const match = ageRegex.exec(input.text);
    if (match) {
      const ageInText = Number(match[1]);
      if (Number.isFinite(ageInText) && ageInText !== character.age) {
        const evidence = findEvidence(input.text, match[0]);
        issues.push(
          createIssue(
            {
              type: "character_age_consistency",
              severity: "med",
              message: `${character.name} 年龄不一致：设定 ${character.age}，正文 ${ageInText}`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: `修正为 ${character.age} 岁或在前文补充年龄变化原因`,
            },
            issues.length,
          ),
        );
      }
    }

    const abilities = character.abilities ?? {};
    const forbiddenPhrases = Array.isArray((abilities as Record<string, unknown>).forbidden_phrases)
      ? ((abilities as Record<string, unknown>).forbidden_phrases as string[])
      : [];
    for (const phrase of forbiddenPhrases) {
      if (input.text.includes(phrase)) {
        const evidence = findEvidence(input.text, phrase);
        issues.push(
          createIssue(
            {
              type: "ability_constraint",
              severity: "med",
              message: `${character.name} 触发能力禁用描述：${phrase}`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: "替换为设定允许的能力表现，并补充代价",
            },
            issues.length,
          ),
        );
      }
    }

    const snapshot = normalizeCharacterStateSnapshot(character.state_snapshot);
    const mentionsCharacter = input.text.includes(character.name);
    for (const item of snapshot.items_missing ?? []) {
      if (
        mentionsCharacter &&
        includesAny(input.text, inventoryConflictPhrases(item)) &&
        !includesAny(input.text, inventoryRecoveredPhrases(item))
      ) {
        const evidence = findEvidence(input.text, item);
        issues.push(
          createIssue(
            {
              type: "inventory_regression",
              severity: "high",
              message: `${character.name} 已失去 ${item}，正文却继续按持有状态描写`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: `补写重新获得 ${item} 的过程，或改写当前动作描写`,
            },
            issues.length,
          ),
        );
      }
    }

    for (const condition of snapshot.condition_flags ?? []) {
      const phrases = conditionRegressionPhrases(condition);
      const hit = phrases.find((phrase) => input.text.includes(phrase));
      if (hit && mentionsCharacter) {
        const evidence = findEvidence(input.text, hit);
        issues.push(
          createIssue(
            {
              type: "condition_regression",
              severity: "med",
              message: `${character.name} 当前状态为“${condition}”，正文却出现过度正常化描写`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: "保留伤病/中毒余波，或补充恢复过程",
            },
            issues.length,
          ),
        );
      }
    }

    for (const flag of snapshot.ability_flags ?? []) {
      const hit = abilityRegressionPhrases(flag).find((phrase) => input.text.includes(phrase));
      if (hit && mentionsCharacter) {
        const evidence = findEvidence(input.text, hit);
        issues.push(
          createIssue(
            {
              type: "ability_regression",
              severity: "high",
              message: `${character.name} 能力状态为“${flag}”，正文却直接恢复使用`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: "补充恢复条件，或改写为受限状态下的替代行动",
            },
            issues.length,
          ),
        );
      }
    }

    if (
      mentionsCharacter &&
      (snapshot.identity_flags ?? []).some((flag) => flag.includes("暴露") || flag.includes("公开")) &&
      includesAny(input.text, ["无人知晓", "仍在隐瞒", "没人知道"])
    ) {
      const evidence = findEvidence(input.text, character.name);
      issues.push(
        createIssue(
          {
            type: "identity_regression",
            severity: "med",
            message: `${character.name} 的身份已暴露，正文却仍按未暴露状态描写`,
            evidence: {
              version_id: input.versionId,
              text_hash: input.textHash,
              ...evidence,
            },
            suggested_fix: "改写知情范围，或补充重新隐匿的过程",
          },
          issues.length,
        ),
      );
    }

    if (snapshot.allegiance && snapshot.previous_allegiance) {
      const hit = allegianceConflictPhrases(snapshot.previous_allegiance).find((phrase) => input.text.includes(phrase));
      if (hit && mentionsCharacter && !input.text.includes(snapshot.allegiance)) {
        const evidence = findEvidence(input.text, hit);
        issues.push(
          createIssue(
            {
              type: "allegiance_regression",
              severity: "med",
              message: `${character.name} 已转向“${snapshot.allegiance}”，正文却仍按旧归属“${snapshot.previous_allegiance}”描写`,
              evidence: {
                version_id: input.versionId,
                text_hash: input.textHash,
                ...evidence,
              },
              suggested_fix: "同步新的归属关系，或补充短暂伪装/卧底说明",
            },
            issues.length,
          ),
        );
      }
    }
  }

  const mentionedCharacters = input.characters.filter((c) => input.text.includes(c.name));

  for (const fact of input.facts) {
    if (!input.text.includes(fact.content)) {
      continue;
    }

    const evidence = findEvidence(input.text, fact.content);

    if (fact.chapter_no > input.chapterNo) {
      issues.push(
        createIssue(
          {
            type: "knowledge_time_travel",
            severity: "high",
            message: `事实在第 ${fact.chapter_no} 章才出现，但在第 ${input.chapterNo} 章被使用`,
            evidence: {
              version_id: input.versionId,
              text_hash: input.textHash,
              ...evidence,
            },
            suggested_fix: "删除该信息或提前补写其首次出现段落",
          },
          issues.length,
        ),
      );
      continue;
    }

    if (!fact.known_by_character_ids?.length) {
      issues.push(
        createIssue(
          {
            type: "knowledge_unknown",
            severity: "low",
            message: `事实“${fact.content.slice(0, 20)}...”尚未确认知情角色`,
            evidence: {
              version_id: input.versionId,
              text_hash: input.textHash,
              ...evidence,
            },
            suggested_fix: "在右侧面板确认 known_by_character_ids",
          },
          issues.length,
        ),
      );
      continue;
    }

    const mentionedIds = mentionedCharacters.map((c) => c.id);
    const hasKnownCharacter = mentionedIds.some((id) => fact.known_by_character_ids?.includes(id));
    if (!hasKnownCharacter && mentionedIds.length > 0) {
      issues.push(
        createIssue(
          {
            type: "knowledge_mismatch",
            severity: "med",
            message: "当前提及角色不在该事实已知列表中",
            evidence: {
              version_id: input.versionId,
              text_hash: input.textHash,
              ...evidence,
            },
            suggested_fix: "补充角色获知过程，或调整 known_by_character_ids",
          },
          issues.length,
        ),
      );
    }
  }

  const summary = summarizeSeverity(issues);
  const report: ContinuityReport = {
    summary,
    issues,
    fix_strategies: [
      "局部替换：仅改写问题 evidence 对应片段，保持上下文不变",
      "场景重写：重写当前 scene，保留章节主线与伏笔",
      "章节重写：按 GenerationContext 重新生成本章并保留有效段落",
    ],
    readable_summary: `一致性检测完成，共 ${summary.total_issues} 项问题（high ${summary.high} / med ${summary.med} / low ${summary.low}）`,
  };

  return continuityReportSchema.parse(report);
}
