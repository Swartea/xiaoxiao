"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MonacoEditor } from "@/components/monaco-editor";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string; no: string }> };

function makeIdemKey() {
  return crypto.randomUUID();
}

type FixMode = "replace_span" | "rewrite_section" | "rewrite_chapter";

const FIX_MODE_BY_STRATEGY_INDEX: FixMode[] = ["replace_span", "rewrite_section", "rewrite_chapter"];
const FIX_MODE_LABELS: Record<FixMode, string> = {
  replace_span: "局部替换",
  rewrite_section: "场景重写",
  rewrite_chapter: "整章重写",
};

export default function ChapterWorkspacePage({ params }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [chapterNo, setChapterNo] = useState(0);
  const [chapterId, setChapterId] = useState("");
  const [workspace, setWorkspace] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [compareVersionId, setCompareVersionId] = useState("");
  const [tab, setTab] = useState<"beats" | "draft" | "polish">("draft");
  const [editorText, setEditorText] = useState("");
  const [diffData, setDiffData] = useState<any>(null);
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showTraceMeta, setShowTraceMeta] = useState(false);
  const monacoRef = useRef<any>(null);
  const versionTextCacheRef = useRef<Record<string, string>>({});

  async function loadVersionText(chId: string, versionId: string) {
    if (!versionId) return "";
    const cached = versionTextCacheRef.current[versionId];
    if (typeof cached === "string") {
      return cached;
    }
    const res = await fetch(`${API_BASE}/chapters/${chId}/versions/${versionId}`);
    const data = await res.json();
    const text = typeof data?.text === "string" ? data.text : "";
    versionTextCacheRef.current[versionId] = text;
    return text;
  }

  async function reload(chId: string) {
    const [workspaceRes, versionsRes] = await Promise.all([
      fetch(`${API_BASE}/chapters/${chId}/workspace`),
      fetch(`${API_BASE}/chapters/${chId}/versions?meta=1`),
    ]);

    const workspaceData = await workspaceRes.json();
    const versionsData = await versionsRes.json();

    setWorkspace(workspaceData);
    setVersions(versionsData);
    const latest = versionsData[0];
    setSelectedVersionId(latest?.id ?? "");
    if (latest?.id) {
      const latestText = await loadVersionText(chId, latest.id);
      setEditorText(latestText);
    } else {
      setEditorText("");
    }
  }

  useEffect(() => {
    void (async () => {
      const { id, no } = await params;
      const noInt = Number(no);
      setProjectId(id);
      setChapterNo(noInt);
      const chapterRes = await fetch(`${API_BASE}/projects/${id}/chapters`);
      const chapters = await chapterRes.json();
      const chapter = chapters.find((c: any) => c.chapter_no === noInt);
      if (!chapter) return;
      setChapterId(chapter.id);
      versionTextCacheRef.current = {};
      await reload(chapter.id);
    })();
  }, [params]);

  useEffect(() => {
    if (!selectedVersionId || !chapterId) return;
    let cancelled = false;
    void (async () => {
      const text = await loadVersionText(chapterId, selectedVersionId);
      if (!cancelled) {
        setEditorText(text);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId, selectedVersionId]);

  async function runGenerate(stage: "beats" | "draft" | "polish") {
    if (!chapterId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/generate/${stage}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify({ k: 50 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `生成失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "生成失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function runDiff() {
    if (!selectedVersionId || !compareVersionId || !chapterId) return;
    const res = await fetch(
      `${API_BASE}/chapters/${chapterId}/versions/diff?from=${selectedVersionId}&to=${compareVersionId}`,
    );
    setDiffData(await res.json());
  }

  async function runRollback() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version_id: selectedVersionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `回滚失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "回滚失败");
    } finally {
      setActionLoading(false);
    }
  }

  function resolveSceneIndexForIssue(issue: any): number | null {
    const issueFrom = issue?.evidence?.from;
    if (typeof issueFrom !== "number") return null;
    const scenes = Array.isArray(workspace?.chapter_memory?.scene_list) ? workspace.chapter_memory.scene_list : [];
    const targetScene = scenes.find((scene: any) => {
      const from = scene?.anchor_span?.from;
      const to = scene?.anchor_span?.to;
      return typeof from === "number" && typeof to === "number" && issueFrom >= from && issueFrom <= to;
    });
    return typeof targetScene?.scene_index === "number" ? targetScene.scene_index : null;
  }

  async function runFix(issue: any, strategyIndex: number) {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const mode = FIX_MODE_BY_STRATEGY_INDEX[strategyIndex] ?? "replace_span";
      const payload: Record<string, unknown> = {
        base_version_id: selectedVersionId,
        mode,
        issue_ids: [issue.issue_id],
        strategy_id: `strategy-${strategyIndex + 1}`,
      };

      if (mode === "replace_span") {
        payload.span = {
          from: issue.evidence.from,
          to: issue.evidence.to,
        };
      } else if (mode === "rewrite_section") {
        const sceneIndex = resolveSceneIndexForIssue(issue);
        if (sceneIndex === null) {
          setActionError("当前问题未定位到场景锚点，无法执行“场景重写”。请先用“局部替换”或补全 scene_list。");
          return;
        }
        payload.section = { scene_index: sceneIndex };
      }

      const res = await fetch(`${API_BASE}/chapters/${chapterId}/fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `修复失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "修复失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function runNumericConsistencyFix() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify({
          base_version_id: selectedVersionId,
          mode: "rewrite_chapter",
          strategy_id: "numeric-consistency",
          instruction:
            "仅修复前后文数字、年龄、金额、时间、数量不一致问题。禁止改动剧情走向、人物关系、伏笔。若数字无冲突则保持原文。",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `数字一致性修复失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "数字一致性修复失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function runDeduplicateCleanup() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify({
          base_version_id: selectedVersionId,
          mode: "rewrite_chapter",
          strategy_id: "deduplicate-cleanup",
          instruction:
            "清理重复开篇与重复段落。正文中不允许出现“## 场景X”这类小标题。保留剧情事实、时间线、数字信息和人物关系不变。",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `清理重复段失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "清理重复段失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function runReduceWordRepetition() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/chapters/${chapterId}/fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify({
          base_version_id: selectedVersionId,
          mode: "rewrite_chapter",
          strategy_id: "reduce-word-repetition",
          instruction:
            "减少重复抽象词（如权谋、代价、命运、未知）的出现频率。优先改成具体动作/细节/对白表达，不改剧情事实、时间线和数字信息。",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || `降重复词失败: ${res.status}`);
      }
      await reload(chapterId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "降重复词失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function createSecondChapterTemplate() {
    if (!projectId) return;
    setActionError("");
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/chapters/second-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || `创建第二章模板失败: ${res.status}`);
      }
      router.push(data.workspace_path ?? `/projects/${projectId}/chapters/2/workspace`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "创建第二章模板失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function updateItemStatus(kind: "facts" | "seeds" | "timeline", id: string, status: string) {
    if (!chapterId) return;
    await fetch(`${API_BASE}/chapters/${chapterId}/${kind}/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
    await reload(chapterId);
  }

  function jumpToEvidence(issue: any) {
    if (!monacoRef.current?.editor) return;
    const model = monacoRef.current.editor.getModel();
    if (!model) return;

    const start = model.getPositionAt(issue.evidence.from);
    const end = model.getPositionAt(issue.evidence.to);
    monacoRef.current.editor.setSelection({
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    });
    monacoRef.current.editor.revealLineInCenter(start.lineNumber);
    monacoRef.current.editor.focus();
  }

  const issues = useMemo(() => workspace?.continuity_report?.report?.issues ?? [], [workspace]);
  const fixStrategies = useMemo(
    () => workspace?.continuity_report?.report?.fix_strategies ?? ["策略1", "策略2", "策略3"],
    [workspace],
  );

  if (!projectId || !chapterId) return <main className="p-8">正在加载工作台...</main>;

  const context = workspace?.generation_context_snapshot?.context;

  return (
    <main className="mx-auto max-w-[1600px] p-6">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">第 {chapterNo} 章工作台</h1>
      <div className="mt-4 grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-3 h-[760px] overflow-auto">
          <h2 className="font-medium">生成上下文包</h2>
          {!context && <p className="mt-2 text-sm text-black/60">尚无上下文快照，先运行生成。</p>}
          {context && (
            <div className="mt-3 space-y-3 text-sm">
              <section>
                <h3 className="font-semibold">设定摘要</h3>
                <pre className="whitespace-pre-wrap text-xs">{context.bible_summary}</pre>
              </section>
              <section>
                <h3 className="font-semibold">硬约束</h3>
                <ul className="list-disc pl-4">
                  {(context.constraints ?? []).map((item: string, idx: number) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="font-semibold">追溯信息 / 检索元数据</h3>
                {!showTraceMeta ? (
                  <Button variant="ghost" onClick={() => setShowTraceMeta(true)}>
                    展开详细追溯 JSON
                  </Button>
                ) : (
                  <div>
                    <pre className="max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs">
                      {JSON.stringify(
                        {
                          context_hash: workspace.generation_context_snapshot?.context_hash,
                          retriever_meta: workspace.generation_context_snapshot?.retriever_meta,
                          trace_map: workspace.generation_context_snapshot?.trace_map,
                        },
                        null,
                        2,
                      )}
                    </pre>
                    <Button className="mt-1" variant="ghost" onClick={() => setShowTraceMeta(false)}>
                      收起详细追溯 JSON
                    </Button>
                  </div>
                )}
              </section>
            </div>
          )}
        </Card>

        <Card className="col-span-12 lg:col-span-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant={tab === "beats" ? "default" : "ghost"} onClick={() => setTab("beats")}>场景骨架</Button>
            <Button variant={tab === "draft" ? "default" : "ghost"} onClick={() => setTab("draft")}>正文初稿</Button>
            <Button variant={tab === "polish" ? "default" : "ghost"} onClick={() => setTab("polish")}>润色定稿</Button>
            <Button variant="secondary" disabled={actionLoading} onClick={() => runGenerate(tab)}>
              生成 {tab}
            </Button>
            {tab === "polish" && (
              <Button variant="ghost" disabled={actionLoading || !selectedVersionId} onClick={runNumericConsistencyFix}>
                数字一致性修复
              </Button>
            )}
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId} onClick={runDeduplicateCleanup}>
              清理重复段
            </Button>
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId} onClick={runReduceWordRepetition}>
              降重复词
            </Button>
            {chapterNo === 1 && (
              <Button variant="ghost" disabled={actionLoading} onClick={createSecondChapterTemplate}>
                创建第2章衔接模板
              </Button>
            )}
          </div>

          {actionError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <select
              className="rounded border border-black/15 px-2 py-1"
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
            >
              <option value="">选择版本</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no} ({v.stage})
                </option>
              ))}
            </select>

            <select
              className="rounded border border-black/15 px-2 py-1"
              value={compareVersionId}
              onChange={(e) => setCompareVersionId(e.target.value)}
            >
              <option value="">对比版本</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_no} ({v.stage})
                </option>
              ))}
            </select>
            <Button variant="ghost" onClick={runDiff}>
              查看差异
            </Button>
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId} onClick={runRollback}>
              回滚到当前选择版本
            </Button>
          </div>

          <MonacoEditor
            value={editorText}
            onChange={setEditorText}
            onMount={(editor: any, monaco: any) => {
              monacoRef.current = { editor, monaco };
            }}
          />

          {diffData && (
            <pre className="mt-3 max-h-56 overflow-auto rounded bg-black/5 p-3 text-xs">
              {JSON.stringify(diffData, null, 2)}
            </pre>
          )}
        </Card>

        <Card className="col-span-12 lg:col-span-3 h-[760px] overflow-auto">
          <h2 className="font-medium">一致性报告</h2>
          <div className="mt-2 space-y-3">
            {issues.length === 0 && <p className="text-sm text-black/60">暂无问题</p>}
            {issues.map((issue: any) => (
              <div key={issue.issue_id} className="rounded border border-black/10 p-2">
                <p className="text-xs uppercase text-black/60">{issue.severity}</p>
                <p className="text-sm">{issue.message}</p>
                <Button className="mt-2" variant="ghost" onClick={() => jumpToEvidence(issue)}>
                  跳转段落
                </Button>
                <div className="mt-2 grid gap-1">
                  {fixStrategies.map((strategy: string, idx: number) => {
                    const mode = FIX_MODE_BY_STRATEGY_INDEX[idx] ?? "replace_span";
                    const label = FIX_MODE_LABELS[mode];
                    return (
                      <Button
                        key={`${issue.issue_id}-${idx}`}
                        variant="secondary"
                        disabled={actionLoading}
                        onClick={() => runFix(issue, idx)}
                        title={strategy}
                      >
                        {`策略${idx + 1}：${label}`}
                      </Button>
                    );
                  })}
                  {fixStrategies.map((strategy: string, idx: number) => (
                    <p key={`${issue.issue_id}-hint-${idx}`} className="text-[11px] text-black/55">
                      {`策略${idx + 1}说明：${strategy}`}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-4 font-semibold">本章抽取项（Facts / Seeds / Timeline）</h3>
          <div className="mt-2 space-y-2 text-xs">
            {["facts", "seeds", "timeline"].map((kind) => (
              <div key={kind}>
                <p className="font-medium">{kind}</p>
                {(workspace?.extracted_items?.[kind] ?? []).map((item: any) => (
                  <div key={item.id} className="mb-2 rounded border border-black/10 p-2">
                    <p>{item.content ?? item.event}</p>
                    <select
                      className="mt-1 rounded border border-black/20 px-2 py-1"
                      value={item.status ?? item.extraction_status}
                      onChange={(e) => updateItemStatus(kind as any, item.id, e.target.value)}
                    >
                      <option value="extracted">extracted</option>
                      <option value="confirmed">confirmed</option>
                      <option value="rejected">rejected</option>
                    </select>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </main>
  );
}
