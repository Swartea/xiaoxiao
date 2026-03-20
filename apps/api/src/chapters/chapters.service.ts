import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { diffLines } from "diff";
import { createHash } from "node:crypto";
import { Prisma, VersionStage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreateChapterDto, RollbackChapterDto } from "./dto";
import { summarizeVersionMeta } from "./version-meta.util";

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function extractNumericAnchors(text: string, limit = 16): string[] {
  const matches = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const unique: string[] = [];
  for (const value of matches) {
    if (!unique.includes(value)) {
      unique.push(value);
    }
    if (unique.length >= limit) {
      break;
    }
  }
  return unique;
}

function compactSummaryFromText(text: string, maxLength = 220): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, maxLength) || "请根据上一章正文补充摘要。";
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
        word_target: dto.word_target ?? 4000,
        status: dto.status,
      },
    });
  }

  async createSecondChapterTemplate(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const chapter1 = await this.prisma.chapter.findFirst({
      where: { project_id: projectId, chapter_no: 1 },
    });
    if (!chapter1) {
      throw new BadRequestException("请先创建并生成第1章，再创建第2章衔接模板");
    }

    const existingChapter2 = await this.prisma.chapter.findFirst({
      where: { project_id: projectId, chapter_no: 2 },
    });

    const [latestV1, latestMemory, outlineNodes] = await Promise.all([
      this.prisma.chapterVersion.findFirst({
        where: { chapter_id: chapter1.id },
        orderBy: { version_no: "desc" },
      }),
      this.prisma.chapterMemory.findFirst({
        where: { chapter_id: chapter1.id },
        orderBy: { created_at: "desc" },
      }),
      this.prisma.storyOutlineNode.findMany({
        where: { project_id: projectId },
        orderBy: { phase_no: "asc" },
      }),
    ]);

    const targetOutlineNode =
      outlineNodes.find((node) => (node.milestone_chapter_no ?? Number.MAX_SAFE_INTEGER) >= 2) ?? outlineNodes[0];
    const memoryMatchesLatest = latestMemory?.extracted_from_version_id === latestV1?.id;
    const chapter1Summary = compactSummaryFromText(latestV1?.text ?? "", 120);
    const lastScene = memoryMatchesLatest && Array.isArray(latestMemory?.scene_list)
      ? (latestMemory?.scene_list as Array<{ summary?: string; purpose?: string }>).at(-1)
      : undefined;
    const tailFallback = compactSummaryFromText((latestV1?.text ?? "").slice(-800), 180);
    const numericAnchors = extractNumericAnchors(latestV1?.text ?? "");

    const title = targetOutlineNode?.title ? `第2章 ${targetOutlineNode.title}` : "第2章 承接推进";
    const goal = targetOutlineNode?.goal ?? "承接第一章结尾并推动新的行动目标";
    const conflict = targetOutlineNode?.conflict ?? "延续上一章冲突，并抬高代价";
    const templateText = [
      "# 第2章 场景骨架（自动衔接模板）",
      "",
      "## 1) 上章承接",
      `- 上章收束：${chapter1Summary}`,
      `- 关键尾场：${lastScene?.summary ?? lastScene?.purpose ?? tailFallback}`,
      "",
      "## 2) 本章推进目标",
      `- 章节目标：${goal}`,
      `- 核心冲突：${conflict}`,
      `- 阶段主轴：${targetOutlineNode?.summary ?? "围绕主线继续推进，避免支线发散。"}`,
      "",
      "## 3) 建议节拍",
      "1. 承接场：延续第1章最后动作/情绪，不跳时空。",
      "2. 施压场：引入更高难度阻碍或代价。",
      "3. 反制场：主角尝试行动但留下新隐患。",
      "4. 收束场：给出下一章钩子（cliffhanger）。",
      "",
      "## 4) 数字与硬信息锚点（默认保持不变）",
      ...(numericAnchors.length > 0 ? numericAnchors.map((n) => `- ${n}`) : ["- 暂无可识别数字锚点"]),
      "",
      "## 5) 写作提醒",
      "- 本模板是 beats 草稿，可直接点“生成 draft”。",
      "- 若需改节奏，先调整本骨架再生成初稿。",
    ].join("\n");

    if (existingChapter2) {
      return this.prisma.$transaction(async (tx) => {
        await tx.chapter.update({
          where: { id: existingChapter2.id },
          data: {
            title,
            goal,
            conflict,
            word_target: existingChapter2.word_target ?? chapter1.word_target ?? 4000,
          },
        });

        await tx.$queryRaw(Prisma.sql`SELECT id FROM chapters WHERE id = ${existingChapter2.id}::uuid FOR UPDATE`);
        const maxVersionRow = await tx.$queryRaw<Array<{ max_version: number | null }>>(
          Prisma.sql`SELECT MAX(version_no)::int AS max_version FROM chapter_versions WHERE chapter_id = ${existingChapter2.id}::uuid`,
        );
        const nextVersionNo = (maxVersionRow[0]?.max_version ?? 0) + 1;
        const parentVersion = await tx.chapterVersion.findFirst({
          where: { chapter_id: existingChapter2.id },
          orderBy: { version_no: "desc" },
        });

        const version = await tx.chapterVersion.create({
          data: {
            chapter_id: existingChapter2.id,
            version_no: nextVersionNo,
            stage: VersionStage.beats,
            text: templateText,
            text_hash: textHash(templateText),
            parent_version_id: parentVersion?.id ?? latestV1?.id ?? null,
            meta: {
              source: "second_chapter_template_refresh",
              from_chapter_no: 1,
              from_version_no: latestV1?.version_no ?? null,
              outline_node_id: targetOutlineNode?.id ?? null,
              numeric_anchors: numericAnchors,
            },
          },
        });

        return {
          replay: false,
          refreshed: true,
          chapter_id: existingChapter2.id,
          chapter_no: existingChapter2.chapter_no,
          version_id: version.id,
          workspace_path: `/projects/${projectId}/chapters/${existingChapter2.chapter_no}/workspace`,
        };
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const chapter2 = await tx.chapter.create({
        data: {
          project_id: projectId,
          chapter_no: 2,
          title,
          goal,
          conflict,
          word_target: chapter1.word_target ?? 4000,
          status: "outline",
        },
      });

      const version = await tx.chapterVersion.create({
        data: {
          chapter_id: chapter2.id,
          version_no: 1,
          stage: VersionStage.beats,
          text: templateText,
          text_hash: textHash(templateText),
          parent_version_id: latestV1?.id ?? null,
          meta: {
            source: "second_chapter_template",
            from_chapter_no: 1,
            from_version_no: latestV1?.version_no ?? null,
            outline_node_id: targetOutlineNode?.id ?? null,
            numeric_anchors: numericAnchors,
          },
        },
      });

      return {
        replay: false,
        chapter_id: chapter2.id,
        chapter_no: chapter2.chapter_no,
        version_id: version.id,
        workspace_path: `/projects/${projectId}/chapters/2/workspace`,
      };
    });
  }

  listProjectChapters(projectId: string) {
    return this.prisma.chapter.findMany({
      where: { project_id: projectId },
      orderBy: { chapter_no: "asc" },
    });
  }

  async getChapterByNo(projectId: string, chapterNo: number) {
    const chapter = await this.prisma.chapter.findFirst({
      where: {
        project_id: projectId,
        chapter_no: chapterNo,
      },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    return chapter;
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

  async getVersions(chapterId: string, options?: { metaOnly?: boolean }) {
    if (options?.metaOnly) {
      const versions = await this.prisma.chapterVersion.findMany({
        where: { chapter_id: chapterId },
        orderBy: { version_no: "desc" },
        select: {
          id: true,
          version_no: true,
          stage: true,
          created_at: true,
          parent_version_id: true,
          meta: true,
        },
      });

      return versions.map((version) => summarizeVersionMeta(version));
    }

    return this.prisma.chapterVersion.findMany({
      where: { chapter_id: chapterId },
      orderBy: { version_no: "desc" },
    });
  }

  async getVersion(chapterId: string, versionId: string) {
    const version = await this.prisma.chapterVersion.findFirst({
      where: { id: versionId, chapter_id: chapterId },
    });
    if (!version) {
      throw new NotFoundException("Version not found");
    }
    return version;
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

      await tx.$queryRaw(Prisma.sql`SELECT id FROM chapters WHERE id = ${chapterId}::uuid FOR UPDATE`);
      const maxVersionRow = await tx.$queryRaw<Array<{ max_version: number | null }>>(
        Prisma.sql`SELECT MAX(version_no)::int AS max_version FROM chapter_versions WHERE chapter_id = ${chapterId}::uuid`,
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
