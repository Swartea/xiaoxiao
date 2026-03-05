import type { AssemblerInput, AssemblerOutput, RetrievedItem } from "./types";
import { dedupeByEntityAndContent, scaleQuota } from "./retriever";
import { sha256FromCanonicalJson } from "./hash";

function pickTop<T>(items: RetrievedItem<T>[], limit: number): RetrievedItem<T>[] {
  return items.slice().sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildGenerationContext(input: AssemblerInput): AssemblerOutput {
  const k = Math.max(20, input.k);

  const bibleQuota = scaleQuota(5, k);
  const summaryQuota = scaleQuota(10, k);
  const factsQuota = scaleQuota(10, k);
  const seedsQuota = scaleQuota(10, k);
  const timelineQuota = scaleQuota(10, k);

  const characterLimit = Math.min(8, k);

  const bibleRules = pickTop(input.retrieved.bibleRules, bibleQuota);
  const glossary = pickTop(input.retrieved.glossary, bibleQuota);
  const recentSummaries = pickTop(input.retrieved.recentSummaries, summaryQuota);
  const characterSnapshots = pickTop(input.retrieved.characterSnapshots, characterLimit);
  const relationshipSlice = pickTop(input.retrieved.relationshipSlice, Math.max(5, scaleQuota(10, k)));
  const facts = pickTop(dedupeByEntityAndContent(input.retrieved.facts), factsQuota);
  const seeds = pickTop(dedupeByEntityAndContent(input.retrieved.seeds), seedsQuota);
  const timeline = pickTop(dedupeByEntityAndContent(input.retrieved.timeline), timelineQuota);

  const constraints = [
    ...bibleRules.map((i) => i.data.text),
    ...glossary.map((i) => `术语统一: ${i.data.term} -> ${i.data.canonical_form}`),
  ];

  const bibleSummary = [
    "世界观与规则摘要:",
    ...bibleRules.map((r) => `- ${r.data.text}`),
    "术语摘要:",
    ...glossary.map((g) => `- ${g.data.term}: ${g.data.canonical_form}`),
  ].join("\n");

  const trace_map = [
    ...bibleRules,
    ...glossary,
    ...recentSummaries,
    ...characterSnapshots,
    ...relationshipSlice,
    ...facts,
    ...seeds,
    ...timeline,
  ].map((item) => ({
    item_type: item.source_table,
    item_id: item.id,
    source_table: item.source_table,
    source_id: item.source_id,
    source_span: item.source_span,
    rank: item.rank,
    score: item.score,
  }));

  const context = {
    bible_summary: bibleSummary,
    constraints,
    recent_chapter_summaries: recentSummaries.map((item) => ({
      chapter_no: item.data.chapter_no,
      summary: item.data.summary,
    })),
    involved_characters: characterSnapshots.map((item) => ({
      id: item.data.id,
      name: item.data.name,
      state_snapshot: item.data.state_snapshot,
      key_traits: item.data.key_traits,
    })),
    relationship_slice: relationshipSlice.map((item) => ({
      from: item.data.from,
      to: item.data.to,
      type: item.data.type,
      intensity: item.data.intensity,
      notes: item.data.notes ?? undefined,
    })),
    relevant_facts: facts.map((item) => ({
      fact_id: item.data.fact_id,
      content: item.data.content,
      chapter_no: item.data.chapter_no,
    })),
    relevant_seeds: seeds.map((item) => ({
      seed_id: item.data.seed_id,
      content: item.data.content,
      status: item.data.status,
      planted_chapter_no: item.data.planted_chapter_no,
    })),
    relevant_timeline: timeline.map((item) => ({
      event_id: item.data.event_id,
      time_mark: item.data.time_mark,
      event: item.data.event,
      chapter_no_ref: item.data.chapter_no_ref,
    })),
    trace_map,
  };

  const contextHash = sha256FromCanonicalJson(context);

  return {
    context,
    contextHash,
    traceMap: trace_map,
    retrieverMeta: input.retrieved.retrieverMeta,
  };
}
