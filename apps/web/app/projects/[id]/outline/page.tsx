"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export default function OutlinePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      const res = await fetch(`${API_BASE}/projects/${id}/chapters`);
      setChapters(await res.json());
    })();
  }, [params]);

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">章节大纲</h1>
      <div className="mt-4 space-y-3">
        {chapters.map((chapter) => (
          <Card key={chapter.id}>
            <h3 className="font-medium">
              第{chapter.chapter_no}章 {chapter.title ?? "未命名"}
            </h3>
            <p className="mt-2 text-sm text-black/70">目标：{chapter.goal ?? "-"}</p>
            <p className="text-sm text-black/70">冲突：{chapter.conflict ?? "-"}</p>
            <p className="text-sm text-black/70">反转：{chapter.twist ?? "-"}</p>
          </Card>
        ))}
      </div>
    </main>
  );
}
