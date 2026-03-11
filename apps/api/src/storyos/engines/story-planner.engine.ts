import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { ArcItemDto, CreateArcPlanDto, CreateBlueprintDto, CreateChapterIntentDto } from "../dto";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class StoryPlannerEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async ensureProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  async createStoryBlueprint(projectId: string, dto: CreateBlueprintDto) {
    const project = await this.ensureProject(projectId);
    const latest = await this.prisma.storyBlueprint.findFirst({
      where: { project_id: projectId },
      orderBy: { version_no: "desc" },
    });

    return this.prisma.storyBlueprint.create({
      data: {
        project_id: projectId,
        version_no: (latest?.version_no ?? 0) + 1,
        book_positioning: dto.book_positioning ?? `${project.title} 的平台化连载定位`,
        genre: dto.genre ?? project.genre ?? "未设定",
        selling_points: dto.selling_points ?? [],
        target_platform: dto.target_platform ?? project.target_platform ?? "webnovel",
        target_readers: dto.target_readers ?? "网文读者",
        pleasure_pacing: dto.pleasure_pacing ?? "每章冲突推进 + 章节尾钩",
        main_conflict: dto.main_conflict ?? "主线冲突待补全",
        core_suspense: dto.core_suspense ?? "核心悬念待补全",
        character_relation_map: toJson({ skeleton: "待补全" }),
        world_rule_map: toJson({ skeleton: "待补全" }),
        volume_structure: toJson([]),
        chapter_targets: toJson([]),
      },
    });
  }

  async generateBookStructure(projectId: string) {
    const blueprint = await this.prisma.storyBlueprint.findFirst({
      where: { project_id: projectId },
      orderBy: { version_no: "desc" },
    });

    if (!blueprint) {
      throw new NotFoundException("StoryBlueprint not found, call /projects/:id/blueprint first");
    }

    return {
      positioning: blueprint.book_positioning,
      target_platform: blueprint.target_platform,
      volume_structure: blueprint.volume_structure,
      chapter_targets: blueprint.chapter_targets,
    };
  }

  private normalizeArc(item: ArcItemDto) {
    return {
      arc_no: item.arc_no,
      title: item.title,
      summary: item.summary,
      mainline: item.mainline,
      subline: item.subline,
      pacing_profile: item.pacing_profile,
      chapter_range_start: item.chapter_range_start,
      chapter_range_end: item.chapter_range_end,
    };
  }

  async generateArcPlan(projectId: string, dto: CreateArcPlanDto) {
    await this.ensureProject(projectId);

    const arcs = dto.arcs.slice().sort((a, b) => a.arc_no - b.arc_no).map((item) => this.normalizeArc(item));

    await this.prisma.$transaction(async (tx) => {
      await tx.arcPlan.deleteMany({ where: { project_id: projectId } });
      if (arcs.length > 0) {
        await tx.arcPlan.createMany({
          data: arcs.map((arc) => ({
            project_id: projectId,
            ...arc,
            setup_payoff_map: toJson([]),
            twist_nodes: toJson([]),
          })),
        });
      }
    });

    return this.prisma.arcPlan.findMany({
      where: { project_id: projectId },
      orderBy: { arc_no: "asc" },
    });
  }

  async generateChapterIntent(chapterId: string, dto: CreateChapterIntentDto) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const latest = await this.prisma.chapterIntent.findFirst({
      where: { chapter_id: chapterId },
      orderBy: { version_no: "desc" },
    });

    return this.prisma.chapterIntent.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        version_no: (latest?.version_no ?? 0) + 1,
        chapter_mission: dto.chapter_mission,
        advance_goal: dto.advance_goal,
        conflict_target: dto.conflict_target,
        hook_target: dto.hook_target,
        pacing_direction: dto.pacing_direction,
        must_payoff_seed_ids: dto.must_payoff_seed_ids ?? [],
        notes: toJson({ source: "planner" }),
      },
    });
  }
}
