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

    const [latestVersion, versions, latestSnapshot, latestReport, latestMemory, latestQuality, qualityTrend, latestDirector, recentFixTasks, latestStoryContext] = await Promise.all([
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
      this.prisma.qualityReport.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.qualityReport.findMany({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
        take: 3,
      }),
      this.prisma.directorReview.findFirst({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.fixTask.findMany({
        where: { chapter_id: chapterId },
        orderBy: { created_at: "desc" },
        take: 8,
      }),
      this.prisma.contextSnapshot.findFirst({
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
      story_context_snapshot: latestStoryContext,
      continuity_report: latestReport,
      quality_report: latestQuality,
      director_review: latestDirector,
      fix_tasks: recentFixTasks,
      quality_trend: qualityTrend
        .slice()
        .reverse()
        .map((item) => ({ version_id: item.version_id, overall_score: item.overall_score })),
      chapter_memory: latestMemory,
      extracted_items: {
        facts,
        seeds,
        timeline,
      },
    };
  }
}
