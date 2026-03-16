import { z } from "zod";

export const versionStageSchema = z.enum(["beats", "draft", "polish", "fix"]);
export type VersionStage = z.infer<typeof versionStageSchema>;

export const sourceSpanSchema = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    snippet: z.string().optional(),
  })
  .refine((v) => v.to >= v.from, { message: "to must be >= from" });

export const generationContextSchema = z.object({
  bible_summary: z.string(),
  constraints: z.array(z.string()),
  safety_rules: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      value: z.string(),
      severity: z.string().optional().nullable(),
    }),
  ),
  referenced_resources: z.array(
    z.object({
      resource_type: z.string(),
      resource_id: z.string(),
      state: z.enum(["confirmed", "inferred"]),
    }),
  ),
  recent_chapter_summaries: z.array(
    z.object({
      chapter_no: z.number().int().nonnegative(),
      summary: z.string(),
    }),
  ),
  involved_characters: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      visual_anchors: z.string().optional().nullable(),
      personality_tags: z.string().optional().nullable(),
      current_status: z.string().optional().nullable(),
      state_snapshot: z.unknown(),
      key_traits: z.array(z.string()),
    }),
  ),
  relationship_slice: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      type: z.string(),
      intensity: z.number().int(),
      notes: z.string().optional(),
    }),
  ),
  relevant_facts: z.array(
    z.object({
      fact_id: z.string(),
      content: z.string(),
      chapter_no: z.number().int(),
    }),
  ),
  relevant_seeds: z.array(
    z.object({
      seed_id: z.string(),
      content: z.string(),
      status: z.string(),
      planted_chapter_no: z.number().int(),
    }),
  ),
  relevant_timeline: z.array(
    z.object({
      event_id: z.string(),
      time_mark: z.string(),
      event: z.string(),
      chapter_no_ref: z.number().int(),
    }),
  ),
  trace_map: z.array(
    z.object({
      item_type: z.string(),
      item_id: z.string(),
      source_table: z.string(),
      source_id: z.string(),
      source_span: z.unknown().optional(),
      rank: z.number().int().nonnegative(),
      score: z.number(),
    }),
  ),
});

export type GenerationContext = z.infer<typeof generationContextSchema>;

export const retrieverMetaSchema = z.object({
  k: z.number().int().positive(),
  query_entities: z.array(z.string()),
  filters: z.record(z.unknown()),
  ordering: z.array(z.string()),
  ids_selected: z.array(z.string()),
});

export type RetrieverMeta = z.infer<typeof retrieverMetaSchema>;

export const fixModeSchema = z.enum(["replace_span", "rewrite_section", "rewrite_chapter"]);
export type FixMode = z.infer<typeof fixModeSchema>;

export const fixRequestSchema = z
  .object({
    base_version_id: z.string().uuid(),
    mode: fixModeSchema,
    span: z
      .object({
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      })
      .optional(),
    section: z
      .object({
        scene_index: z.number().int().nonnegative(),
      })
      .optional(),
    issue_ids: z.array(z.string()).optional(),
    issue_type: z.string().optional(),
    keep_elements: z.array(z.string()).optional(),
    forbidden_changes: z.array(z.string()).optional(),
    target_intensity: z.string().optional(),
    prompt_template_version_id: z.string().uuid().optional(),
    platform_variant: z.string().optional(),
    style_preset_name: z.string().optional(),
    strategy_id: z.string().optional(),
    instruction: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "replace_span" && !value.span) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "span is required for replace_span",
        path: ["span"],
      });
    }
    if (value.mode === "rewrite_section" && !value.section?.scene_index && value.section?.scene_index !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "section.scene_index is required for rewrite_section",
        path: ["section", "scene_index"],
      });
    }
    if (!value.issue_ids?.length && !value.strategy_id && !value.instruction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of issue_ids, strategy_id, instruction is required",
      });
    }
  });

export type FixRequest = z.infer<typeof fixRequestSchema>;

export const continuityIssueSchema = z.object({
  issue_id: z.string(),
  type: z.string(),
  severity: z.enum(["low", "med", "high"]),
  message: z.string(),
  evidence: z.object({
    version_id: z.string().uuid(),
    text_hash: z.string(),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    snippet: z.string(),
  }),
  suggested_fix: z.string().optional(),
});

export const continuityReportSchema = z.object({
  summary: z.object({
    total_issues: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    med: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
  issues: z.array(continuityIssueSchema),
  fix_strategies: z.array(z.string()).length(3),
  readable_summary: z.string(),
});

export type ContinuityReport = z.infer<typeof continuityReportSchema>;

export const fixResponseSchema = z.object({
  new_version_id: z.string().uuid(),
  new_version_no: z.number().int().positive(),
  base_version_id: z.string().uuid(),
  mode: fixModeSchema,
  target_span: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
  patch: z.object({
    type: z.literal("offset_replace"),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    replacement: z.string(),
    unified_diff: z.string(),
  }),
  continuity_report: continuityReportSchema,
});

export type FixResponse = z.infer<typeof fixResponseSchema>;

export const sceneListItemSchema = z.object({
  scene_index: z.number().int().nonnegative(),
  location: z.string().optional(),
  characters: z.array(z.string()).optional(),
  purpose: z.string().optional(),
  twist: z.string().optional(),
  anchor_span: z.object({
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
  }),
});

export type SceneListItem = z.infer<typeof sceneListItemSchema>;
