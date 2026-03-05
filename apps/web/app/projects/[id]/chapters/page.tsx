"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export default function ChaptersPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<any[]>([]);
  const [nextNo, setNextNo] = useState(1);

  async function load(id: string) {
    const res = await fetch(`${API_BASE}/projects/${id}/chapters`);
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
    await fetch(`${API_BASE}/projects/${projectId}/chapters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter_no: nextNo, title: `第${nextNo}章` }),
    });
    await load(projectId);
  }

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <ProjectNav id={projectId} />
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl">章节管理</h1>
        <Button onClick={createChapter}>新建第 {nextNo} 章</Button>
      </div>
      <div className="mt-4 space-y-3">
        {chapters.map((chapter) => (
          <Link key={chapter.id} href={`/projects/${projectId}/chapters/${chapter.chapter_no}/workspace`}>
            <Card className="hover:bg-white">
              <h3 className="font-medium">
                第{chapter.chapter_no}章 {chapter.title ?? "未命名"}
              </h3>
              <p className="text-sm text-black/60">状态: {chapter.status}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
