"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

type Project = {
  id: string;
  title: string;
  genre?: string | null;
  target_platform?: string | null;
  created_at: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("新小说项目");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string>("");
  const [errorText, setErrorText] = useState("");

  async function loadProjects() {
    const res = await fetch(`${API_BASE}/projects`);
    const data = (await res.json()) as Project[];
    setProjects(data);
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function createProject() {
    setLoading(true);
    setErrorText("");
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        throw new Error(`创建失败：${res.status}`);
      }
      const project = (await res.json()) as Project;
      setProjects((prev) => [project, ...prev]);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(project: Project) {
    const ok = window.confirm(`确认删除《${project.title}》吗？删除后无法恢复。`);
    if (!ok) return;

    setDeletingId(project.id);
    setErrorText("");
    try {
      const res = await fetch(`${API_BASE}/projects/${project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`删除失败：${res.status}`);
      }
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "删除失败，请稍后重试");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="font-heading text-3xl">项目列表</h1>
      <Card className="mt-4 flex items-center gap-3">
        <input
          className="flex-1 rounded-md border border-black/15 px-3 py-2"
          placeholder="输入项目名称"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button onClick={createProject} disabled={loading}>
          新建项目
        </Button>
      </Card>
      {errorText && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p>}
      <div className="mt-6 grid gap-3">
        {projects.length === 0 && <Card>暂无项目，先创建一个。</Card>}
        {projects.map((project) => (
          <Card key={project.id} className="hover:bg-white">
            <div className="flex items-start justify-between gap-3">
              <Link className="flex-1" href={`/projects/${project.id}/dashboard`}>
                <h3 className="font-medium">{project.title}</h3>
                <p className="text-sm text-black/60">{project.genre ?? "未设置类型"}</p>
              </Link>
              <Button
                variant="ghost"
                disabled={deletingId === project.id}
                onClick={() => deleteProject(project)}
              >
                {deletingId === project.id ? "删除中..." : "删除"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </main>
  );
}
