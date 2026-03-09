"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export default function OutlinePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [outlineNodes, setOutlineNodes] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      const [outlineRes, chapterRes] = await Promise.all([
        fetch(`${API_BASE}/projects/${id}/outline`),
        fetch(`${API_BASE}/projects/${id}/chapters`),
      ]);
      setOutlineNodes(await outlineRes.json());
      setChapters(await chapterRes.json());
    })();
  }, [params]);

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-5xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">章节大纲</h1>
      <div className="mt-4 space-y-3">
        {outlineNodes.length === 0 && <Card>暂无全局大纲，可在仪表盘执行“故事开局向导”。</Card>}
        {outlineNodes.map((node) => (
          <Card key={node.id}>
            <h3 className="font-medium">阶段 {node.phase_no} · {node.title}</h3>
            <p className="mt-2 text-sm text-black/70">{node.summary}</p>
            <p className="mt-1 text-sm text-black/70">目标：{node.goal ?? "-"}</p>
            <p className="text-sm text-black/70">冲突：{node.conflict ?? "-"}</p>
            <p className="text-xs text-black/50">建议落点章节：{node.milestone_chapter_no ?? "-"}</p>
          </Card>
        ))}
      </div>
      <h2 className="mt-6 text-xl font-semibold">章节细纲</h2>
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
