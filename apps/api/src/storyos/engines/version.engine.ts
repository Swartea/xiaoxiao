import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, VersionStage, type Prisma as PrismaTypes } from "@prisma/client";
import { createHash } from "node:crypto";
import { ChaptersService } from "../../chapters/chapters.service";
import { PrismaService } from "../../prisma.service";

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toJson(value: unknown): PrismaTypes.NullableJsonNullValueInput | PrismaTypes.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as PrismaTypes.InputJsonValue;
}

@Injectable()
export class VersionEngine {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChaptersService) private readonly chaptersService: ChaptersService,
  ) {}

  private async createVersion(args: {
    chapterId: string;
    text: string;
    stage: VersionStage;
    sourceStage: string;
    promptTemplateVersion?: string;
    model?: string;
    stylePreset?: string;
    qualityScore?: number;
    parentVersionId?: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM chapters WHERE id = ${args.chapterId}::uuid FOR UPDATE`);
      const maxVersionRow = await tx.$queryRaw<Array<{ max_version: number | null }>>(
        Prisma.sql`SELECT MAX(version_no)::int AS max_version FROM chapter_versions WHERE chapter_id = ${args.chapterId}::uuid`,
      );
      const nextVersionNo = (maxVersionRow[0]?.max_version ?? 0) + 1;

      return tx.chapterVersion.create({
        data: {
          chapter_id: args.chapterId,
          version_no: nextVersionNo,
          stage: args.stage,
          text: args.text,
          text_hash: textHash(args.text),
          parent_version_id: args.parentVersionId ?? null,
          meta: toJson({
            source_stage: args.sourceStage,
            prompt_template_version: args.promptTemplateVersion ?? null,
            model: args.model ?? null,
            style_preset: args.stylePreset ?? null,
            quality_score: args.qualityScore ?? null,
            manual_accepted: false,
          }),
        },
      });
    });
  }

  saveDraftVersion(args: {
    chapterId: string;
    text: string;
    promptTemplateVersion?: string;
    model?: string;
    stylePreset?: string;
    qualityScore?: number;
    parentVersionId?: string | null;
  }) {
    return this.createVersion({
      ...args,
      stage: VersionStage.draft,
      sourceStage: "draft",
    });
  }

  savePolishVersion(args: {
    chapterId: string;
    text: string;
    promptTemplateVersion?: string;
    model?: string;
    stylePreset?: string;
    qualityScore?: number;
    parentVersionId?: string | null;
  }) {
    return this.createVersion({
      ...args,
      stage: VersionStage.polish,
      sourceStage: "polish",
    });
  }

  saveFixedVersion(args: {
    chapterId: string;
    text: string;
    promptTemplateVersion?: string;
    model?: string;
    stylePreset?: string;
    qualityScore?: number;
    parentVersionId?: string | null;
  }) {
    return this.createVersion({
      ...args,
      stage: VersionStage.fix,
      sourceStage: "fix",
    });
  }

  diffVersions(chapterId: string, fromVersionId: string, toVersionId: string) {
    return this.chaptersService.getVersionDiff(chapterId, fromVersionId, toVersionId);
  }

  rollbackVersion(chapterId: string, versionId: string) {
    return this.chaptersService.rollback(chapterId, { version_id: versionId });
  }

  async tagBestVersion(chapterId: string, versionId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.chapterVersion.updateMany({
        where: { chapter_id: chapterId },
        data: { is_best: false },
      });

      await tx.chapterVersion.update({
        where: { id: versionId },
        data: { is_best: true },
      });
    });

    return { chapter_id: chapterId, version_id: versionId, tagged: true };
  }
}
