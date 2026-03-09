"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export default function DashboardPage({ params }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [logline, setLogline] = useState("");
  const [protagonistBrief, setProtagonistBrief] = useState("");
  const [toneSetting, setToneSetting] = useState("权谋");
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

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

  async function runBootstrap() {
    if (!projectId) return;
    setBootstrapError("");
    setBootstrapping(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          logline,
          protagonist_brief: protagonistBrief,
          tone_setting: toneSetting,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `Bootstrap failed: ${res.status}`);
      }

      router.push(data.workspace_path ?? `/projects/${projectId}/chapters/1/workspace`);
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : "启动向导失败，请稍后重试");
    } finally {
      setBootstrapping(false);
    }
  }

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

      <Card className="mt-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">故事开局向导</h2>
          <p className="text-xs text-black/50">Step {wizardStep}/3</p>
        </div>
        <p className="mt-1 text-sm text-black/60">
          {chapters.length === 0
            ? "用最少输入快速完成：初始设定 + 全局大纲 + 第一章 Beats。"
            : "当前项目已有章节，重新执行向导会更新设定并生成第一章 Beats。"}
        </p>

        <div className="mt-4 space-y-3">
          {wizardStep === 1 && (
            <div>
              <p className="text-sm font-medium">1) 核心灵感（Logline）</p>
              <textarea
                className="mt-2 h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="一句话写清冲突：谁在什么局势下，必须做什么，否则会失去什么。"
                value={logline}
                onChange={(e) => setLogline(e.target.value)}
              />
            </div>
          )}

          {wizardStep === 2 && (
            <div>
              <p className="text-sm font-medium">2) 主角速写（Protagonist Brief）</p>
              <textarea
                className="mt-2 h-28 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="示例：灵帝，18-22岁，头戴十二旒冕冠，身穿玄色赤边衮服。描写重点在于他极力隐藏的微妙情绪与强撑的威仪。"
                value={protagonistBrief}
                onChange={(e) => setProtagonistBrief(e.target.value)}
              />
            </div>
          )}

          {wizardStep === 3 && (
            <div>
              <p className="text-sm font-medium">3) 初始基调（Tone & Setting）</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["权谋", "暗黑", "修真", "悬疑", "热血", "史诗", "轻奇幻"].map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    className={`rounded-md px-3 py-1.5 text-sm transition ${
                      toneSetting === tone ? "bg-ink text-paper" : "bg-black/5 text-ink hover:bg-black/10"
                    }`}
                    onClick={() => setToneSetting(tone)}
                  >
                    {tone}
                  </button>
                ))}
              </div>
            </div>
          )}

          {bootstrapping && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              向导执行中：正在初始化圣经、推演全局大纲、生成第一章 Beats...
            </div>
          )}

          {bootstrapError && (
            <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{bootstrapError}</div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={wizardStep === 1 || bootstrapping}
            onClick={() => setWizardStep((prev) => (prev === 1 ? 1 : ((prev - 1) as 1 | 2 | 3)))}
          >
            上一步
          </Button>

          {wizardStep < 3 ? (
            <Button
              disabled={
                bootstrapping ||
                (wizardStep === 1 && !logline.trim()) ||
                (wizardStep === 2 && !protagonistBrief.trim())
              }
              onClick={() => setWizardStep((prev) => (prev === 3 ? 3 : ((prev + 1) as 1 | 2 | 3)))}
            >
              下一步
            </Button>
          ) : (
            <Button disabled={bootstrapping || !logline.trim() || !protagonistBrief.trim()} onClick={runBootstrap}>
              {bootstrapping ? "启动中..." : "一键生成开局"}
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
