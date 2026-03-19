import type { GenerationContext, RetrieverMeta, SceneListItem } from "@novel-factory/shared";

export type MemoryLifecycleStatus = "extracted" | "confirmed" | "rejected" | "superseded";

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
  characterSnapshots: RetrievedItem<{
    id: string;
    name: string;
    visual_anchors?: string | null;
    personality_tags?: string | null;
    current_status?: string | null;
    state_snapshot: unknown;
    key_traits: string[];
  }> [];
  relationshipSlice: RetrievedItem<{ from: string; to: string; type: string; intensity: number; notes?: string | null }> [];
  facts: RetrievedItem<{
    fact_id: string;
    content: string;
    chapter_no: number;
    known_by_character_ids?: string[];
    extraction_status?: MemoryLifecycleStatus;
  }> [];
  seeds: RetrievedItem<{
    seed_id: string;
    content: string;
    status: string;
    planted_chapter_no: number;
    extraction_status?: MemoryLifecycleStatus;
  }> [];
  timeline: RetrievedItem<{
    event_id: string;
    time_mark: string;
    event: string;
    chapter_no_ref: number;
    extraction_status?: MemoryLifecycleStatus;
  }> [];
  retrieverMeta: RetrieverMeta;
};

export type CharacterStateSnapshot = {
  current_status?: string | null;
  items_owned?: string[];
  items_missing?: string[];
  condition_flags?: string[];
  ability_flags?: string[];
  identity_flags?: string[];
  allegiance?: string | null;
  previous_allegiance?: string | null;
  resolved_seed_ids?: string[];
  resolved_seed_contents?: string[];
  last_updated_chapter_no?: number;
  source_version_id?: string;
};

export type StoryStateSnapshot = {
  paid_off_seed_ids?: string[];
  paid_off_seed_contents?: string[];
  last_updated_chapter_no?: number;
  source_version_id?: string;
};

export type StateChangeCategory =
  | "inventory"
  | "condition"
  | "ability"
  | "identity"
  | "allegiance"
  | "seed";

export type StateChangeAction = "add" | "remove" | "set" | "paid_off";

export type StateChangeEvent = {
  character_id?: string;
  character_name?: string;
  category: StateChangeCategory;
  action: StateChangeAction;
  value: string;
  from_value?: string | null;
  seed_id?: string;
  seed_content?: string;
  source_span?: { from: number; to: number };
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
  character_status_updates?: Array<{
    character_id?: string;
    character_name?: string;
    from_status?: string | null;
    to_status: string;
    source_span?: { from: number; to: number };
  }>;
  state_change_events?: StateChangeEvent[];
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
  characters: Array<{
    id: string;
    name: string;
    age?: number | null;
    abilities?: Record<string, unknown> | null;
    current_status?: string | null;
    state_snapshot?: CharacterStateSnapshot | null;
  }>;
  facts: Array<{
    id: string;
    content: string;
    chapter_no: number;
    known_by_character_ids?: string[];
  }>;
};

export type ExtractedMemoryCandidate = {
  id: string;
  kind: "fact" | "seed" | "timeline";
  content: string;
  chapter_no: number;
  time_mark?: string | null;
};

export type ExtractedMemoryValidationInput = {
  candidates: ExtractedMemoryCandidate[];
  world_rules: string[];
  confirmed_facts: Array<{
    id: string;
    content: string;
    chapter_no: number;
  }>;
  confirmed_seeds: Array<{
    id: string;
    content: string;
    planted_chapter_no: number;
  }>;
  confirmed_timeline: Array<{
    id: string;
    time_mark: string;
    event: string;
    chapter_no_ref: number;
  }>;
  characters: Array<{
    id: string;
    name: string;
    current_status?: string | null;
  }>;
  character_state_snapshot?: Record<string, unknown>;
};

export type ExtractedMemoryValidationResult = {
  id: string;
  kind: ExtractedMemoryCandidate["kind"];
  status: MemoryLifecycleStatus;
  reasons: string[];
};
