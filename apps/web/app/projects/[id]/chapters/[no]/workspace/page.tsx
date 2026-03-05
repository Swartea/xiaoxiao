"use client";

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

export default function ChapterWorkspacePage({ params }: Props) {
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
  const monacoRef = useRef<any>(null);

  async function reload(chId: string) {
    const [workspaceRes, versionsRes] = await Promise.all([
      fetch(`${API_BASE}/chapters/${chId}/workspace`),
      fetch(`${API_BASE}/chapters/${chId}/versions`),
    ]);

    const workspaceData = await workspaceRes.json();
    const versionsData = await versionsRes.json();

    setWorkspace(workspaceData);
    setVersions(versionsData);
    const latest = versionsData[0];
    setSelectedVersionId(latest?.id ?? "");
    setEditorText(latest?.text ?? "");
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
      await reload(chapter.id);
    })();
  }, [params]);

  useEffect(() => {
    const selected = versions.find((v) => v.id === selectedVersionId);
    if (selected) {
      setEditorText(selected.text);
    }
  }, [selectedVersionId, versions]);

  async function runGenerate(stage: "beats" | "draft" | "polish") {
    if (!chapterId) return;
    const res = await fetch(`${API_BASE}/chapters/${chapterId}/generate/${stage}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": makeIdemKey(),
      },
      body: JSON.stringify({ k: 50 }),
    });
    await res.json();
    await reload(chapterId);
  }

  async function runDiff() {
    if (!selectedVersionId || !compareVersionId || !chapterId) return;
    const res = await fetch(
      `${API_BASE}/chapters/${chapterId}/versions/diff?from=${selectedVersionId}&to=${compareVersionId}`,
    );
    setDiffData(await res.json());
  }

  async function runFix(strategyId: string, issue: any) {
    if (!chapterId || !selectedVersionId) return;
    await fetch(`${API_BASE}/chapters/${chapterId}/fix`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": makeIdemKey(),
      },
      body: JSON.stringify({
        base_version_id: selectedVersionId,
        mode: "replace_span",
        span: {
          from: issue.evidence.from,
          to: issue.evidence.to,
        },
        issue_ids: [issue.issue_id],
        strategy_id: strategyId,
      }),
    });

    await reload(chapterId);
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
              </section>
            </div>
          )}
        </Card>

        <Card className="col-span-12 lg:col-span-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant={tab === "beats" ? "default" : "ghost"} onClick={() => setTab("beats")}>场景骨架</Button>
            <Button variant={tab === "draft" ? "default" : "ghost"} onClick={() => setTab("draft")}>正文初稿</Button>
            <Button variant={tab === "polish" ? "default" : "ghost"} onClick={() => setTab("polish")}>润色定稿</Button>
            <Button variant="secondary" onClick={() => runGenerate(tab)}>
              生成 {tab}
            </Button>
          </div>

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
                  {fixStrategies.map((strategy: string, idx: number) => (
                    <Button key={strategy} variant="secondary" onClick={() => runFix(`strategy-${idx + 1}`, issue)}>
                      修复策略 {idx + 1}
                    </Button>
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
