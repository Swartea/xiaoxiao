import type { FixMode, StageTab } from "./types";

export const STAGE_LABELS: Record<StageTab, string> = {
  beats: "场景骨架",
  draft: "正文初稿",
  polish: "润色定稿",
};

export const FIX_MODE_BY_STRATEGY_INDEX: FixMode[] = ["replace_span", "rewrite_section", "rewrite_chapter"];

export const FIX_MODE_LABELS: Record<FixMode, string> = {
  replace_span: "局部替换",
  rewrite_section: "场景重写",
  rewrite_chapter: "整章重写",
};

export const FIX_MODE_RISK_LABELS: Record<FixMode, string> = {
  replace_span: "低风险",
  rewrite_section: "中风险",
  rewrite_chapter: "高风险",
};

export const RESOURCE_GROUP_LABELS: Record<string, string> = {
  characters: "角色",
  glossary: "术语",
  relationships: "关系",
  timeline: "时间线",
  sensitive_words: "敏感词",
  regex_rules: "Regex 规则",
};

export const AUTHOR_ADVISOR_PROMPTS = [
  "这章现在最影响追更欲的问题是什么？",
  "下一章开篇最抓人的处理方式是什么？",
  "如果只改 3 处，优先改哪里？",
];
