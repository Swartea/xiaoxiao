ALTER TYPE "ChapterStatus" ADD VALUE IF NOT EXISTS 'blocked_review';

ALTER TABLE "chapters"
ADD COLUMN "review_block_reason" TEXT,
ADD COLUMN "review_block_meta" JSONB;
