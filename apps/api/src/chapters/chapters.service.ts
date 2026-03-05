import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { diffLines } from "diff";
import { createHash } from "node:crypto";
import { Prisma, VersionStage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreateChapterDto, RollbackChapterDto } from "./dto";

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

@Injectable()
export class ChaptersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createChapter(projectId: string, dto: CreateChapterDto) {
    return this.prisma.chapter.create({
      data: {
        project_id: projectId,
        chapter_no: dto.chapter_no,
        title: dto.title,
        goal: dto.goal,
        conflict: dto.conflict,
        twist: dto.twist,
        cliffhanger: dto.cliffhanger,
        word_target: dto.word_target,
        status: dto.status,
      },
    });
  }

  listProjectChapters(projectId: string) {
    return this.prisma.chapter.findMany({
      where: { project_id: projectId },
      orderBy: { chapter_no: "asc" },
    });
  }

  async getChapter(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: {
        versions: {
          orderBy: { version_no: "desc" },
          take: 5,
        },
        memories: {
          orderBy: { created_at: "desc" },
          take: 1,
        },
      },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    return chapter;
  }

  getVersions(chapterId: string) {
    return this.prisma.chapterVersion.findMany({
      where: { chapter_id: chapterId },
      orderBy: { version_no: "desc" },
    });
  }

  async getVersionDiff(chapterId: string, fromVersionId: string, toVersionId: string) {
    const versions = await this.prisma.chapterVersion.findMany({
      where: {
        chapter_id: chapterId,
        id: { in: [fromVersionId, toVersionId] },
      },
    });

    const from = versions.find((v) => v.id === fromVersionId);
    const to = versions.find((v) => v.id === toVersionId);

    if (!from || !to) {
      throw new NotFoundException("Version not found");
    }

    const changes = diffLines(from.text, to.text).map((entry: { added?: boolean; removed?: boolean; value: string }) => ({
      added: !!entry.added,
      removed: !!entry.removed,
      value: entry.value,
    }));

    return {
      from_version_id: fromVersionId,
      to_version_id: toVersionId,
      changes,
    };
  }

  async rollback(chapterId: string, dto: RollbackChapterDto) {
    return this.prisma.$transaction(async (tx) => {
      const chapter = await tx.chapter.findUnique({ where: { id: chapterId } });
      if (!chapter) {
        throw new NotFoundException("Chapter not found");
      }

      const target = await tx.chapterVersion.findFirst({
        where: { id: dto.version_id, chapter_id: chapterId },
      });
      if (!target) {
        throw new NotFoundException("Target version not found");
      }

      const maxVersionRow = await tx.$queryRaw<Array<{ max_version: number | null }>>(
        Prisma.sql`SELECT MAX(version_no)::int AS max_version FROM chapter_versions WHERE chapter_id = ${chapterId}::uuid FOR UPDATE`,
      );
      const nextVersionNo = (maxVersionRow[0]?.max_version ?? 0) + 1;

      const rollbackVersion = await tx.chapterVersion.create({
        data: {
          chapter_id: chapterId,
          version_no: nextVersionNo,
          stage: VersionStage.fix,
          text: target.text,
          text_hash: textHash(target.text),
          parent_version_id: target.id,
          meta: {
            reason: "rollback",
            rolled_back_from_version_id: target.id,
          },
        },
      });

      return rollbackVersion;
    });
  }
}
