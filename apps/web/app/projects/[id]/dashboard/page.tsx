"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export default function DashboardPage({ params }: Props) {
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      const [projectRes, chapterRes, projectsRes] = await Promise.all([
        fetch(`${API_BASE}/projects/${id}`),
        fetch(`${API_BASE}/projects/${id}/chapters`),
        fetch(`${API_BASE}/projects`),
      ]);
      setProject(await projectRes.json());
      setChapters(await chapterRes.json());
      const projects = await projectsRes.json();
      setTotalProjects(Array.isArray(projects) ? projects.length : 0);
    })();
  }, [params]);

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">{project?.title ?? "项目仪表盘"}</h1>
      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-black/60">作品总数</p>
          <p className="text-2xl font-semibold">{totalProjects}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">题材类型</p>
          <p>{project?.genre ?? "未设置"}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">叙事视角 / 时态</p>
          <p>
            {(project?.pov ?? "third")}/{project?.tense ?? "past"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">章节数</p>
          <p>{chapters.length}</p>
        </Card>
      </div>
    </main>
  );
}
