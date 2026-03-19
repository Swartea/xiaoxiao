import { z } from "zod";
import type { ExtractedMemory } from "./types";
import { sanitizeExtractedFacts } from "./fact-sanitizer";

const extractorSchema = z.object({
  summary: z.string(),
  scene_list: z.array(
    z.object({
      scene_index: z.number().int().nonnegative(),
      location: z.string().optional(),
      characters: z.array(z.string()).optional(),
      purpose: z.string().optional(),
      twist: z.string().optional(),
      anchor_span: z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      }),
    }),
  ),
  facts_added: z.array(
    z.object({
      content: z.string(),
      confidence: z.number().int().min(0).max(100),
      source_span: z.object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      }),
    }),
  ),
  seeds_added: z.array(
    z.object({
      content: z.string(),
      planned_payoff_chapter_no: z.number().int().optional().nullable(),
    }),
  ),
  timeline_events_added: z.array(
    z.object({
      time_mark: z.string(),
      event: z.string(),
    }),
  ),
  character_state_snapshot: z.record(z.unknown()),
  character_status_updates: z
    .array(
      z.object({
        character_id: z.string().optional(),
        character_name: z.string().optional(),
        from_status: z.string().optional().nullable(),
        to_status: z.string(),
        source_span: z
          .object({
            from: z.number().int().nonnegative(),
            to: z.number().int().nonnegative(),
          })
          .optional(),
      }),
    )
    .optional(),
  state_change_events: z
    .array(
      z.object({
        character_id: z.string().optional(),
        character_name: z.string().optional(),
        category: z.enum(["inventory", "condition", "ability", "identity", "allegiance", "seed"]),
        action: z.enum(["add", "remove", "set", "paid_off"]),
        value: z.string(),
        from_value: z.string().optional().nullable(),
        seed_id: z.string().optional(),
        seed_content: z.string().optional(),
        source_span: z
          .object({
            from: z.number().int().nonnegative(),
            to: z.number().int().nonnegative(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export function parseExtractorJson(rawText: string): ExtractedMemory {
  const parsed = extractorSchema.parse(JSON.parse(rawText));
  return {
    ...parsed,
    facts_added: sanitizeExtractedFacts(parsed.facts_added),
    character_status_updates: parsed.character_status_updates ?? [],
    state_change_events: parsed.state_change_events ?? [],
    needs_manual_review: false,
  };
}

function buildSceneList(text: string) {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  let cursor = 0;
  return paragraphs.map((p, idx) => {
    const from = text.indexOf(p, cursor);
    const to = from + p.length;
    cursor = to;
    return {
      scene_index: idx,
      location: undefined,
      characters: [],
      purpose: p.slice(0, 60),
      twist: undefined,
      anchor_span: { from: Math.max(0, from), to: Math.max(0, to) },
    };
  });
}

function factHeuristicScore(sentence: string) {
  let score = 0;

  if (/\d/.test(sentence)) score += 3;
  if (/(公元|光和|年间|次日|今晨|昨夜|三日前|午后|清晨|深夜|子时|丑时|石|钱|仓|账|差额|亏空|线索)/.test(sentence)) {
    score += 2;
  }
  if (/(发现|得知|知道|决定|命|令|查|收|转|救|被|成为|只剩|只得|差|亏空|指向|追上|挟持)/.test(sentence)) {
    score += 2;
  }
  if (/[“”"'「」『』]/.test(sentence) && !/\d/.test(sentence)) {
    score -= 3;
  }
  if (/(意识到|明白|觉得|心里|忽然明白|第一次清楚地|总得|往往|多半|恐怕)/.test(sentence) && !/\d/.test(sentence)) {
    score -= 2;
  }
  if (/(灯光|灯管|阴影|风声|雨水|气味|脚步声|掌心|额角|呼吸|回响|嗡鸣|昏暗|酸腐味)/.test(sentence)) {
    score -= 2;
  }
  if (/(像|仿佛|似乎)/.test(sentence) && !/\d/.test(sentence)) {
    score -= 1;
  }

  return score;
}

function detectSimpleFacts(text: string) {
  const sentences = text.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean);
  const ranked = sentences
    .map((sentence) => {
      const from = text.indexOf(sentence);
      return {
        content: sentence,
        confidence: 50,
        source_span: { from: Math.max(0, from), to: Math.max(0, from + sentence.length) },
        score: factHeuristicScore(sentence),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.source_span.from - right.source_span.from)
    .slice(0, 8)
    .sort((left, right) => left.source_span.from - right.source_span.from);

  return ranked.map(({ score: _score, ...candidate }) => candidate);
}

export function fallbackExtractMemory(text: string): ExtractedMemory {
  return {
    summary: text.slice(0, 220),
    scene_list: buildSceneList(text),
    facts_added: sanitizeExtractedFacts(detectSimpleFacts(text)),
    seeds_added: [],
    timeline_events_added: [],
    character_state_snapshot: {},
    character_status_updates: [],
    state_change_events: [],
    needs_manual_review: true,
    review_notes: "Extractor JSON parse failed; fallback extraction used.",
  };
}
