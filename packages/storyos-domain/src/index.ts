import { z } from "zod";

export const stylePresetNameSchema = z.enum(["webnovel", "toutiao-fiction", "short-drama"]);

export const stylePresetSchema = z.object({
  targetPlatform: z.string(),
  sentenceLength: z.enum(["short", "medium"]),
  paragraphDensity: z.enum(["low", "medium", "high"]),
  dialogueRatioTarget: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  expositionLimit: z.number().min(0).max(1),
  openingHookRequired: z.boolean(),
  endingHookRequired: z.boolean(),
  tabooRules: z.array(z.string()),
  favoredDevices: z.array(z.string()),
  pacingProfile: z.enum(["fast", "balanced", "slow-burn"]),
});
export type StylePresetSpec = z.infer<typeof stylePresetSchema>;

export const beatSchema = z.object({
  goal: z.string(),
  conflict: z.string(),
  obstacle: z.string(),
  action: z.string(),
  reversal: z.string(),
  reveal: z.string(),
  ending_hook: z.string(),
});
export type StoryBeat = z.infer<typeof beatSchema>;

export const contextTagSchema = z.enum([
  "character_core",
  "recent_plot",
  "direct_conflict",
  "must_payoff_seed",
  "world_rule",
  "optional_background",
]);

export const contextBriefSchema = z.object({
  chapter_mission: z.string(),
  must_remember: z.array(z.string()),
  must_not_violate: z.array(z.string()),
  active_relationships: z.array(z.string()),
  payoff_targets: z.array(z.string()),
  danger_points: z.array(z.string()),
});
export type ContextBrief = z.infer<typeof contextBriefSchema>;

export const qualityDimensionSchema = z.object({
  score: z.number().min(0).max(10),
  reason: z.string(),
});

export const chapterQualitySchema = z.object({
  opening_hook: qualityDimensionSchema,
  conflict_strength: qualityDimensionSchema,
  pacing: qualityDimensionSchema,
  dialogue_quality: qualityDimensionSchema,
  character_voice: qualityDimensionSchema,
  scene_vividness: qualityDimensionSchema,
  exposition_control: qualityDimensionSchema,
  ending_hook: qualityDimensionSchema,
  platform_fit: qualityDimensionSchema,
});

export const continuityItemsSchema = z.object({
  world_rule_conflict: z.array(z.string()),
  timeline_conflict: z.array(z.string()),
  relationship_conflict: z.array(z.string()),
  character_ooc: z.array(z.string()),
  seed_payoff_miss: z.array(z.string()),
});

export const chapterEvaluationSchema = z.object({
  overall_score: z.number().min(0).max(10),
  quality: chapterQualitySchema,
  continuity: continuityItemsSchema,
  summary: z.string(),
});
export type ChapterEvaluation = z.infer<typeof chapterEvaluationSchema>;

export const fixIntensitySchema = z.enum(["low", "medium", "high"]);

export const fixPlanSchema = z.object({
  issue_type: z.string(),
  fix_goal: z.string(),
  keep_elements: z.array(z.string()),
  forbidden_changes: z.array(z.string()),
  target_intensity: fixIntensitySchema,
});
export type FixPlan = z.infer<typeof fixPlanSchema>;

export const directorDecisionSchema = z.object({
  decision: z.enum(["accept", "fix", "regenerate"]),
  should_regenerate: z.boolean(),
  focus_area: z.enum(["pacing", "character", "conflict", "hook", "continuity", "none"]),
  rationale: z.string(),
  suggested_fix: fixPlanSchema.optional(),
  next_chapter_direction: z.string(),
});
export type DirectorDecision = z.infer<typeof directorDecisionSchema>;

export const experimentTypeSchema = z.enum(["prompt_ab", "model_compare", "retriever_compare"]);

export const experimentVariantSchema = z.object({
  label: z.string(),
  prompt_version: z.string().optional(),
  prompt_template_version_id: z.string().uuid().optional(),
  prompt_name: z.string().optional(),
  prompt_version_number: z.number().int().positive().optional(),
  platform_variant: z.string().optional(),
  model: z.string().optional(),
  retriever_strategy: z.string().optional(),
  version_id: z.string().uuid().optional(),
  quality_score: z.number().min(0).max(10).optional(),
  manual_score: z.number().min(0).max(10).optional(),
});

export const experimentResultSchema = z.object({
  experiment_id: z.string().uuid(),
  chapter_id: z.string().uuid(),
  type: experimentTypeSchema,
  variant_a: experimentVariantSchema,
  variant_b: experimentVariantSchema,
  winner: z.enum(["a", "b", "draw"]),
  reason: z.string(),
});
export type ExperimentResult = z.infer<typeof experimentResultSchema>;

export const adaptationTypeSchema = z.enum(["script", "storyboard", "short_drama", "character_card", "scene_card"]);

export const promptTemplateSeedSchema = z.object({
  prompt_name: z.string(),
  stage: z.enum(["beats", "draft", "polish", "quality_eval", "fix", "director", "adaptation"]),
  purpose: z.string(),
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
  versions: z.array(
    z.object({
      prompt_version: z.number().int().positive(),
      platform_variant: z.string(),
      template: z.string().optional(),
      system_template: z.string().optional(),
      user_template: z.string().optional(),
      input_contract: z.record(z.unknown()).optional(),
      output_contract: z.record(z.unknown()).optional(),
      is_active: z.boolean().default(true),
      ab_bucket: z.string().optional(),
    }),
  ),
});
export type PromptTemplateSeed = z.infer<typeof promptTemplateSeedSchema>;

export const agentRunSchema = z.object({
  run_id: z.string(),
  project_id: z.string().uuid(),
  chapter_id: z.string().uuid().optional(),
  agent_name: z.string(),
  prompt_name: z.string().optional(),
  prompt_version: z.string().optional(),
  prompt_template_version_id: z.string().uuid().optional(),
  platform_variant: z.string().optional(),
  model: z.string().optional(),
  style_preset: z.string().optional(),
  retriever_strategy: z.string().optional(),
  context_hash: z.string().optional(),
  token_usage: z.record(z.unknown()).optional(),
  quality_score: z.number().optional(),
});
export type AgentRunPayload = z.infer<typeof agentRunSchema>;
