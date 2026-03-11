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
type FixIntensity = "low" | "medium" | "high";

const FIX_MODE_BY_STRATEGY_INDEX: FixMode[] = ["replace_span", "rewrite_section", "rewrite_chapter"];
const FIX_MODE_LABELS: Record<FixMode, string> = {
  replace_span: "局部替换",
  rewrite_section: "场景重写",
  rewrite_chapter: "整章重写",
};
const REQUEST_TIMEOUT_MS = 120_000;
const FIX_REQUEST_TIMEOUT_MS = 420_000;
const DIRECTOR_REVIEW_TIMEOUT_MS = 180_000;
const DIRECTOR_AUTOFIX_TIMEOUT_MS = 420_000;
const GENERATE_TIMEOUT_BY_STAGE: Record<"beats" | "draft" | "polish", number> = {
  beats: 240_000,
  draft: 300_000,
  polish: 480_000,
};
const CHAPTER_RESOLVE_RETRIES = 30;
const VERSION_REFRESH_RETRIES = 8;
const POLL_INTERVAL_MS = 1_200;
const STAGE_LABELS: Record<"beats" | "draft" | "polish", string> = {
  beats: "场景骨架",
  draft: "正文初稿",
  polish: "润色定稿",
};
const FIX_MODE_RISK_LABELS: Record<FixMode, string> = {
  replace_span: "低风险",
  rewrite_section: "中风险",
  rewrite_chapter: "高风险",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const [loadingMessage, setLoadingMessage] = useState("正在加载工作台...");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showTraceMeta, setShowTraceMeta] = useState(false);
  const [fixGoal, setFixGoal] = useState("优先修复可读性和冲突表达，保持剧情事实不变");
  const [keepElementsText, setKeepElementsText] = useState("主线冲突,角色关系,关键数字");
  const [forbiddenChangesText, setForbiddenChangesText] = useState("改变时间线,新增世界观设定,删关键伏笔");
  const [targetIntensity, setTargetIntensity] = useState<FixIntensity>("medium");
  const [manualFixMode, setManualFixMode] = useState<FixMode>("replace_span");
  const [manualSceneIndex, setManualSceneIndex] = useState("0");
  const [selectionSpan, setSelectionSpan] = useState<{ from: number; to: number } | null>(null);
  const [previewPayload, setPreviewPayload] = useState<Record<string, unknown> | null>(null);
  const [fixPreview, setFixPreview] = useState<any>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const monacoRef = useRef<any>(null);
  const versionTextCacheRef = useRef<Record<string, string>>({});

  function formatErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return fallback;
  }

  function splitListInput(input: string) {
    return input
      .split(/[\n,，、;；]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function buildCustomInstruction(extraHint?: string) {
    const keepElements = splitListInput(keepElementsText);
    const forbiddenChanges = splitListInput(forbiddenChangesText);
    return [
      extraHint ? `问题描述：${extraHint}` : "",
      `修复目标：${fixGoal}`,
      keepElements.length > 0 ? `保留元素：${keepElements.join("、")}` : "",
      forbiddenChanges.length > 0 ? `禁止改动：${forbiddenChanges.join("、")}` : "",
      `目标强度：${targetIntensity}`,
    ]
      .filter(Boolean)
      .join("；");
  }

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

  async function loadVersionText(chId: string, versionId: string) {
    if (!versionId) return "";
    const cached = versionTextCacheRef.current[versionId];
    if (typeof cached === "string") {
      return cached;
    }
    const data = await requestJson(`${API_BASE}/chapters/${chId}/versions/${versionId}`);
    const text = typeof data?.text === "string" ? data.text : "";
    versionTextCacheRef.current[versionId] = text;
    return text;
  }

  async function reload(chId: string) {
    const [workspaceData, versionsRaw] = await Promise.all([
      requestJson(`${API_BASE}/chapters/${chId}/workspace`),
      requestJson(`${API_BASE}/chapters/${chId}/versions?meta=1`),
    ]);
    const versionsData = Array.isArray(versionsRaw) ? versionsRaw : [];

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
    return versionsData;
  }

  async function reloadUntilVersionUpdate(
    chId: string,
    previousVersionId?: string,
    options?: {
      retries?: number;
      intervalMs?: number;
    },
  ) {
    const retries = options?.retries ?? VERSION_REFRESH_RETRIES;
    const intervalMs = options?.intervalMs ?? POLL_INTERVAL_MS;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const latestVersions = await reload(chId);
      const latestVersionId = latestVersions[0]?.id as string | undefined;
      if (!previousVersionId || (latestVersionId && latestVersionId !== previousVersionId)) {
        return true;
      }
      if (attempt < retries) {
        await sleep(intervalMs);
      }
    }
    return false;
  }

  async function resolveChapterByNo(projectIdValue: string, chapterNoValue: number) {
    for (let attempt = 1; attempt <= CHAPTER_RESOLVE_RETRIES; attempt += 1) {
      const chapters = await requestJson(`${API_BASE}/projects/${projectIdValue}/chapters`);
      const chapter =
        Array.isArray(chapters) && chapters.find((item: any) => Number(item.chapter_no) === chapterNoValue);
      if (chapter) {
        return chapter;
      }
      if (attempt < CHAPTER_RESOLVE_RETRIES) {
        setLoadingMessage(`章节正在初始化（${attempt}/${CHAPTER_RESOLVE_RETRIES}）...`);
        await sleep(POLL_INTERVAL_MS);
      }
    }
    return null;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id, no } = await params;
        const noInt = Number(no);
        if (cancelled) return;
        setProjectId(id);
        setChapterNo(noInt);
        setLoadingMessage("正在加载章节...");
        setActionError("");

        const chapter = await resolveChapterByNo(id, noInt);
        if (cancelled) return;
        if (!chapter) {
          setActionError("章节尚未就绪，请稍后重试。");
          setLoadingMessage("章节初始化超时。");
          return;
        }

        setChapterId(chapter.id);
        versionTextCacheRef.current = {};
        await reload(chapter.id);
      } catch (error) {
        if (!cancelled) {
          setActionError(formatErrorMessage(error, "工作台加载失败"));
          setLoadingMessage("工作台加载失败。");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
    setActionMessage(`正在生成${STAGE_LABELS[stage]}，请稍候...`);
    setActionLoading(true);
    const previousLatestVersionId = versions[0]?.id;
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/generate/${stage}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify({ k: 50 }),
      }, GENERATE_TIMEOUT_BY_STAGE[stage]);
      if (stage === "polish") {
        await requestJson(`${API_BASE}/chapters/${chapterId}/evaluate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
      }
      const hasVersionUpdate = await reloadUntilVersionUpdate(chapterId, previousLatestVersionId);
      setActionMessage(
        hasVersionUpdate ? `${STAGE_LABELS[stage]}生成完成` : `${STAGE_LABELS[stage]}已提交，版本写入稍慢，请稍后再试`,
      );
    } catch (error) {
      const message = formatErrorMessage(error, "生成失败");
      const isTimeout = message.includes("请求超时");
      if (isTimeout) {
        const hasVersionUpdate = await reloadUntilVersionUpdate(chapterId, previousLatestVersionId, {
          retries: 18,
          intervalMs: 3_000,
        });
        if (hasVersionUpdate) {
          setActionError("");
          setActionMessage(`${STAGE_LABELS[stage]}请求超时，但后台已完成并同步了新版本。`);
        } else {
          setActionError(`${STAGE_LABELS[stage]}请求超时，后台可能仍在执行。请稍后查看版本列表。`);
          setActionMessage("");
        }
      } else {
        setActionError(message);
        setActionMessage("");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function runDiff() {
    if (!selectedVersionId || !compareVersionId || !chapterId) return;
    setActionError("");
    try {
      const data = await requestJson(
        `${API_BASE}/chapters/${chapterId}/versions/diff?from=${selectedVersionId}&to=${compareVersionId}`,
      );
      setDiffData(data);
    } catch (error) {
      setActionError(formatErrorMessage(error, "版本对比失败"));
    }
  }

  async function runEvaluate() {
    if (!chapterId) return;
    setActionError("");
    setActionMessage("正在执行质量评估...");
    setActionLoading(true);
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      await reload(chapterId);
      setActionMessage("质量评估已更新");
    } catch (error) {
      setActionError(formatErrorMessage(error, "评估失败"));
      setActionMessage("");
    } finally {
      setActionLoading(false);
    }
  }

  async function runDirectorReview(autoFix = false) {
    if (!chapterId) return;
    setActionError("");
    setActionMessage(autoFix ? "总编正在评审并自动修复..." : "总编正在评审...");
    setActionLoading(true);
    const previousLatestVersionId = versions[0]?.id;
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/director-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auto_fix: autoFix,
        }),
      }, autoFix ? DIRECTOR_AUTOFIX_TIMEOUT_MS : DIRECTOR_REVIEW_TIMEOUT_MS);
      await reload(chapterId);
      setActionMessage(autoFix ? "总编评审完成并已自动修复" : "总编评审完成（未自动修复）");
    } catch (error) {
      const message = formatErrorMessage(error, autoFix ? "总编闭环失败" : "总编评审失败");
      const isTimeout = message.includes("请求超时");
      if (isTimeout && autoFix) {
        const hasVersionUpdate = await reloadUntilVersionUpdate(chapterId, previousLatestVersionId, {
          retries: 18,
          intervalMs: 3_000,
        });
        if (hasVersionUpdate) {
          setActionError("");
          setActionMessage("总编闭环请求超时，但后台已完成并同步了新版本。");
        } else {
          setActionError("总编闭环请求超时，后台可能仍在执行。请稍后查看版本列表。");
          setActionMessage("");
        }
      } else {
        setActionError(message);
        setActionMessage("");
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function runRollback() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    setActionMessage("正在回滚版本...");
    setActionLoading(true);
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version_id: selectedVersionId }),
      });
      await reload(chapterId);
      setActionMessage("版本回滚完成");
    } catch (error) {
      setActionError(formatErrorMessage(error, "回滚失败"));
      setActionMessage("");
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

  function pickRecommendedStrategyIndex(issue: any) {
    const issueType = String(issue?.type ?? "");
    const severity = String(issue?.severity ?? "low").toLowerCase();
    if (severity === "high") {
      return 2;
    }
    if (
      issueType.includes("timeline") ||
      issueType.includes("relationship") ||
      issueType.includes("world_rule") ||
      issueType.includes("character_ooc")
    ) {
      return 1;
    }
    return 0;
  }

  function captureEditorSelectionSpan() {
    const editor = monacoRef.current?.editor;
    if (!editor) {
      throw new Error("编辑器未就绪");
    }
    const model = editor.getModel();
    if (!model) {
      throw new Error("编辑器模型未就绪");
    }
    const selection = editor.getSelection();
    if (!selection) {
      throw new Error("未读取到选区");
    }

    const from = model.getOffsetAt({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    const to = model.getOffsetAt({
      lineNumber: selection.endLineNumber,
      column: selection.endColumn,
    });
    const normalizedFrom = Math.min(from, to);
    const normalizedTo = Math.max(from, to);
    if (normalizedTo <= normalizedFrom) {
      throw new Error("请先在正文中选中要修复的文本");
    }
    const span = { from: normalizedFrom, to: normalizedTo };
    setSelectionSpan(span);
    return span;
  }

  async function runFixPreview(payload: Record<string, unknown>) {
    if (!chapterId) return;
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const preview = await requestJson(`${API_BASE}/chapters/${chapterId}/fix/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      setPreviewPayload(payload);
      setFixPreview(preview);
      setActionMessage("已生成修复预估，确认后可执行修复");
    } catch (error) {
      setPreviewError(formatErrorMessage(error, "预估失败"));
      setFixPreview(null);
      setPreviewPayload(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function executeFix(payload: Record<string, unknown>, successMessage = "修复完成并已自动复评") {
    if (!chapterId) return;
    setActionError("");
    setActionMessage("正在执行定向修复...");
    setActionLoading(true);
    const previousLatestVersionId = versions[0]?.id;
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/fix`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": makeIdemKey(),
        },
        body: JSON.stringify(payload),
      }, FIX_REQUEST_TIMEOUT_MS);
      await requestJson(`${API_BASE}/chapters/${chapterId}/evaluate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      await reload(chapterId);
      setFixPreview(null);
      setPreviewPayload(null);
      setActionMessage(successMessage);
    } catch (error) {
      const message = formatErrorMessage(error, "修复失败");
      const isTimeout = message.includes("请求超时");
      if (isTimeout) {
        const hasVersionUpdate = await reloadUntilVersionUpdate(chapterId, previousLatestVersionId, {
          retries: 18,
          intervalMs: 3_000,
        });
        if (hasVersionUpdate) {
          setActionError("");
          setActionMessage("修复请求超时，但后台已完成并同步了新版本。");
        } else {
          setActionError("修复请求超时，后台可能仍在执行。请稍后点“选择版本”查看是否出现新版本。");
          setActionMessage("");
        }
      } else {
        setActionError(message);
        setActionMessage("");
      }
    } finally {
      setActionLoading(false);
    }
  }

  function buildIssueFixPayload(issue: any, strategyIndex: number) {
    if (!selectedVersionId) {
      throw new Error("请先选择基础版本");
    }
    const mode = FIX_MODE_BY_STRATEGY_INDEX[strategyIndex] ?? "replace_span";
    const payload: Record<string, unknown> = {
      base_version_id: selectedVersionId,
      mode,
      issue_ids: [issue.issue_id],
      strategy_id: `strategy-${strategyIndex + 1}`,
      instruction: buildCustomInstruction(issue?.message),
    };

    if (mode === "replace_span") {
      payload.span = {
        from: issue.evidence.from,
        to: issue.evidence.to,
      };
    } else if (mode === "rewrite_section") {
      const sceneIndex = resolveSceneIndexForIssue(issue);
      if (sceneIndex === null) {
        throw new Error("当前问题未定位到场景锚点，无法场景重写。请改用局部替换或整章重写。");
      }
      payload.section = { scene_index: sceneIndex };
    }

    return payload;
  }

  function buildManualFixPayload() {
    if (!selectedVersionId) {
      throw new Error("请先选择基础版本");
    }

    const payload: Record<string, unknown> = {
      base_version_id: selectedVersionId,
      mode: manualFixMode,
      strategy_id: `custom-${manualFixMode}`,
      instruction: buildCustomInstruction("自定义修复请求"),
    };

    if (manualFixMode === "replace_span") {
      const span = selectionSpan ?? captureEditorSelectionSpan();
      const coverage = editorText.length > 0 ? (span.to - span.from) / editorText.length : 0;
      if (coverage > 0.8) {
        throw new Error("当前选区覆盖整章（>80%）。建议改用“整章重写”模式，避免局部替换超时。");
      }
      payload.span = span;
    }

    if (manualFixMode === "rewrite_section") {
      const sceneIndex = Number.parseInt(manualSceneIndex, 10);
      if (!Number.isFinite(sceneIndex) || sceneIndex < 0) {
        throw new Error("场景序号必须是大于等于 0 的整数");
      }
      payload.section = { scene_index: sceneIndex };
    }

    return payload;
  }

  async function runFix(issue: any, strategyIndex: number) {
    if (!chapterId || !selectedVersionId) return;
    try {
      const payload = buildIssueFixPayload(issue, strategyIndex);
      await executeFix(payload);
    } catch (error) {
      setActionError(formatErrorMessage(error, "修复失败"));
    }
  }

  async function runIssuePreview(issue: any, strategyIndex: number) {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    try {
      const payload = buildIssueFixPayload(issue, strategyIndex);
      await runFixPreview(payload);
    } catch (error) {
      setActionError(formatErrorMessage(error, "预估失败"));
    }
  }

  async function runManualFixPreview() {
    if (!chapterId || !selectedVersionId) return;
    setActionError("");
    try {
      const payload = buildManualFixPayload();
      await runFixPreview(payload);
    } catch (error) {
      setActionError(formatErrorMessage(error, "预估失败"));
    }
  }

  async function runManualFix() {
    if (!chapterId || !selectedVersionId) return;
    try {
      const payload = buildManualFixPayload();
      await executeFix(payload, "自定义修复完成并已复评");
    } catch (error) {
      setActionError(formatErrorMessage(error, "自定义修复失败"));
    }
  }

  async function runSelectionFix() {
    if (!chapterId || !selectedVersionId) return;
    try {
      const span = captureEditorSelectionSpan();
      const payload: Record<string, unknown> = {
        base_version_id: selectedVersionId,
        mode: "replace_span",
        span,
        strategy_id: "selection-quick-fix",
        instruction: buildCustomInstruction("对当前选区做局部修复"),
      };
      await executeFix(payload, "选区修复完成并已复评");
    } catch (error) {
      setActionError(formatErrorMessage(error, "选区修复失败"));
    }
  }

  async function runNumericConsistencyFix() {
    if (!chapterId || !selectedVersionId) return;
    await executeFix(
      {
        base_version_id: selectedVersionId,
        mode: "rewrite_chapter",
        strategy_id: "numeric-consistency",
        instruction:
          "仅修复前后文数字、年龄、金额、时间、数量不一致问题。禁止改动剧情走向、人物关系、伏笔。若数字无冲突则保持原文。",
      },
      "数字一致性修复完成并已复评",
    );
  }

  async function runDeduplicateCleanup() {
    if (!chapterId || !selectedVersionId) return;
    await executeFix(
      {
        base_version_id: selectedVersionId,
        mode: "rewrite_chapter",
        strategy_id: "deduplicate-cleanup",
        instruction:
          "清理重复开篇与重复段落。正文中不允许出现“## 场景X”这类小标题。保留剧情事实、时间线、数字信息和人物关系不变。",
      },
      "清理重复段完成并已复评",
    );
  }

  async function runReduceWordRepetition() {
    if (!chapterId || !selectedVersionId) return;
    await executeFix(
      {
        base_version_id: selectedVersionId,
        mode: "rewrite_chapter",
        strategy_id: "reduce-word-repetition",
        instruction:
          "减少重复抽象词（如权谋、代价、命运、未知）的出现频率。优先改成具体动作/细节/对白表达，不改剧情事实、时间线和数字信息。",
      },
      "降重复词完成并已复评",
    );
  }

  async function createSecondChapterTemplate() {
    if (!projectId) return;
    setActionError("");
    setActionMessage("正在创建第2章衔接模板...");
    setActionLoading(true);
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/chapters/second-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      router.push(data.workspace_path ?? `/projects/${projectId}/chapters/2/workspace`);
    } catch (error) {
      setActionError(formatErrorMessage(error, "创建第二章模板失败"));
      setActionMessage("");
    } finally {
      setActionLoading(false);
    }
  }

  async function updateItemStatus(kind: "facts" | "seeds" | "timeline", id: string, status: string) {
    if (!chapterId) return;
    setActionError("");
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/${kind}/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      });
      await reload(chapterId);
    } catch (error) {
      setActionError(formatErrorMessage(error, "更新条目状态失败"));
    }
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
  const repeatedLowIssues = useMemo(
    () => issues.filter((issue: any) => issue?.severity?.toLowerCase() === "low" && issue?.type === "knowledge_unknown"),
    [issues],
  );
  const nonRepeatedIssues = useMemo(
    () => issues.filter((issue: any) => !(issue?.severity?.toLowerCase() === "low" && issue?.type === "knowledge_unknown")),
    [issues],
  );
  const collapsedRepeatedCount = Math.max(0, repeatedLowIssues.length - 3);
  const visibleIssues = useMemo(() => {
    if (showAllIssues) {
      return issues;
    }
    return [...nonRepeatedIssues, ...repeatedLowIssues.slice(0, 3)];
  }, [issues, nonRepeatedIssues, repeatedLowIssues, showAllIssues]);
  const quality = workspace?.quality_report;
  const director = workspace?.director_review;
  const qualityTrend = workspace?.quality_trend ?? [];
  const recentFixTasks = workspace?.fix_tasks ?? [];
  const selectedVersionMeta = useMemo(
    () => versions.find((item: any) => item.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  if (!projectId || !chapterId) {
    return (
      <main className="p-8">
        <p>{loadingMessage}</p>
        {actionError && <p className="mt-2 text-sm text-red-700">{actionError}</p>}
      </main>
    );
  }

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
              {actionLoading ? "处理中..." : `生成${STAGE_LABELS[tab]}`}
            </Button>
            <Button variant="ghost" disabled={actionLoading} onClick={runEvaluate}>
              质量评估
            </Button>
            <Button variant="ghost" disabled={actionLoading} onClick={() => void runDirectorReview(false)}>
              总编评审
            </Button>
            <Button variant="secondary" disabled={actionLoading} onClick={() => void runDirectorReview(true)}>
              总编闭环（自动修复）
            </Button>
            <Button
              variant="ghost"
              disabled={actionLoading}
              onClick={() => {
                try {
                  const span = captureEditorSelectionSpan();
                  setActionMessage(`已读取选区：${span.from}-${span.to}`);
                } catch (error) {
                  setActionError(formatErrorMessage(error, "读取选区失败"));
                }
              }}
            >
              读取选区
            </Button>
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId} onClick={runSelectionFix}>
              选区局部修复
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
          {!actionError && actionMessage && (
            <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {actionMessage}
            </div>
          )}

          <div className="mb-3 rounded border border-black/10 bg-black/[0.02] p-3">
            <p className="text-sm font-semibold">修复定制面板</p>
            <div className="mt-2 grid gap-2 text-xs">
              <label className="grid gap-1">
                <span className="text-black/70">修复目标（fix_goal）</span>
                <textarea
                  className="h-16 rounded border border-black/15 px-2 py-1 text-xs"
                  value={fixGoal}
                  onChange={(e) => setFixGoal(e.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-black/70">保留元素（keep_elements，用逗号分隔）</span>
                <input
                  className="rounded border border-black/15 px-2 py-1 text-xs"
                  value={keepElementsText}
                  onChange={(e) => setKeepElementsText(e.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-black/70">禁止改动（forbidden_changes，用逗号分隔）</span>
                <input
                  className="rounded border border-black/15 px-2 py-1 text-xs"
                  value={forbiddenChangesText}
                  onChange={(e) => setForbiddenChangesText(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-black/70">目标强度</span>
                  <select
                    className="rounded border border-black/15 px-2 py-1 text-xs"
                    value={targetIntensity}
                    onChange={(e) => setTargetIntensity(e.target.value as FixIntensity)}
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-black/70">自定义模式</span>
                  <select
                    className="rounded border border-black/15 px-2 py-1 text-xs"
                    value={manualFixMode}
                    onChange={(e) => setManualFixMode(e.target.value as FixMode)}
                  >
                    <option value="replace_span">局部替换</option>
                    <option value="rewrite_section">场景重写</option>
                    <option value="rewrite_chapter">整章重写</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-black/70">场景序号（场景重写用）</span>
                  <input
                    className="rounded border border-black/15 px-2 py-1 text-xs"
                    value={manualSceneIndex}
                    onChange={(e) => setManualSceneIndex(e.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>
              <p className="text-[11px] text-black/60">
                当前选区：{selectionSpan ? `${selectionSpan.from}-${selectionSpan.to}` : "未读取选区"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={actionLoading || previewLoading} onClick={runManualFixPreview}>
                  {previewLoading ? "预估中..." : "预估自定义修复"}
                </Button>
                <Button variant="ghost" disabled={actionLoading} onClick={runManualFix}>
                  执行自定义修复
                </Button>
                <Button
                  variant="ghost"
                  disabled={actionLoading || !previewPayload}
                  onClick={() => void executeFix(previewPayload!, "按预估方案修复完成并已复评")}
                >
                  执行当前预估方案
                </Button>
              </div>
              {previewError && <p className="text-[11px] text-red-700">{previewError}</p>}
              {fixPreview && (
                <div className="rounded border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900">
                  <p className="font-semibold">修复预估</p>
                  <p>
                    风险：{fixPreview.risk_level} | 覆盖范围：{fixPreview.target_chars}/{fixPreview.chapter_chars} (
                    {(Number(fixPreview.impact_ratio) * 100).toFixed(1)}%)
                  </p>
                  <p>模式：{fixPreview.mode}</p>
                  <p>操作：{fixPreview.estimated_operation}</p>
                  <p>建议：{fixPreview.suggestion}</p>
                  <p className="mt-1">
                    可能影响角色：{Array.isArray(fixPreview.touched_entities?.characters) ? fixPreview.touched_entities.characters.join("、") || "无" : "无"}
                  </p>
                  <p>
                    可能关联种子：{Array.isArray(fixPreview.touched_entities?.seeds) ? fixPreview.touched_entities.seeds.length : 0} 条
                  </p>
                  <p>
                    可能关联事实：{Array.isArray(fixPreview.touched_entities?.facts) ? fixPreview.touched_entities.facts.length : 0} 条
                  </p>
                </div>
              )}
            </div>
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
                  v{v.version_no} ({v.stage}{v.fix_mode ? `/${v.fix_mode}` : ""})
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
                  v{v.version_no} ({v.stage}{v.fix_mode ? `/${v.fix_mode}` : ""})
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

          {selectedVersionMeta && (
            <div className="mb-3 rounded border border-black/10 bg-black/[0.02] p-2 text-xs">
              <p>
                当前版本：v{selectedVersionMeta.version_no}
                {selectedVersionMeta.fix_mode ? ` / ${selectedVersionMeta.fix_mode}` : ""}
                {selectedVersionMeta.strategy_id ? ` / ${selectedVersionMeta.strategy_id}` : ""}
              </p>
              {selectedVersionMeta.parent_version_id && (
                <p>父版本：{String(selectedVersionMeta.parent_version_id).slice(0, 8)}...</p>
              )}
              {selectedVersionMeta.instruction_excerpt && (
                <p className="mt-1 text-black/70">指令摘要：{selectedVersionMeta.instruction_excerpt}</p>
              )}
            </div>
          )}

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
          <h2 className="font-medium">Diagnostics Panel</h2>
          <div className="mt-2 rounded border border-black/10 p-2 text-xs">
            <p>开头钩子分：{quality?.opening_hook ?? "-"}</p>
            <p>冲突分：{quality?.conflict_strength ?? "-"}</p>
            <p>节奏分：{quality?.pacing ?? "-"}</p>
            <p>对白分：{quality?.dialogue_quality ?? "-"}</p>
            <p>结尾钩子分：{quality?.ending_hook ?? "-"}</p>
            <p>总分：{quality?.overall_score ?? "-"}</p>
          </div>

          <div className="mt-2 rounded border border-black/10 p-2 text-xs">
            <p className="font-medium">最近 3 次分数趋势</p>
            {qualityTrend.length === 0 && <p className="text-black/60">暂无趋势数据</p>}
            {qualityTrend.map((item: any) => (
              <p key={item.version_id}>
                {item.version_id.slice(0, 8)}... : {item.overall_score}
              </p>
            ))}
          </div>

          <div className="mt-2 rounded border border-black/10 p-2 text-xs">
            <p className="font-medium">Director 建议</p>
            {!director && <p className="text-black/60">暂无总编建议</p>}
            {director && (
              <>
                <p>决策：{director.decision}</p>
                <p>节奏方向：{director.pacing_direction ?? "-"}</p>
                <p>钩子建议：{director.hook_upgrade ?? "-"}</p>
                <p>主线校正：{director.arc_correction ?? "-"}</p>
              </>
            )}
          </div>

          <div className="mt-2 rounded border border-black/10 p-2 text-xs">
            <p className="font-medium">推荐 Fix 操作</p>
            {recentFixTasks.length === 0 && <p className="text-black/60">暂无 fix task</p>}
            {recentFixTasks.slice(0, 3).map((task: any) => (
              <p key={task.id}>
                {task.issue_type}
                {" -> "}
                {task.status}
              </p>
            ))}
          </div>

          <h2 className="mt-4 font-medium">一致性报告</h2>
          <div className="mt-2 space-y-3">
            <div className="rounded border border-black/10 bg-black/[0.02] p-2 text-[11px] text-black/70">
              <p className="font-medium text-black/80">处理顺序</p>
              <p>1) 先点“跳转段落”定位问题。</p>
              <p>2) 优先点“推荐修复”。</p>
              <p>3) 修完后点“质量评估”复评。</p>
              <p className="mt-1">策略1=局部替换，策略2=场景重写，策略3=整章重写。</p>
            </div>

            {!showAllIssues && collapsedRepeatedCount > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                已折叠 {collapsedRepeatedCount} 条重复的低优先级问题（knowledge_unknown）。
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => setShowAllIssues(true)}
                >
                  展开全部
                </button>
              </div>
            )}
            {showAllIssues && collapsedRepeatedCount > 0 && (
              <div className="rounded border border-black/10 px-2 py-1 text-[11px] text-black/70">
                已展开全部问题。
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => setShowAllIssues(false)}
                >
                  收起重复项
                </button>
              </div>
            )}

            {visibleIssues.length === 0 && <p className="text-sm text-black/60">暂无问题</p>}
            {visibleIssues.map((issue: any) => {
              const recommendedIdx = pickRecommendedStrategyIndex(issue);
              const recommendedMode = FIX_MODE_BY_STRATEGY_INDEX[recommendedIdx] ?? "replace_span";
              const recommendedLabel = FIX_MODE_LABELS[recommendedMode];
              const recommendedRisk = FIX_MODE_RISK_LABELS[recommendedMode];
              return (
              <div key={issue.issue_id} className="rounded border border-black/10 p-2">
                <p className="text-xs uppercase text-black/60">{issue.severity}</p>
                <p className="text-sm">{issue.message}</p>
                <Button className="mt-2" variant="ghost" onClick={() => jumpToEvidence(issue)}>
                  跳转段落
                </Button>
                <p className="mt-1 text-[11px] text-black/60">
                  推荐策略风险：{recommendedRisk}
                </p>
                <div className="mt-2 grid gap-1">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={actionLoading}
                      onClick={() => runFix(issue, recommendedIdx)}
                      title={fixStrategies[recommendedIdx] ?? ""}
                    >
                      {`推荐修复：策略${recommendedIdx + 1}（${recommendedLabel}）`}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={previewLoading}
                      onClick={() => runIssuePreview(issue, recommendedIdx)}
                    >
                      {previewLoading ? "预估中..." : "预估影响"}
                    </Button>
                  </div>
                  <details className="rounded border border-black/10 px-2 py-1">
                    <summary className="cursor-pointer text-[11px] text-black/65">更多策略</summary>
                    <div className="mt-2 grid gap-1">
                      {fixStrategies.map((strategy: string, idx: number) => {
                        if (idx === recommendedIdx) return null;
                        const mode = FIX_MODE_BY_STRATEGY_INDEX[idx] ?? "replace_span";
                        const label = FIX_MODE_LABELS[mode];
                        const riskLabel = FIX_MODE_RISK_LABELS[mode];
                        return (
                          <Button
                            key={`${issue.issue_id}-${idx}`}
                            variant="ghost"
                            disabled={actionLoading}
                            onClick={() => runFix(issue, idx)}
                            title={strategy}
                          >
                            {`策略${idx + 1}：${label}（${riskLabel}）`}
                          </Button>
                        );
                      })}
                    </div>
                  </details>
                </div>
              </div>
            );
            })}
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
