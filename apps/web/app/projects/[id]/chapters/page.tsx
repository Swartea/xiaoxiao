"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

function formatDisplayTitle(chapterNo: number, title?: string | null) {
  const clean = (title ?? "")
    .replace(new RegExp(`^第\\s*${chapterNo}\\s*章(?:\\s*[·.、\\-]\\s*|\\s+)?`, "i"), "")
    .replace(/^第\s*\d+\s*章(?:\s*[·.、\-]\s*|\s+)?/i, "")
    .trim();
  return clean ? `第${chapterNo}章 · ${clean}` : `第${chapterNo}章`;
}

export default function ChaptersPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<any[]>([]);
  const [nextNo, setNextNo] = useState(1);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(id: string) {
    const res = await fetch(`${API_BASE}/projects/${id}/chapters`, { cache: "no-store" });
    const list = await res.json();
    setChapters(list);
    setNextNo((Math.max(0, ...list.map((c: any) => c.chapter_no)) || 0) + 1);
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await load(id);
    })();
  }, [params]);

  async function createChapter() {
    setError("");
    setMessage("");
    await fetch(`${API_BASE}/projects/${projectId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_no: nextNo }),
    });
    await load(projectId);
  }

  async function importChapters() {
    if (!importText.trim()) {
      setError("先粘贴章节内容再导入");
      return;
    }
    setImporting(true);
    setError("");
    setMessage("正在导入章节...");
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/chapters/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: importText, default_stage: "draft" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : `导入失败: ${res.status}`);
      }
      setMessage(`导入完成：新增 ${data.imported_count ?? 0} 章，跳过 ${data.skipped_count ?? 0} 章重复内容`);
      setImportText("");
      await load(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
      setMessage("");
    } finally {
      setImporting(false);
    }
  }

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <ProjectNav id={projectId} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-3xl">章节管理</h1>
        <Button onClick={createChapter}>新建第 {nextNo} 章</Button>
      </div>

      <Card className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">导入已有章节</h2>
            <p className="mt-1 text-sm text-black/60">支持两种格式：1）直接粘贴多章 txt（按“第N章”自动拆分）；2）粘贴 JSON 数组。</p>
          </div>
          <Button variant="secondary" disabled={importing} onClick={importChapters}>
            {importing ? "导入中..." : "导入章节"}
          </Button>
        </div>
        <textarea
          className="mt-3 h-48 w-full rounded border border-black/15 px-3 py-2 text-sm"
          placeholder={'示例一：\n第1章 流民冲城\n正文...\n\n第2章 东市官仓亏空\n正文...\n\n示例二：[{"chapter_no":1,"title":"流民冲城","text":"正文..."}]'}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        {message ? <p className="mt-2 text-sm text-blue-700">{message}</p> : null}
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </Card>

      <div className="mt-4 space-y-3">
        {chapters.map((chapter) => (
          <Link key={chapter.id} href={`/projects/${projectId}/chapters/${chapter.chapter_no}/workspace`}>
            <Card className="hover:bg-white">
              <h3 className="font-medium">{formatDisplayTitle(chapter.chapter_no, chapter.title)}</h3>
              <p className="text-sm text-black/60">状态: {chapter.status}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
