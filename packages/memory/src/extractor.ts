import { z } from "zod";
import type { ExtractedMemory } from "./types";

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
});

export function parseExtractorJson(rawText: string): ExtractedMemory {
  const parsed = extractorSchema.parse(JSON.parse(rawText));
  return {
    ...parsed,
    character_status_updates: parsed.character_status_updates ?? [],
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

function detectSimpleFacts(text: string) {
  const sentences = text.split(/[。！？!?\n]/).map((s) => s.trim()).filter(Boolean);
  return sentences.slice(0, 8).map((sentence) => {
    const from = text.indexOf(sentence);
    return {
      content: sentence,
      confidence: 50,
      source_span: { from: Math.max(0, from), to: Math.max(0, from + sentence.length) },
    };
  });
}

export function fallbackExtractMemory(text: string): ExtractedMemory {
  return {
    summary: text.slice(0, 220),
    scene_list: buildSceneList(text),
    facts_added: detectSimpleFacts(text),
    seeds_added: [],
    timeline_events_added: [],
    character_state_snapshot: {},
    character_status_updates: [],
    needs_manual_review: true,
    review_notes: "Extractor JSON parse failed; fallback extraction used.",
  };
}
