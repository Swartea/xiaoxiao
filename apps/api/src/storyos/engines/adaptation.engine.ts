import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AdaptationType, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { AdaptChapterDto } from "../dto";

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class AdaptationEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async resolveVersion(chapterId: string, versionId?: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const version = versionId
      ? await this.prisma.chapterVersion.findFirst({ where: { id: versionId, chapter_id: chapterId } })
      : await this.prisma.chapterVersion.findFirst({ where: { chapter_id: chapterId }, orderBy: { version_no: "desc" } });

    if (!version) {
      throw new NotFoundException("Chapter version not found");
    }

    return { chapter, version };
  }

  private splitScenes(text: string) {
    return text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .slice(0, 12);
  }

  async novelToScript(chapterId: string, dto: AdaptChapterDto) {
    const { chapter, version } = await this.resolveVersion(chapterId, dto.version_id);
    const scenes = this.splitScenes(version.text).map((scene, idx) => ({
      scene_no: idx + 1,
      scene_goal: `推进第${idx + 1}场冲突`,
      scene_text: scene,
      dialogue_hint: scene.includes("：") ? "保留原对白并强化反应镜头" : "补充对白推动信息",
    }));

    const payload = {
      format: "script",
      title: dto.title ?? `第${chapter.chapter_no}章改编剧本`,
      target_platform: dto.target_platform ?? "short-drama",
      scenes,
    };

    const artifact = await this.prisma.adaptationArtifact.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        source_version_id: version.id,
        adaptation_type: AdaptationType.script,
        title: payload.title,
        content: toJson(payload),
      },
    });

    return {
      adaptation_id: artifact.id,
      ...payload,
    };
  }

  async novelToStoryboard(chapterId: string, dto: AdaptChapterDto) {
    const { chapter, version } = await this.resolveVersion(chapterId, dto.version_id);
    const scenes = this.splitScenes(version.text).map((scene, idx) => ({
      card_no: idx + 1,
      shot_type: idx % 3 === 0 ? "wide" : idx % 3 === 1 ? "medium" : "close-up",
      beat: scene.slice(0, 80),
      visual_focus: "动作显化情绪",
      dialogue: scene.includes("：") ? "保留关键对白" : "补 1 句推进对白",
    }));

    const payload = {
      format: "storyboard",
      title: dto.title ?? `第${chapter.chapter_no}章分镜卡`,
      target_platform: dto.target_platform ?? "short-drama",
      cards: scenes,
    };

    const artifact = await this.prisma.adaptationArtifact.create({
      data: {
        project_id: chapter.project_id,
        chapter_id: chapter.id,
        source_version_id: version.id,
        adaptation_type: AdaptationType.storyboard,
        title: payload.title,
        content: toJson(payload),
      },
    });

    return {
      adaptation_id: artifact.id,
      ...payload,
    };
  }

  chapterToShortDrama(chapterId: string, dto: AdaptChapterDto) {
    return this.novelToScript(chapterId, {
      ...dto,
      target_platform: dto.target_platform ?? "short-drama",
    });
  }

  async characterCardForImageGen(projectId: string) {
    const characters = await this.prisma.character.findMany({
      where: { project_id: projectId },
      orderBy: { created_at: "asc" },
      take: 12,
    });

    return characters.map((character) => ({
      name: character.name,
      visual_anchors: character.visual_anchors,
      personality_tags: character.personality_tags,
      current_status: character.current_status,
      prompt: `角色设定图：${character.name}，${character.visual_anchors ?? "外观待补"}，气质 ${character.personality_tags ?? "待补"}`,
    }));
  }

  sceneCardForComic(text: string) {
    return this.splitScenes(text).slice(0, 8).map((scene, idx) => ({
      scene_no: idx + 1,
      panel_count: 3,
      summary: scene.slice(0, 60),
      key_action: "每格推进一个动作或信息点",
    }));
  }
}
