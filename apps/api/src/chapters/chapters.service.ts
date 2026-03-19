import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { diffLines } from "diff";
import { createHash } from "node:crypto";
import { ChapterStatus, Prisma, VersionStage } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { CreateChapterDto, ImportChaptersDto, RollbackChapterDto, UpdateChapterReviewBlockDto } from "./dto";
import { isBlockedReviewChapter, normalizeReviewBlockMeta, resolveReviewResumeStatus, type ReviewBlockSource } from "./review-block";
import { DEFAULT_CHAPTER_WORD_TARGET } from "./chapter-length";

type ImportedChapterInput = {
  chapter_no?: number;
  title?: string;
  text: string;
  stage?: VersionStage;
};

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

function pickMetaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function excerptText(value: string | null, maxLength = 120): string | null {
  if (!value) {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function parseImportedChapterHeader(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const lines = normalized.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const match = firstLine.match(/^第\s*(\d+)\s*章(?:\s*[·.、\-：:]\s*|\s+)?(.*)$/i);
  if (!match) {
    return {
      chapterNo: null as number | null,
      title: null as string | null,
      body: normalized,
    };
  }

  const chapterNo = Number.parseInt(match[1] ?? "", 10);
  const title = (match[2] ?? "").trim() || null;
  const body = lines.slice(1).join("\n").trim() || normalized;
  return {
    chapterNo: Number.isFinite(chapterNo) ? chapterNo : null,
    title,
    body,
  };
}

function parseVersionStage(value: unknown): VersionStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return Object.values(VersionStage).includes(value as VersionStage) ? (value as VersionStage) : undefined;
}

function parseRawImportText(rawText: string): ImportedChapterInput[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          chapter_no: typeof item.chapter_no === "number" ? item.chapter_no : undefined,
          title: typeof item.title === "string" ? item.title : undefined,
          text: typeof item.text === "string" ? item.text : "",
          stage: parseVersionStage(item.stage),
        }))
        .filter((item) => item.text.trim().length > 0);
    }
  } catch {
    // fall through to plaintext parser
  }

  const blocks = normalized
    .split(/\n(?=第\s*\d+\s*章)/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const parsed = parseImportedChapterHeader(block);
    return {
      chapter_no: parsed.chapterNo ?? undefined,
      title: parsed.title ?? undefined,
      text: parsed.body.trim() || block,
    };
  });
}

@Injectable()
export class ChaptersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveChapterForMutation(chapterId: string) {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }
    return chapter;
  }

  assertAutomationAllowed(chapter: {
    id: string;
    status: ChapterStatus;
    review_block_reason: string | null;
    review_block_meta: Prisma.JsonValue | null;
  }, actionLabel: string) {
    if (!isBlockedReviewChapter(chapter)) {
      return;
    }

    const meta = normalizeReviewBlockMeta(chapter.review_block_meta);
    const reason = chapter.review_block_reason ?? "当前章节处于 blocked_review。";
    const source = meta?.source ? `来源：${meta.source}` : "";
    throw new ConflictException([reason, source, `请先人工处理并解除阻断，再执行${actionLabel}。`].filter(Boolean).join(" "));
  }

  async blockChapterReview(args: {
    chapterId: string;
    reason: string;
    source: ReviewBlockSource;
    details?: string[];
    versionId?: string | null;
    reportId?: string | null;
    directorReviewId?: string | null;
  }) {
    const chapter = await this.resolveChapterForMutation(args.chapterId);
    const currentMeta = normalizeReviewBlockMeta(chapter.review_block_meta);
    const previousStatus =
      chapter.status === ChapterStatus.blocked_review ? currentMeta?.previous_status ?? ChapterStatus.draft : chapter.status;

    return this.prisma.chapter.update({
      where: { id: chapter.id },
      data: {
        status: ChapterStatus.blocked_review,
        review_block_reason: args.reason,
        review_block_meta: {
          source: args.source,
          previous_status: previousStatus,
          version_id: args.versionId ?? null,
          report_id: args.reportId ?? null,
          director_review_id: args.directorReviewId ?? null,
          details: args.details ?? [],
          blocked_at: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
  }

  async updateReviewBlock(chapterId: string, dto: UpdateChapterReviewBlockDto) {
    const chapter = await this.resolveChapterForMutation(chapterId);

    if (dto.blocked) {
      return this.blockChapterReview({
        chapterId: chapter.id,
        reason: dto.reason ?? "人工挂起，等待审查。",
        source: dto.source ?? "manual",
        details: dto.details ?? [],
        versionId: dto.version_id ?? null,
      });
    }

    return this.prisma.chapter.update({
      where: { id: chapter.id },
      data: {
        status: resolveReviewResumeStatus(chapter.review_block_meta, ChapterStatus.draft),
        review_block_reason: null,
        review_block_meta: Prisma.JsonNull,
      },
    });
  }

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
        word_target: dto.word_target ?? DEFAULT_CHAPTER_WORD_TARGET,
        status: dto.status,
      },
    });
  }

  async importChapters(projectId: string, dto: ImportChaptersDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const inputEntries = [
      ...(Array.isArray(dto.entries) ? dto.entries : []),
      ...parseRawImportText(dto.raw_text ?? ""),
    ];

    const sanitizedEntries = inputEntries
      .map((entry, index) => {
        const parsed = parseImportedChapterHeader(entry.text);
        const text = (parsed.body || entry.text || "").trim();
        const chapterNo =
          typeof entry.chapter_no === "number" && Number.isFinite(entry.chapter_no)
            ? entry.chapter_no
            : parsed.chapterNo ?? index + 1;
        const title = (entry.title ?? parsed.title ?? "").trim() || undefined;
        const stage = (entry.stage ?? dto.default_stage ?? "draft") as VersionStage;
        return { chapter_no: chapterNo, title, text, stage };
      })
      .filter((entry) => entry.text.length > 0)
      .sort((a, b) => a.chapter_no - b.chapter_no);

    if (sanitizedEntries.length === 0) {
      throw new BadRequestException("请提供要导入的章节文本");
    }

    const seen = new Set<string>();
    const dedupedEntries = sanitizedEntries.filter((entry) => {
      const key = `${entry.chapter_no}:${textHash(entry.text)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    const chapterNos = dedupedEntries.map((entry) => entry.chapter_no);
    const existingChapters = await this.prisma.chapter.findMany({
      where: { project_id: projectId, chapter_no: { in: chapterNos } },
      include: {
        versions: {
          orderBy: { version_no: "desc" },
          take: 1,
        },
      },
    });
    const existingByNo = new Map(existingChapters.map((chapter) => [chapter.chapter_no, chapter]));

    const imported: Array<{ chapter_id: string; chapter_no: number; title?: string; version_id: string; skipped?: boolean }> = [];

    await this.prisma.$transaction(async (tx) => {
      for (const entry of dedupedEntries) {
        const existing = existingByNo.get(entry.chapter_no);
        const existingLatest = existing?.versions?.[0];
        const nextVersionNo = existingLatest ? existingLatest.version_no + 1 : 1;
        const currentTextHash = textHash(entry.text);

        if (existing && existingLatest?.text_hash === currentTextHash) {
          imported.push({
            chapter_id: existing.id,
            chapter_no: existing.chapter_no,
            title: existing.title ?? entry.title,
            version_id: existingLatest.id,
            skipped: true,
          });
          continue;
        }

        const chapter = existing
          ? await tx.chapter.update({
              where: { id: existing.id },
              data: {
                title: existing.title ?? entry.title,
                status: entry.stage === VersionStage.polish ? ChapterStatus.final : ChapterStatus.draft,
              },
            })
          : await tx.chapter.create({
              data: {
                project_id: projectId,
                chapter_no: entry.chapter_no,
                title: entry.title,
                goal: entry.title ? `延续“${entry.title}”章节目标并保持剧情一致` : undefined,
                status: entry.stage === VersionStage.polish ? ChapterStatus.final : ChapterStatus.draft,
                word_target: DEFAULT_CHAPTER_WORD_TARGET,
              },
            });

        const version = await tx.chapterVersion.create({
          data: {
            chapter_id: chapter.id,
            version_no: existing ? nextVersionNo : 1,
            stage: entry.stage,
            text: entry.text,
            text_hash: currentTextHash,
            parent_version_id: existingLatest?.id ?? null,
            meta: {
              source: "chapter_import",
              imported_at: new Date().toISOString(),
              imported_title: entry.title ?? null,
            },
          },
        });

        imported.push({
          chapter_id: chapter.id,
          chapter_no: chapter.chapter_no,
          title: chapter.title ?? entry.title,
          version_id: version.id,
        });
      }
    });

    return {
      project_id: projectId,
      imported_count: imported.filter((item) => !item.skipped).length,
      skipped_count: imported.filter((item) => item.skipped).length,
      chapters: imported.sort((a, b) => a.chapter_no - b.chapter_no),
    };
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

    const title = targetOutlineNode?.title ? targetOutlineNode.title : "承接推进";
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
            word_target: existingChapter2.word_target ?? chapter1.word_target ?? DEFAULT_CHAPTER_WORD_TARGET,
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
          word_target: chapter1.word_target ?? DEFAULT_CHAPTER_WORD_TARGET,
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

      return versions.map((version) => ({
        id: version.id,
        version_no: version.version_no,
        stage: version.stage,
        created_at: version.created_at,
        parent_version_id: version.parent_version_id,
        fix_mode: pickMetaString(version.meta, "mode"),
        strategy_id: pickMetaString(version.meta, "strategy_id"),
        instruction_excerpt: excerptText(pickMetaString(version.meta, "instruction")),
      }));
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
