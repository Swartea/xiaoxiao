WITH latest_versions AS (
    SELECT DISTINCT ON (cv.chapter_id)
        cv.id,
        cv.chapter_id,
        cv.text
    FROM "chapter_versions" cv
    ORDER BY cv.chapter_id, cv.version_no DESC
),
character_hits AS (
    SELECT
        ch.project_id,
        ch.id AS chapter_id,
        lv.id AS version_id,
        c.id AS resource_id,
        GREATEST(
            CASE
                WHEN length(lv.text) = 0 OR length(c.name) = 0 THEN 0
                ELSE (length(lower(lv.text)) - length(replace(lower(lv.text), lower(c.name), ''))) / length(c.name)
            END,
            COALESCE((
                SELECT MAX(
                    CASE
                        WHEN length(alias_item.alias) = 0 THEN 0
                        ELSE (length(lower(lv.text)) - length(replace(lower(lv.text), lower(alias_item.alias), ''))) / length(alias_item.alias)
                    END
                )
                FROM unnest(c.aliases) AS alias_item(alias)
            ), 0)
        )::int AS occurrence_count,
        jsonb_build_object(
            'matched_name', c.name,
            'matched_aliases', COALESCE((
                SELECT jsonb_agg(alias_item.alias)
                FROM unnest(c.aliases) AS alias_item(alias)
                WHERE alias_item.alias <> '' AND position(lower(alias_item.alias) in lower(lv.text)) > 0
            ), '[]'::jsonb)
        ) AS evidence_json
    FROM "chapters" ch
    INNER JOIN latest_versions lv ON lv.chapter_id = ch.id
    INNER JOIN "characters" c ON c.project_id = ch.project_id
    WHERE position(lower(c.name) in lower(lv.text)) > 0
       OR EXISTS (
            SELECT 1
            FROM unnest(c.aliases) AS alias_item(alias)
            WHERE alias_item.alias <> '' AND position(lower(alias_item.alias) in lower(lv.text)) > 0
       )
),
glossary_hits AS (
    SELECT
        ch.project_id,
        ch.id AS chapter_id,
        lv.id AS version_id,
        gt.id AS resource_id,
        GREATEST(
            CASE
                WHEN length(lv.text) = 0 OR length(gt.term) = 0 THEN 0
                ELSE (length(lower(lv.text)) - length(replace(lower(lv.text), lower(gt.term), ''))) / length(gt.term)
            END,
            CASE
                WHEN length(lv.text) = 0 OR length(gt.canonical_form) = 0 THEN 0
                ELSE (length(lower(lv.text)) - length(replace(lower(lv.text), lower(gt.canonical_form), ''))) / length(gt.canonical_form)
            END
        )::int AS occurrence_count,
        jsonb_build_object(
            'matched_term', gt.term,
            'matched_canonical_form', gt.canonical_form
        ) AS evidence_json
    FROM "chapters" ch
    INNER JOIN latest_versions lv ON lv.chapter_id = ch.id
    INNER JOIN "glossary_terms" gt ON gt.project_id = ch.project_id
    WHERE position(lower(gt.term) in lower(lv.text)) > 0
       OR position(lower(gt.canonical_form) in lower(lv.text)) > 0
)
INSERT INTO "resource_references" (
    "id",
    "project_id",
    "chapter_id",
    "version_id",
    "resource_type",
    "resource_id",
    "state",
    "origin",
    "confidence",
    "occurrence_count",
    "evidence_json",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    merged.project_id,
    merged.chapter_id,
    merged.version_id,
    merged.resource_type,
    merged.resource_id,
    'inferred'::"ResourceReferenceState",
    'migration'::"ResourceReferenceOrigin",
    0.6,
    GREATEST(merged.occurrence_count, 1),
    merged.evidence_json,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT
        project_id,
        chapter_id,
        version_id,
        'character'::"ResourceType" AS resource_type,
        resource_id,
        occurrence_count,
        evidence_json
    FROM character_hits
    UNION ALL
    SELECT
        project_id,
        chapter_id,
        version_id,
        'glossary'::"ResourceType" AS resource_type,
        resource_id,
        occurrence_count,
        evidence_json
    FROM glossary_hits
) merged
ON CONFLICT ("chapter_id", "resource_type", "resource_id")
DO UPDATE SET
    "version_id" = EXCLUDED."version_id",
    "origin" = EXCLUDED."origin",
    "confidence" = EXCLUDED."confidence",
    "occurrence_count" = EXCLUDED."occurrence_count",
    "evidence_json" = EXCLUDED."evidence_json",
    "updated_at" = CURRENT_TIMESTAMP;
