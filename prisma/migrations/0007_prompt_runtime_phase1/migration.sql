ALTER TABLE "prompt_template_versions"
    ADD COLUMN "system_template" TEXT,
    ADD COLUMN "user_template" TEXT,
    ADD COLUMN "input_contract" JSONB,
    ADD COLUMN "output_contract" JSONB;

UPDATE "prompt_template_versions"
SET "platform_variant" = 'default'
WHERE "platform_variant" IS NULL;

ALTER TABLE "prompt_template_versions"
    ALTER COLUMN "platform_variant" SET DEFAULT 'default';

ALTER TABLE "prompt_template_versions"
    ALTER COLUMN "platform_variant" SET NOT NULL;

ALTER TABLE "prompt_template_versions"
    DROP CONSTRAINT IF EXISTS "prompt_template_versions_prompt_template_id_prompt_version_key";

ALTER TABLE "prompt_template_versions"
    ADD CONSTRAINT "prompt_template_versions_prompt_template_id_prompt_version_platform_variant_key"
    UNIQUE ("prompt_template_id", "prompt_version", "platform_variant");

ALTER TABLE "agent_runs"
    ADD COLUMN "prompt_name" TEXT,
    ADD COLUMN "prompt_template_version_id" UUID,
    ADD COLUMN "platform_variant" TEXT;

CREATE INDEX "agent_runs_prompt_template_version_id_idx"
    ON "agent_runs"("prompt_template_version_id");

ALTER TABLE "agent_runs"
    ADD CONSTRAINT "agent_runs_prompt_template_version_id_fkey"
    FOREIGN KEY ("prompt_template_version_id")
    REFERENCES "prompt_template_versions"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
