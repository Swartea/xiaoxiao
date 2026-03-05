-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Pov" AS ENUM ('first', 'third');

-- CreateEnum
CREATE TYPE "Tense" AS ENUM ('past', 'present');

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('outline', 'draft', 'final');

-- CreateEnum
CREATE TYPE "VersionStage" AS ENUM ('beats', 'draft', 'polish', 'fix');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('family', 'love', 'rival', 'ally', 'mentor', 'friend', 'enemy', 'unknown');

-- CreateEnum
CREATE TYPE "SeedStatus" AS ENUM ('planted', 'in_progress', 'paid_off', 'abandoned');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'med', 'high');

-- CreateEnum
CREATE TYPE "ExtractedStatus" AS ENUM ('extracted', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "GenerationRequestStatus" AS ENUM ('in_progress', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT,
    "target_platform" TEXT,
    "pov" "Pov" NOT NULL DEFAULT 'third',
    "tense" "Tense" NOT NULL DEFAULT 'past',
    "style_preset_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_presets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT,
    "pacing" TEXT,
    "dialogue_ratio" DOUBLE PRECISION,
    "banned_words" TEXT[],
    "preferred_words" TEXT[],
    "constraints" JSONB,

    CONSTRAINT "style_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "age" INTEGER,
    "appearance" TEXT,
    "personality" TEXT,
    "motivation" TEXT,
    "secrets" TEXT,
    "abilities" JSONB,
    "catchphrases" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relationships" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "from_character_id" UUID NOT NULL,
    "to_character_id" UUID NOT NULL,
    "relation_type" "RelationType" NOT NULL,
    "intensity" INTEGER NOT NULL,
    "notes" TEXT,
    "last_updated_chapter_no" INTEGER,

    CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bible_entities" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "constraints" TEXT,
    "cost" TEXT,
    "first_appearance_chapter_no" INTEGER,

    CONSTRAINT "bible_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glossary_terms" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "canonical_form" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_no" INTEGER NOT NULL,
    "title" TEXT,
    "goal" TEXT,
    "conflict" TEXT,
    "twist" TEXT,
    "cliffhanger" TEXT,
    "word_target" INTEGER,
    "status" "ChapterStatus" NOT NULL DEFAULT 'outline',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_versions" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "stage" "VersionStage" NOT NULL,
    "text" TEXT NOT NULL,
    "text_hash" TEXT NOT NULL,
    "parent_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "chapter_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_memory" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "extracted_from_version_id" UUID NOT NULL,
    "summary" TEXT,
    "scene_list" JSONB,
    "character_state_snapshot" JSONB,
    "needs_manual_review" BOOLEAN NOT NULL DEFAULT false,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapter_memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_no" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "entities" JSONB,
    "time_in_story" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "source_span" JSONB,
    "known_by_character_ids" TEXT[],
    "source_version_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "ExtractedStatus" NOT NULL DEFAULT 'extracted',

    CONSTRAINT "facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seeds" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "planted_chapter_no" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "planned_payoff_chapter_no" INTEGER,
    "status" "SeedStatus" NOT NULL DEFAULT 'planted',
    "payoff_method" TEXT,
    "related_fact_ids" TEXT[],
    "source_version_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "extraction_status" "ExtractedStatus" NOT NULL DEFAULT 'extracted',

    CONSTRAINT "seeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "time_mark" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "involved_entities" JSONB,
    "chapter_no_ref" INTEGER NOT NULL,
    "source_version_id" UUID,
    "fingerprint" TEXT NOT NULL,
    "status" "ExtractedStatus" NOT NULL DEFAULT 'extracted',

    CONSTRAINT "timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consistency_reports" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "report" JSONB NOT NULL,
    "severity" "Severity" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consistency_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_context_snapshots" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "stage" "VersionStage" NOT NULL,
    "context" JSONB NOT NULL,
    "trace_map" JSONB NOT NULL,
    "retriever_meta" JSONB NOT NULL,
    "context_hash" TEXT NOT NULL,
    "build_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_requests" (
    "id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "stage" "VersionStage" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "GenerationRequestStatus" NOT NULL,
    "response_version_id" UUID,
    "response_report_id" UUID,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "characters_project_id_idx" ON "characters"("project_id");

-- CreateIndex
CREATE INDEX "relationships_project_id_from_character_id_to_character_id_idx" ON "relationships"("project_id", "from_character_id", "to_character_id");

-- CreateIndex
CREATE INDEX "bible_entities_project_id_idx" ON "bible_entities"("project_id");

-- CreateIndex
CREATE INDEX "glossary_terms_project_id_idx" ON "glossary_terms"("project_id");

-- CreateIndex
CREATE INDEX "chapters_project_id_idx" ON "chapters"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_project_id_chapter_no_key" ON "chapters"("project_id", "chapter_no");

-- CreateIndex
CREATE INDEX "chapter_versions_chapter_id_idx" ON "chapter_versions"("chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_versions_chapter_id_version_no_key" ON "chapter_versions"("chapter_id", "version_no");

-- CreateIndex
CREATE INDEX "chapter_memory_chapter_id_idx" ON "chapter_memory"("chapter_id");

-- CreateIndex
CREATE INDEX "facts_project_id_chapter_no_idx" ON "facts"("project_id", "chapter_no");

-- CreateIndex
CREATE UNIQUE INDEX "facts_source_version_id_fingerprint_key" ON "facts"("source_version_id", "fingerprint");

-- CreateIndex
CREATE INDEX "seeds_project_id_planted_chapter_no_status_idx" ON "seeds"("project_id", "planted_chapter_no", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seeds_source_version_id_fingerprint_key" ON "seeds"("source_version_id", "fingerprint");

-- CreateIndex
CREATE INDEX "timeline_events_project_id_chapter_no_ref_idx" ON "timeline_events"("project_id", "chapter_no_ref");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_events_source_version_id_fingerprint_key" ON "timeline_events"("source_version_id", "fingerprint");

-- CreateIndex
CREATE INDEX "consistency_reports_chapter_id_idx" ON "consistency_reports"("chapter_id");

-- CreateIndex
CREATE INDEX "generation_context_snapshots_chapter_id_idx" ON "generation_context_snapshots"("chapter_id");

-- CreateIndex
CREATE INDEX "generation_requests_chapter_id_stage_idx" ON "generation_requests"("chapter_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "generation_requests_chapter_id_stage_idempotency_key_key" ON "generation_requests"("chapter_id", "stage", "idempotency_key");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_style_preset_id_fkey" FOREIGN KEY ("style_preset_id") REFERENCES "style_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_character_id_fkey" FOREIGN KEY ("from_character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_character_id_fkey" FOREIGN KEY ("to_character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bible_entities" ADD CONSTRAINT "bible_entities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_versions" ADD CONSTRAINT "chapter_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_memory" ADD CONSTRAINT "chapter_memory_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_memory" ADD CONSTRAINT "chapter_memory_extracted_from_version_id_fkey" FOREIGN KEY ("extracted_from_version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seeds" ADD CONSTRAINT "seeds_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consistency_reports" ADD CONSTRAINT "consistency_reports_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consistency_reports" ADD CONSTRAINT "consistency_reports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_context_snapshots" ADD CONSTRAINT "generation_context_snapshots_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_response_version_id_fkey" FOREIGN KEY ("response_version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_response_report_id_fkey" FOREIGN KEY ("response_report_id") REFERENCES "consistency_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

