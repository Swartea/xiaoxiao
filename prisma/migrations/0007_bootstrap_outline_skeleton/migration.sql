WITH latest_chapter_intents AS (
    SELECT
        ranked.id,
        ranked.chapter_id,
        chapters.chapter_no,
        CASE
            WHEN jsonb_typeof(ranked.notes) = 'object' AND ranked.notes ? 'outline_workspace' THEN ranked.notes -> 'outline_workspace'
            WHEN jsonb_typeof(ranked.notes) = 'object' THEN ranked.notes
            ELSE '{}'::jsonb
        END AS payload,
        CASE
            WHEN jsonb_typeof(ranked.notes) = 'object' THEN ranked.notes
            ELSE '{}'::jsonb
        END AS base_notes
    FROM (
        SELECT
            chapter_intents.*,
            ROW_NUMBER() OVER (PARTITION BY chapter_intents.chapter_id ORDER BY chapter_intents.version_no DESC) AS rn
        FROM "chapter_intents"
    ) ranked
    JOIN "chapters" ON "chapters"."id" = ranked.chapter_id
    WHERE ranked.rn = 1
),
cleaned_key_events AS (
    SELECT
        latest.id,
        COALESCE(
            jsonb_agg(to_jsonb(trimmed.value)) FILTER (WHERE trimmed.value IS NOT NULL),
            '[]'::jsonb
        ) AS key_events
    FROM latest_chapter_intents latest
    LEFT JOIN LATERAL (
        SELECT NULLIF(BTRIM(raw.value), '') AS value
        FROM jsonb_array_elements_text(
            CASE
                WHEN jsonb_typeof(latest.payload -> 'key_events') = 'array' THEN latest.payload -> 'key_events'
                ELSE '[]'::jsonb
            END
        ) AS raw(value)
    ) trimmed ON TRUE
    GROUP BY latest.id
)
UPDATE "chapter_intents" AS target
SET
    "chapter_mission" = COALESCE(NULLIF(BTRIM(latest.payload ->> 'goal'), ''), FORMAT('第%s章推进主线', latest.chapter_no)),
    "advance_goal" = NULLIF(BTRIM(latest.payload ->> 'goal'), ''),
    "conflict_target" = NULLIF(BTRIM(latest.payload ->> 'core_conflict'), ''),
    "hook_target" = NULLIF(BTRIM(latest.payload ->> 'ending_hook'), ''),
    "pacing_direction" = NULLIF(BTRIM(latest.payload ->> 'stage_position'), ''),
    "must_payoff_seed_ids" = ARRAY[]::TEXT[],
    "notes" = jsonb_set(
        latest.base_notes,
        '{outline_workspace}',
        jsonb_strip_nulls(
            jsonb_build_object(
                'stage_no',
                CASE
                    WHEN jsonb_typeof(latest.payload -> 'stage_no') = 'number' THEN latest.payload -> 'stage_no'
                    WHEN COALESCE(BTRIM(latest.payload ->> 'stage_no'), '') ~ '^[0-9]+$' THEN to_jsonb((latest.payload ->> 'stage_no')::INTEGER)
                    ELSE NULL
                END,
                'stage_position', NULLIF(BTRIM(latest.payload ->> 'stage_position'), ''),
                'goal', NULLIF(BTRIM(latest.payload ->> 'goal'), ''),
                'core_conflict', NULLIF(BTRIM(latest.payload ->> 'core_conflict'), ''),
                'key_events', cleaned.key_events,
                'character_change', NULLIF(BTRIM(latest.payload ->> 'character_change'), ''),
                'information_reveal', NULLIF(BTRIM(latest.payload ->> 'information_reveal'), ''),
                'ending_hook', NULLIF(BTRIM(latest.payload ->> 'ending_hook'), ''),
                'word_target',
                CASE
                    WHEN jsonb_typeof(latest.payload -> 'word_target') = 'number' THEN latest.payload -> 'word_target'
                    WHEN COALESCE(BTRIM(latest.payload ->> 'word_target'), '') ~ '^[0-9]+$' THEN to_jsonb((latest.payload ->> 'word_target')::INTEGER)
                    ELSE NULL
                END
            )
        ),
        true
    )
FROM latest_chapter_intents latest
JOIN cleaned_key_events cleaned ON cleaned.id = latest.id
WHERE target.id = latest.id;
