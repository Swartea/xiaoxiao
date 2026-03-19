type FactCandidate = {
  content: string;
  confidence: number;
  source_span: { from: number; to: number };
};

const FACT_LABEL_PREFIX_REGEX =
  /^(时间|地点|冲突|转折|核心描写|出场人物|章节牵引点|场景\d+|场景[一二三四五六七八九十]+)[:：]/;
const PURE_PUNCTUATION_REGEX = /^[\s"'“”‘’「」『』\-—_*#~`:.：;；,，!！?？()\[\]（）<>《》]+$/;
const DIALOGUE_FRAGMENT_REGEX = /[“”"'「」『』]/;
const COGNITION_FRAGMENT_REGEX = /(意识到|明白|觉得|心里|忽然明白|第一次清楚地|看了.*一眼|按得|攥得|总得|往往|多半|恐怕)/;

export function normalizeFactCandidateContent(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

export function isLikelyFactNoise(content: string) {
  const text = normalizeFactCandidateContent(content);
  if (!text) return true;
  if (text.length <= 3) return true;
  if (PURE_PUNCTUATION_REGEX.test(text)) return true;
  if (/^(#|##|###)\s*/.test(text)) return true;
  if (/^-+\s*$/.test(text)) return true;
  if (/^-+\s+/.test(text)) return true;
  if (/^\*\*[^*]+\*\*[:：]?(.*)?$/.test(text)) return true;
  if (FACT_LABEL_PREFIX_REGEX.test(text)) return true;
  if (/^[“"'「『].{0,18}$/.test(text) && !/[”"'」』]$/.test(text)) return true;
  if (/^[”"'」』]+$/.test(text)) return true;
  if (DIALOGUE_FRAGMENT_REGEX.test(text) && !/\d/.test(text)) return true;
  if (COGNITION_FRAGMENT_REGEX.test(text) && !/\d/.test(text)) return true;
  return false;
}

export function sanitizeExtractedFacts<T extends FactCandidate>(facts: T[]) {
  const sanitized: T[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    const content = normalizeFactCandidateContent(fact.content);
    if (isLikelyFactNoise(content)) {
      continue;
    }

    const fingerprint = content.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);

    sanitized.push({
      ...fact,
      content,
    });
  }

  return sanitized;
}
