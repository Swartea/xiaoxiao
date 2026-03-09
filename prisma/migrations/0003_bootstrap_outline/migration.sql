-- CreateTable
CREATE TABLE "story_outline_nodes" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "phase_no" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "goal" TEXT,
  "conflict" TEXT,
  "milestone_chapter_no" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "story_outline_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_bootstrap_requests" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" "GenerationRequestStatus" NOT NULL,
  "response_chapter_id" UUID,
  "response_chapter_no" INTEGER,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_bootstrap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "story_outline_nodes_project_id_phase_no_key" ON "story_outline_nodes"("project_id", "phase_no");
CREATE INDEX "story_outline_nodes_project_id_idx" ON "story_outline_nodes"("project_id");
CREATE UNIQUE INDEX "project_bootstrap_requests_project_id_idempotency_key_key" ON "project_bootstrap_requests"("project_id", "idempotency_key");
CREATE INDEX "project_bootstrap_requests_project_id_idx" ON "project_bootstrap_requests"("project_id");

-- AddForeignKey
ALTER TABLE "story_outline_nodes"
ADD CONSTRAINT "story_outline_nodes_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_bootstrap_requests"
ADD CONSTRAINT "project_bootstrap_requests_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
