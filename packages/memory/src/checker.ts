import { continuityReportSchema, type ContinuityReport } from "@novel-factory/shared";
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
