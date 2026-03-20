CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "ResourceType" AS ENUM (
    'character',
    'glossary',
    'sensitive_word',
    'regex_rule',
    'timeline_event',
    'relationship'
);

CREATE TYPE "ResourceReferenceState" AS ENUM (
    'inferred',
    'confirmed',
    'ignored'
);

CREATE TYPE "ResourceReferenceOrigin" AS ENUM (
    'migration',
    'extractor',
    'generation',
    'manual'
);

CREATE TABLE "sensitive_words" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "replacement" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'med',
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensitive_words_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regex_rules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "flags" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'med',
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regex_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "resource_references" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_id" UUID,
    "resource_type" "ResourceType" NOT NULL,
    "resource_id" UUID NOT NULL,
    "state" "ResourceReferenceState" NOT NULL DEFAULT 'inferred',
    "origin" "ResourceReferenceOrigin" NOT NULL DEFAULT 'extractor',
    "confidence" DOUBLE PRECISION,
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "evidence_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sensitive_words_project_id_enabled_idx" ON "sensitive_words"("project_id", "enabled");
CREATE INDEX "regex_rules_project_id_enabled_idx" ON "regex_rules"("project_id", "enabled");
CREATE UNIQUE INDEX "resource_references_chapter_id_resource_type_resource_id_key" ON "resource_references"("chapter_id", "resource_type", "resource_id");
CREATE INDEX "resource_references_project_id_resource_type_resource_id_idx" ON "resource_references"("project_id", "resource_type", "resource_id");
CREATE INDEX "resource_references_chapter_id_state_idx" ON "resource_references"("chapter_id", "state");
CREATE INDEX "resource_references_version_id_idx" ON "resource_references"("version_id");

ALTER TABLE "sensitive_words"
    ADD CONSTRAINT "sensitive_words_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "regex_rules"
    ADD CONSTRAINT "regex_rules_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_references"
    ADD CONSTRAINT "resource_references_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_references"
    ADD CONSTRAINT "resource_references_chapter_id_fkey"
    FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "resource_references"
    ADD CONSTRAINT "resource_references_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
