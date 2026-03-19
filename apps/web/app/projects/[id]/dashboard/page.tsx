"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

const REQUEST_TIMEOUT_MS = 120_000;
const CHAPTER_READY_RETRIES = 25;
const POLL_INTERVAL_MS = 1_200;
const BOOTSTRAP_STATUS_RETRIES = 40;
const BOOTSTRAP_STATUS_INTERVAL_MS = 3_000;
const GENRE_OPTIONS = ["古言", "古偶", "宫斗", "宅斗", "现言", "都市言情", "仙侠", "玄幻", "悬疑", "推理"];
const TONE_TAG_OPTIONS = ["权谋", "甜虐", "悬疑", "克制", "热血", "群像", "史诗", "暗黑", "轻喜", "冷感"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function toggleTag(current: string[], tag: string) {
  if (current.includes(tag)) {
    return current.filter((item) => item !== tag);
  }
  return current.length >= 3 ? current : [...current, tag];
}

export default function DashboardPage({ params }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [genre, setGenre] = useState("");
  const [logline, setLogline] = useState("");
  const [centralConflict, setCentralConflict] = useState("");
  const [protagonistBrief, setProtagonistBrief] = useState("");
  const [relationshipHook, setRelationshipHook] = useState("");
  const [statusTension, setStatusTension] = useState("");
  const [openingScene, setOpeningScene] = useState("");
  const [toneTags, setToneTags] = useState<string[]>([]);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");

  async function requestJson(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const method = (init?.method ?? "GET").toUpperCase();
      const res = await fetch(url, {
        ...init,
        cache: method === "GET" ? "no-store" : init?.cache,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.message === "string" ? data.message : `请求失败: ${res.status}`);
      }
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`请求超时（>${Math.ceil(timeoutMs / 1000)}秒）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function reloadDashboard(id: string) {
    const [projectData, chapterData, projectsData] = await Promise.all([
      requestJson(`${API_BASE}/projects/${id}`),
      requestJson(`${API_BASE}/projects/${id}/chapters`),
      requestJson(`${API_BASE}/projects`),
    ]);
    setProject(projectData);
    setChapters(Array.isArray(chapterData) ? chapterData : []);
    setTotalProjects(Array.isArray(projectsData) ? projectsData.length : 0);
  }

  async function waitForChapterReady(id: string, chapterNo: number) {
    for (let attempt = 1; attempt <= CHAPTER_READY_RETRIES; attempt += 1) {
      const chapterData = await requestJson(`${API_BASE}/projects/${id}/chapters`);
      const chapterList = Array.isArray(chapterData) ? chapterData : [];
      const chapter = chapterList.find((item: any) => Number(item.chapter_no) === chapterNo);
      if (chapter) {
        return chapter;
      }
      if (attempt < CHAPTER_READY_RETRIES) {
        setBootstrapStatus(`向导执行中：章节初始化中（${attempt}/${CHAPTER_READY_RETRIES}）...`);
        await sleep(POLL_INTERVAL_MS);
      }
    }
    return null;
  }

  async function finalizeBootstrap(data: any) {
    const targetChapterNo = Number(data?.chapter_no) > 0 ? Number(data.chapter_no) : 1;
    const readyChapter = await waitForChapterReady(projectId, targetChapterNo);
    if (!readyChapter) {
      throw new Error("章节初始化超时，请稍后重试。");
    }

    await reloadDashboard(projectId);
    setBootstrapStatus("初始化完成，正在进入工作台...");
    router.push(data.workspace_path ?? `/projects/${projectId}/chapters/${targetChapterNo}/workspace`);
  }

  async function pollBootstrapStatus(id: string, idempotencyKey: string) {
    for (let attempt = 1; attempt <= BOOTSTRAP_STATUS_RETRIES; attempt += 1) {
      try {
        const data = await requestJson(
          `${API_BASE}/projects/${id}/bootstrap/status?idempotency_key=${encodeURIComponent(idempotencyKey)}`,
          undefined,
          15_000,
        );

        if (data?.status === "succeeded") {
          return data;
        }

        if (data?.status === "failed") {
          throw new Error(typeof data?.error_message === "string" && data.error_message.trim()
            ? data.error_message
            : "开局生成失败，请稍后重试。");
        }
      } catch (error) {
        const message = formatErrorMessage(error, "开局状态查询失败");
        const retryable = message.includes("Bootstrap request not found") || message.includes("请求超时");
        if (!retryable || attempt === BOOTSTRAP_STATUS_RETRIES) {
          throw error;
        }
      }

      if (attempt < BOOTSTRAP_STATUS_RETRIES) {
        setBootstrapStatus(`向导执行较慢，后台仍在处理（${attempt}/${BOOTSTRAP_STATUS_RETRIES}）...`);
        await sleep(BOOTSTRAP_STATUS_INTERVAL_MS);
      }
    }

    return null;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id } = await params;
        if (cancelled) return;
        setProjectId(id);
        await reloadDashboard(id);
      } catch (error) {
        if (!cancelled) {
          setBootstrapError(formatErrorMessage(error, "项目加载失败，请刷新后重试"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (typeof project?.genre === "string" && project.genre.trim() && !genre.trim()) {
      setGenre(project.genre.trim());
    }
  }, [project?.genre, genre]);

  async function runBootstrap() {
    if (!projectId) return;
    setBootstrapError("");
    setBootstrapStatus("向导执行中：正在初始化圣经、推演全局大纲、生成第一章 Beats...");
    setBootstrapping(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          genre,
          logline,
          central_conflict: centralConflict,
          protagonist_brief: protagonistBrief,
          relationship_hook: relationshipHook,
          status_tension: statusTension,
          opening_scene: openingScene,
          tone_tags: toneTags,
        }),
      });
      await finalizeBootstrap(data);
    } catch (error) {
      const message = formatErrorMessage(error, "启动向导失败，请稍后重试");
      const shouldTrack = message.includes("请求超时") || message.includes("REQUEST_IN_PROGRESS");

      if (shouldTrack) {
        try {
          setBootstrapError("");
          setBootstrapStatus("向导请求已提交，正在追踪后台进度...");
          const status = await pollBootstrapStatus(projectId, idempotencyKey);
          if (!status) {
            throw new Error("向导仍在后台执行，请稍后刷新仪表盘或查看章节列表。");
          }
          await finalizeBootstrap(status);
        } catch (pollError) {
          setBootstrapError(formatErrorMessage(pollError, "向导仍在后台执行，请稍后重试"));
          setBootstrapStatus("");
        }
      } else {
        setBootstrapError(message);
        setBootstrapStatus("");
      }
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
          <p className="text-xs text-black/50">Step {wizardStep}/4</p>
        </div>
        <p className="mt-1 text-sm text-black/60">
          {chapters.length === 0
            ? "按题材模板快速完成：初始设定 + 全局大纲 + 第一章 Beats。"
            : "当前项目已有章节，重新执行向导会更新设定并生成第一章 Beats。"}
        </p>

        <div className="mt-4 space-y-3">
          {wizardStep === 1 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">1) 题材类型（Genre）</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {GENRE_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-md px-3 py-1.5 text-sm transition ${
                        genre === item ? "bg-ink text-paper" : "bg-black/5 text-ink hover:bg-black/10"
                      }`}
                      onClick={() => setGenre(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <label className="grid gap-1">
                <span className="text-sm text-black/60">自定义题材</span>
                <input
                  className="rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="未命中预设时可手输，例如：民国言情 / 科幻悬疑"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                />
              </label>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">2) 核心设定（Logline + Central Conflict）</p>
                <textarea
                  className="mt-2 h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="一句话写清故事钩子：谁在什么局势下，必须做什么，否则会失去什么。"
                  value={logline}
                  onChange={(e) => setLogline(e.target.value)}
                />
              </div>
              <textarea
                className="h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="把主线冲突单独拆出来，例如：她必须隐瞒身份接近仇敌，否则全族都会被清算。"
                value={centralConflict}
                onChange={(e) => setCentralConflict(e.target.value)}
              />
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">3) 主角与关系张力</p>
                <textarea
                  className="mt-2 h-28 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="主角速写：身份、外观、状态、强项与短板。"
                  value={protagonistBrief}
                  onChange={(e) => setProtagonistBrief(e.target.value)}
                />
              </div>
              <textarea
                className="h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="关系钩子：主角与关键他者之间最有戏的牵引或禁忌。"
                value={relationshipHook}
                onChange={(e) => setRelationshipHook(e.target.value)}
              />
              <textarea
                className="h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                placeholder="当前处境张力：主角眼下最紧的压力、限制或倒计时。"
                value={statusTension}
                onChange={(e) => setStatusTension(e.target.value)}
              />
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">4) 开局场景与基调</p>
                <textarea
                  className="mt-2 h-24 w-full rounded-md border border-black/15 px-3 py-2 text-sm"
                  placeholder="开局场景：第一章从什么地点、事件或关系碰撞切入。"
                  value={openingScene}
                  onChange={(e) => setOpeningScene(e.target.value)}
                />
              </div>
              <div>
                <p className="text-sm font-medium">Tone Tags（最多 3 个，可选）</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TONE_TAG_OPTIONS.map((tag) => {
                    const active = toneTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`rounded-md px-3 py-1.5 text-sm transition ${
                          active ? "bg-ink text-paper" : "bg-black/5 text-ink hover:bg-black/10"
                        }`}
                        onClick={() => setToneTags((current) => toggleTag(current, tag))}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-black/50">已选 {toneTags.length}/3</p>
              </div>
            </div>
          )}

          {bootstrapping && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              {bootstrapStatus || "向导执行中：正在初始化圣经、推演全局大纲、生成第一章 Beats..."}
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
            onClick={() => setWizardStep((prev) => (prev === 1 ? 1 : ((prev - 1) as 1 | 2 | 3 | 4)))}
          >
            上一步
          </Button>

          {wizardStep < 4 ? (
            <Button
              disabled={
                bootstrapping ||
                (wizardStep === 1 && !genre.trim()) ||
                (wizardStep === 2 && (!logline.trim() || !centralConflict.trim())) ||
                (wizardStep === 3 && (!protagonistBrief.trim() || !relationshipHook.trim() || !statusTension.trim()))
              }
              onClick={() => setWizardStep((prev) => (prev === 4 ? 4 : ((prev + 1) as 1 | 2 | 3 | 4)))}
            >
              下一步
            </Button>
          ) : (
            <Button
              disabled={
                bootstrapping ||
                !genre.trim() ||
                !logline.trim() ||
                !centralConflict.trim() ||
                !protagonistBrief.trim() ||
                !relationshipHook.trim() ||
                !statusTension.trim() ||
                !openingScene.trim()
              }
              onClick={runBootstrap}
            >
              {bootstrapping ? "启动中..." : "一键生成开局"}
            </Button>
          )}
        </div>
      </Card>
    </main>
  );
}
