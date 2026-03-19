import { ExtractedStatus, PrismaClient } from "@prisma/client";
import { isLikelyFactNoise, normalizeFactCandidateContent } from "@novel-factory/memory";

type FactRow = {
  id: string;
  project_id: string;
  chapter_no: number;
  content: string;
  status: ExtractedStatus;
  source_version_id: string;
  sourceVersion: { version_no: number } | null;
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.slice(2).split("=");
    args.set(key, value ?? true);
  }
  return {
    dryRun: args.get("dry-run") === true,
    projectId: typeof args.get("project-id") === "string" ? String(args.get("project-id")) : undefined,
  };
}

async function main() {
  const prisma = new PrismaClient();
  const { dryRun, projectId } = parseArgs(process.argv.slice(2));

  try {
    const facts = (await prisma.fact.findMany({
      where: {
        status: { in: [ExtractedStatus.confirmed, ExtractedStatus.extracted] },
        ...(projectId ? { project_id: projectId } : {}),
      },
      select: {
        id: true,
        project_id: true,
        chapter_no: true,
        content: true,
        status: true,
        source_version_id: true,
        sourceVersion: {
          select: {
            version_no: true,
          },
        },
      },
      orderBy: [{ project_id: "asc" }, { chapter_no: "asc" }, { id: "asc" }],
    })) as FactRow[];

    const chapterKeys = Array.from(new Set(facts.map((fact) => `${fact.project_id}:${fact.chapter_no}`)));
    const latestTextByChapter = new Map<string, string>();

    await Promise.all(
      chapterKeys.map(async (key) => {
        const [factProjectId, rawChapterNo] = key.split(":");
        const latest = await prisma.chapterVersion.findFirst({
          where: {
            chapter: {
              project_id: factProjectId,
              chapter_no: Number(rawChapterNo),
            },
          },
          orderBy: { version_no: "desc" },
          select: { text: true },
        });
        latestTextByChapter.set(key, latest?.text ?? "");
      }),
    );

    const rejectIds = new Set<string>();
    const supersedeIds = new Set<string>();

    for (const key of chapterKeys) {
      const chapterFacts = facts.filter((fact) => `${fact.project_id}:${fact.chapter_no}` === key);
      const latestText = latestTextByChapter.get(key) ?? "";
      const byContent = new Map<string, FactRow[]>();

      for (const fact of chapterFacts) {
        const content = normalizeFactCandidateContent(fact.content);
        if (isLikelyFactNoise(content)) {
          rejectIds.add(fact.id);
          continue;
        }

        if (!latestText.includes(content)) {
          supersedeIds.add(fact.id);
          continue;
        }

        const groupKey = content.toLowerCase();
        const bucket = byContent.get(groupKey) ?? [];
        bucket.push({ ...fact, content });
        byContent.set(groupKey, bucket);
      }

      for (const duplicates of byContent.values()) {
        if (duplicates.length <= 1) continue;
        duplicates.sort((left, right) => {
          const statusScore = Number(right.status === ExtractedStatus.confirmed) - Number(left.status === ExtractedStatus.confirmed);
          if (statusScore !== 0) return statusScore;
          const versionScore = (right.sourceVersion?.version_no ?? 0) - (left.sourceVersion?.version_no ?? 0);
          if (versionScore !== 0) return versionScore;
          return left.id.localeCompare(right.id);
        });
        for (const fact of duplicates.slice(1)) {
          supersedeIds.add(fact.id);
        }
      }
    }

    if (!dryRun && rejectIds.size > 0) {
      await prisma.fact.updateMany({
        where: { id: { in: Array.from(rejectIds) } },
        data: { status: ExtractedStatus.rejected },
      });
    }

    if (!dryRun && supersedeIds.size > 0) {
      await prisma.fact.updateMany({
        where: { id: { in: Array.from(supersedeIds) } },
        data: { status: ExtractedStatus.superseded },
      });
    }

    const activeCount = await prisma.fact.count({
      where: {
        status: { in: [ExtractedStatus.confirmed, ExtractedStatus.extracted] },
        ...(projectId ? { project_id: projectId } : {}),
      },
    });

    console.log(
      JSON.stringify(
        {
          dry_run: dryRun,
          project_id: projectId ?? null,
          scanned: facts.length,
          rejected: rejectIds.size,
          superseded: supersedeIds.size,
          active_remaining: activeCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
