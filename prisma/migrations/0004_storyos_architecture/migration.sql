-- CreateEnum
CREATE TYPE "PromptTemplateStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "PromptTemplateStage" AS ENUM ('beats', 'draft', 'polish', 'quality_eval', 'fix', 'director', 'adaptation');

-- CreateEnum
CREATE TYPE "FixTaskStatus" AS ENUM ('pending', 'applied', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "DirectorDecision" AS ENUM ('accept', 'fix', 'regenerate');

-- CreateEnum
CREATE TYPE "ExperimentType" AS ENUM ('prompt_ab', 'model_compare', 'retriever_compare');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "AdaptationType" AS ENUM ('script', 'storyboard', 'short_drama', 'character_card', 'scene_card');

-- AlterTable
ALTER TABLE "chapter_versions" ADD COLUMN     "is_best" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manual_accepted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "style_presets" ADD COLUMN     "dialogue_ratio_max" DOUBLE PRECISION,
ADD COLUMN     "dialogue_ratio_min" DOUBLE PRECISION,
ADD COLUMN     "ending_hook_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "exposition_limit" DOUBLE PRECISION,
ADD COLUMN     "favored_devices" TEXT[],
ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "opening_hook_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pacing_profile" TEXT,
ADD COLUMN     "paragraph_density" TEXT,
ADD COLUMN     "sentence_length" TEXT,
ADD COLUMN     "taboo_rules" TEXT[],
ADD COLUMN     "target_platform" TEXT;

-- CreateTable
CREATE TABLE "story_blueprints" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "book_positioning" TEXT,
    "genre" TEXT,
    "selling_points" TEXT[],
    "target_platform" TEXT,
    "target_readers" TEXT,
    "pleasure_pacing" TEXT,
    "main_conflict" TEXT,
    "core_suspense" TEXT,
    "character_relation_map" JSONB,
    "world_rule_map" JSONB,
    "volume_structure" JSONB,
    "chapter_targets" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_blueprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arc_plans" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "arc_no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "mainline" TEXT,
    "subline" TEXT,
    "pacing_profile" TEXT,
    "setup_payoff_map" JSONB,
    "twist_nodes" JSONB,
    "chapter_range_start" INTEGER,
    "chapter_range_end" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arc_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapter_intents" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "chapter_mission" TEXT NOT NULL,
    "advance_goal" TEXT,
    "conflict_target" TEXT,
    "hook_target" TEXT,
    "pacing_direction" TEXT,
    "must_payoff_seed_ids" TEXT[],
    "notes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapter_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_templates" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "prompt_name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "status" "PromptTemplateStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_template_versions" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "prompt_template_id" UUID NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "stage" "PromptTemplateStage" NOT NULL,
    "platform_variant" TEXT,
    "template" TEXT NOT NULL,
    "ab_bucket" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "opening_hook" DOUBLE PRECISION NOT NULL,
    "conflict_strength" DOUBLE PRECISION NOT NULL,
    "pacing" DOUBLE PRECISION NOT NULL,
    "dialogue_quality" DOUBLE PRECISION NOT NULL,
    "character_voice" DOUBLE PRECISION NOT NULL,
    "scene_vividness" DOUBLE PRECISION NOT NULL,
    "exposition_control" DOUBLE PRECISION NOT NULL,
    "ending_hook" DOUBLE PRECISION NOT NULL,
    "platform_fit" DOUBLE PRECISION NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "summary" TEXT,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "continuity_reports" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "world_rule_conflict" JSONB,
    "timeline_conflict" JSONB,
    "relationship_conflict" JSONB,
    "character_ooc" JSONB,
    "seed_payoff_miss" JSONB,
    "overall_pass" BOOLEAN NOT NULL DEFAULT true,
    "report" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "continuity_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fix_tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "base_version_id" UUID NOT NULL,
    "target_version_id" UUID,
    "issue_type" TEXT NOT NULL,
    "fix_goal" TEXT NOT NULL,
    "keep_elements" TEXT[],
    "forbidden_changes" TEXT[],
    "target_intensity" TEXT NOT NULL,
    "strategy" TEXT,
    "status" "FixTaskStatus" NOT NULL DEFAULT 'pending',
    "input_payload" JSONB,
    "result_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fix_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "director_reviews" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "decision" "DirectorDecision" NOT NULL,
    "should_regenerate" BOOLEAN NOT NULL DEFAULT false,
    "fix_plan" JSONB,
    "pacing_direction" TEXT,
    "hook_upgrade" TEXT,
    "arc_correction" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_runs" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "experiment_type" "ExperimentType" NOT NULL,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'pending',
    "variant_a" JSONB,
    "variant_b" JSONB,
    "quality_score_a" DOUBLE PRECISION,
    "quality_score_b" DOUBLE PRECISION,
    "manual_score_a" DOUBLE PRECISION,
    "manual_score_b" DOUBLE PRECISION,
    "winner" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_variants" (
    "id" UUID NOT NULL,
    "experiment_run_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prompt_template_version_id" UUID,
    "generated_version_id" UUID,
    "model" TEXT,
    "retriever_strategy" TEXT,
    "quality_score" DOUBLE PRECISION,
    "manual_score" DOUBLE PRECISION,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_snapshots" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "retriever_strategy" TEXT NOT NULL,
    "tags" TEXT[],
    "context_brief" JSONB NOT NULL,
    "context_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "context_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID,
    "version_id" UUID,
    "agent_name" TEXT NOT NULL,
    "prompt_version" TEXT,
    "model" TEXT,
    "style_preset" TEXT,
    "retriever_strategy" TEXT,
    "context_hash" TEXT,
    "token_usage" JSONB,
    "quality_score" DOUBLE PRECISION,
    "input_payload" JSONB,
    "output_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adaptation_artifacts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "chapter_id" UUID NOT NULL,
    "source_version_id" UUID,
    "adaptation_type" "AdaptationType" NOT NULL,
    "title" TEXT,
    "content" JSONB NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adaptation_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "story_blueprints_project_id_idx" ON "story_blueprints"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_blueprints_project_id_version_no_key" ON "story_blueprints"("project_id", "version_no");

-- CreateIndex
CREATE INDEX "arc_plans_project_id_idx" ON "arc_plans"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "arc_plans_project_id_arc_no_key" ON "arc_plans"("project_id", "arc_no");

-- CreateIndex
CREATE INDEX "chapter_intents_project_id_chapter_id_idx" ON "chapter_intents"("project_id", "chapter_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapter_intents_chapter_id_version_no_key" ON "chapter_intents"("chapter_id", "version_no");

-- CreateIndex
CREATE INDEX "prompt_templates_project_id_idx" ON "prompt_templates"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_templates_project_id_prompt_name_key" ON "prompt_templates"("project_id", "prompt_name");

-- CreateIndex
CREATE INDEX "prompt_template_versions_project_id_stage_idx" ON "prompt_template_versions"("project_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_template_versions_prompt_template_id_prompt_version_key" ON "prompt_template_versions"("prompt_template_id", "prompt_version");

-- CreateIndex
CREATE INDEX "quality_reports_chapter_id_created_at_idx" ON "quality_reports"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "continuity_reports_chapter_id_created_at_idx" ON "continuity_reports"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "fix_tasks_chapter_id_created_at_idx" ON "fix_tasks"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "director_reviews_chapter_id_created_at_idx" ON "director_reviews"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "experiment_runs_chapter_id_created_at_idx" ON "experiment_runs"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "experiment_variants_experiment_run_id_idx" ON "experiment_variants"("experiment_run_id");

-- CreateIndex
CREATE INDEX "context_snapshots_chapter_id_created_at_idx" ON "context_snapshots"("chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_project_id_chapter_id_created_at_idx" ON "agent_runs"("project_id", "chapter_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_run_id_idx" ON "agent_runs"("run_id");

-- CreateIndex
CREATE INDEX "adaptation_artifacts_chapter_id_adaptation_type_created_at_idx" ON "adaptation_artifacts"("chapter_id", "adaptation_type", "created_at");

-- AddForeignKey
ALTER TABLE "story_blueprints" ADD CONSTRAINT "story_blueprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arc_plans" ADD CONSTRAINT "arc_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_intents" ADD CONSTRAINT "chapter_intents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapter_intents" ADD CONSTRAINT "chapter_intents_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_template_versions" ADD CONSTRAINT "prompt_template_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_template_versions" ADD CONSTRAINT "prompt_template_versions_prompt_template_id_fkey" FOREIGN KEY ("prompt_template_id") REFERENCES "prompt_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuity_reports" ADD CONSTRAINT "continuity_reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuity_reports" ADD CONSTRAINT "continuity_reports_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "continuity_reports" ADD CONSTRAINT "continuity_reports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_tasks" ADD CONSTRAINT "fix_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_tasks" ADD CONSTRAINT "fix_tasks_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_tasks" ADD CONSTRAINT "fix_tasks_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fix_tasks" ADD CONSTRAINT "fix_tasks_target_version_id_fkey" FOREIGN KEY ("target_version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "director_reviews" ADD CONSTRAINT "director_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "director_reviews" ADD CONSTRAINT "director_reviews_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "director_reviews" ADD CONSTRAINT "director_reviews_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_runs" ADD CONSTRAINT "experiment_runs_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_run_id_fkey" FOREIGN KEY ("experiment_run_id") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_prompt_template_version_id_fkey" FOREIGN KEY ("prompt_template_version_id") REFERENCES "prompt_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_generated_version_id_fkey" FOREIGN KEY ("generated_version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_snapshots" ADD CONSTRAINT "context_snapshots_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_snapshots" ADD CONSTRAINT "context_snapshots_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptation_artifacts" ADD CONSTRAINT "adaptation_artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptation_artifacts" ADD CONSTRAINT "adaptation_artifacts_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adaptation_artifacts" ADD CONSTRAINT "adaptation_artifacts_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "chapter_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

