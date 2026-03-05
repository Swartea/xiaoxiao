import type { GenerationContext, RetrieverMeta, SceneListItem } from "@novel-factory/shared";

export type RetrievedItem<T> = {
  id: string;
  data: T;
  rank: number;
  score: number;
  source_table: string;
  source_id: string;
  source_span?: unknown;
  entity_id?: string;
  normalized_content_hash?: string;
};

export type RetrievedMemoryPackage = {
  bibleRules: RetrievedItem<{ text: string }> [];
  glossary: RetrievedItem<{ term: string; canonical_form: string; notes?: string | null }> [];
  recentSummaries: RetrievedItem<{ chapter_no: number; summary: string }> [];
  characterSnapshots: RetrievedItem<{ id: string; name: string; state_snapshot: unknown; key_traits: string[] }> [];
  relationshipSlice: RetrievedItem<{ from: string; to: string; type: string; intensity: number; notes?: string | null }> [];
  facts: RetrievedItem<{ fact_id: string; content: string; chapter_no: number; known_by_character_ids?: string[] }> [];
  seeds: RetrievedItem<{ seed_id: string; content: string; status: string; planted_chapter_no: number }> [];
  timeline: RetrievedItem<{ event_id: string; time_mark: string; event: string; chapter_no_ref: number }> [];
  retrieverMeta: RetrieverMeta;
};

export type AssemblerInput = {
  k: number;
  retrieved: RetrievedMemoryPackage;
};

export type AssemblerOutput = {
  context: GenerationContext;
  contextHash: string;
  traceMap: GenerationContext["trace_map"];
  retrieverMeta: RetrieverMeta;
};

export type ExtractedMemory = {
  summary: string;
  scene_list: SceneListItem[];
  facts_added: Array<{ content: string; confidence: number; source_span: { from: number; to: number } }>;
  seeds_added: Array<{ content: string; planned_payoff_chapter_no?: number | null }>;
  timeline_events_added: Array<{ time_mark: string; event: string }>;
  character_state_snapshot: Record<string, unknown>;
  needs_manual_review: boolean;
  review_notes?: string;
};

export type ContinuityIssue = {
  issue_id: string;
  type: string;
  severity: "low" | "med" | "high";
  message: string;
  evidence: {
    version_id: string;
    text_hash: string;
    from: number;
    to: number;
    snippet: string;
  };
  suggested_fix?: string;
};

export type ContinuityCheckInput = {
  versionId: string;
  textHash: string;
  chapterNo: number;
  text: string;
  glossary: Array<{ term: string; canonical_form: string }>;
  characters: Array<{ id: string; name: string; age?: number | null; abilities?: Record<string, unknown> | null }>;
  facts: Array<{
    id: string;
    content: string;
    chapter_no: number;
    known_by_character_ids?: string[];
  }>;
};
