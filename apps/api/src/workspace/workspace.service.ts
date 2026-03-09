import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

@Injectable()
export class WorkspaceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getWorkspace(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { project: true },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const [latestVersion, versions, latestSnapshot, latestReport, latestMemory] = await Promise.all([
      this.prisma.chapterVersion.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
        select: {
          id: true,
          version_no: true,
          stage: true,
          created_at: true,
        },
      }),
      this.prisma.chapterVersion.findMany({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
        select: {
          id: true,
          version_no: true,
          stage: true,
          created_at: true,
        },
      }),
      this.prisma.generationContextSnapshot.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.consistencyReport.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.chapterMemory.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
    ]);

    const sourceVersionId = latestVersion?.id;

    const [facts, seeds, timeline] = await Promise.all([
      sourceVersionId
        ? this.prisma.fact.findMany({ where: { source_version_id: sourceVersionId }, orderBy: { content: "asc" } })
        : Promise.resolve([]),
      sourceVersionId
        ? this.prisma.seed.findMany({ where: { source_version_id: sourceVersionId }, orderBy: { content: "asc" } })
        : Promise.resolve([]),
      sourceVersionId
        ? this.prisma.timelineEvent.findMany({
            where: { source_version_id: sourceVersionId },
            orderBy: { chapter_no_ref: "asc" },
          })
        : Promise.resolve([]),
    ]);

    return {
      chapter,
      latest_version: latestVersion,
      versions,
      generation_context_snapshot: latestSnapshot,
      continuity_report: latestReport,
      chapter_memory: latestMemory,
      extracted_items: {
        facts,
        seeds,
        timeline,
      },
    };
  }
}
