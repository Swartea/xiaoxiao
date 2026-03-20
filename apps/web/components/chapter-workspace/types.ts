export type FixMode = "replace_span" | "rewrite_section" | "rewrite_chapter";
export type FixIntensity = "low" | "medium" | "high";
export type StageTab = "beats" | "draft" | "polish";

export type VersionMeta = {
  id: string;
  version_no: number;
  stage: string;
  created_at?: string;
  parent_version_id?: string | null;
  fix_mode?: string | null;
  strategy_id?: string | null;
  instruction_excerpt?: string | null;
  prompt_name?: string | null;
  prompt_version_label?: string | null;
  platform_variant?: string | null;
  style_preset_name?: string | null;
};

export type PromptTraceItem = {
  stage: string;
  agent_name?: string | null;
  prompt_name?: string | null;
  prompt_version?: string | null;
  prompt_template_version_id?: string | null;
  platform_variant?: string | null;
  style_preset_name?: string | null;
  model?: string | null;
  context_hash?: string | null;
  input_summary?: Record<string, unknown> | string | null;
  created_at?: string | null;
};

export type Issue = {
  issue_id: string;
  type: string;
  severity: string;
  message: string;
  evidence?: {
    from?: number;
    to?: number;
  };
};

export type ContextBriefSnapshot = {
  snapshot_id: string;
  stage: string;
  tags: string[];
  context_hash: string;
  source?: string;
  context_brief: {
    chapter_mission?: string;
    must_remember?: string[];
    must_not_violate?: string[];
    active_relationships?: string[];
    payoff_targets?: string[];
    danger_points?: string[];
  };
};

export type ChapterIntentData = {
  id: string;
  version_no: number;
  chapter_mission: string;
  advance_goal?: string | null;
  conflict_target?: string | null;
  hook_target?: string | null;
  pacing_direction?: string | null;
  must_payoff_seed_ids?: string[];
  updated_at?: string;
};

export type PublishReadinessData = {
  status: "pending" | "ready" | "revise" | "rework";
  label: string;
  summary: string;
  strongest_point?: string;
  top_actions?: string[];
  risk_notes?: string[];
  overall_score?: number | null;
};

export type HandoffBriefData = {
  chapter_takeaways?: string[];
  unresolved_seeds?: string[];
  relationship_changes?: string[];
  carry_over_pressure?: string[];
  next_opening_options?: string[];
};

export type AdvisorMessage = {
  role: "user" | "assistant";
  content: string;
};

export type WorkspaceData = {
  chapter?: Record<string, unknown> | null;
  latest_version?: VersionMeta | null;
  latest_version_text?: string;
  versions?: VersionMeta[];
  prompt_trace?: PromptTraceItem[];
  latest_intent?: ChapterIntentData | null;
  publish_readiness?: PublishReadinessData | null;
  handoff_brief?: HandoffBriefData | null;
  context_brief?: ContextBriefSnapshot | null;
  generation_context_snapshot?: Record<string, unknown> | null;
  legacy_consistency_report?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
  chapter_memory?: Record<string, unknown> | null;
  extracted_items?: Record<string, unknown> | null;
  resource_references?: Record<string, unknown> | null;
  resource_summary?: Record<string, unknown> | null;
  quality_report?: Record<string, unknown> | null;
  director_review?: Record<string, unknown> | null;
  fix_tasks?: Record<string, unknown>[];
  quality_trend?: Array<{ version_id: string; overall_score: number }>;
  continuity_report?: Record<string, unknown> | null;
};
