"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { AUTHOR_ADVISOR_PROMPTS, FIX_MODE_BY_STRATEGY_INDEX, RESOURCE_GROUP_LABELS } from "./constants";
import type {
  AdvisorMessage,
  ChapterIntentData,
  FixIntensity,
  FixMode,
  HandoffBriefData,
  Issue,
  PromptTraceItem,
  PublishReadinessData,
  StageTab,
  VersionMeta,
  WorkspaceData,
} from "./types";

type RouteParams = Promise<{ id: string; no: string }>;

const REQUEST_TIMEOUT_MS = 120_000;
const PIPELINE_TIMEOUT_MS = 720_000;
const FIX_REQUEST_TIMEOUT_MS = 420_000;
const DIRECTOR_REVIEW_TIMEOUT_MS = 180_000;
const DIRECTOR_AUTOFIX_TIMEOUT_MS = 420_000;
const GENERATE_TIMEOUT_BY_STAGE: Record<StageTab, number> = {
  beats: 240_000,
  draft: 300_000,
  polish: 480_000,
};

function makeIdemKey() {
  return crypto.randomUUID();
}

function toRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, any>;
}

function toArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

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

function buildHotResources(resourceReferences: Record<string, unknown[]>) {
  return Object.entries(resourceReferences)
    .flatMap(([group, items]) =>
      toArray<Record<string, any>>(items).map((item) => ({
        group,
        item,
        totalHits: Number(toRecord(item.stats)?.total_hits ?? item.occurrence_count ?? 0),
      })),
    )
    .sort((a, b) => b.totalHits - a.totalHits)
    .slice(0, 6);
}

export function useChapterWorkspace(params: RouteParams) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [chapterNo, setChapterNo] = useState(0);
  const [chapterId, setChapterId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [compareVersionId, setCompareVersionId] = useState("");
  const [tab, setTab] = useState<StageTab>("draft");
  const [editorText, setEditorText] = useState("");
  const [diffData, setDiffData] = useState<any>(null);
  const [loadingMessage, setLoadingMessage] = useState("正在加载工作台...");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [intentMission, setIntentMission] = useState("");
  const [intentAdvanceGoal, setIntentAdvanceGoal] = useState("");
  const [intentConflictTarget, setIntentConflictTarget] = useState("");
  const [intentHookTarget, setIntentHookTarget] = useState("");
  const [intentPacingDirection, setIntentPacingDirection] = useState("");
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
  const [advisorMessages, setAdvisorMessages] = useState<AdvisorMessage[]>([]);
  const [advisorInput, setAdvisorInput] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState("");
  const [advisorQuickPrompts, setAdvisorQuickPrompts] = useState<string[]>(AUTHOR_ADVISOR_PROMPTS);
  const monacoRef = useRef<any>(null);
  const versionTextCacheRef = useRef<Record<string, string>>({});

  async function requestJson<T = any>(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
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
      return data as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`请求超时（>${Math.ceil(timeoutMs / 1000)}秒）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function cacheLatestVersion(workspaceData: WorkspaceData) {
    const latestVersion = workspaceData.latest_version;
    if (latestVersion?.id && typeof workspaceData.latest_version_text === "string") {
      versionTextCacheRef.current[latestVersion.id] = workspaceData.latest_version_text;
    }
  }

  async function loadVersionText(chId: string, versionId: string) {
    if (!versionId) return "";
    const cached = versionTextCacheRef.current[versionId];
    if (typeof cached === "string") {
      return cached;
    }
    const data = await requestJson<{ text?: string }>(`${API_BASE}/chapters/${chId}/versions/${versionId}`);
    const text = typeof data?.text === "string" ? data.text : "";
    versionTextCacheRef.current[versionId] = text;
    return text;
  }

  function syncIntentDrafts(workspaceData: WorkspaceData) {
    const latestIntent = toRecord(workspaceData.latest_intent);
    const chapter = toRecord(workspaceData.chapter);
    const contextBrief = toRecord(toRecord(workspaceData.context_brief)?.context_brief);

    setIntentMission(
      String(latestIntent?.chapter_mission ?? contextBrief?.chapter_mission ?? chapter?.goal ?? ""),
    );
    setIntentAdvanceGoal(String(latestIntent?.advance_goal ?? chapter?.goal ?? ""));
    setIntentConflictTarget(String(latestIntent?.conflict_target ?? chapter?.conflict ?? ""));
    setIntentHookTarget(String(latestIntent?.hook_target ?? chapter?.cliffhanger ?? ""));
    setIntentPacingDirection(String(latestIntent?.pacing_direction ?? ""));
  }

  function syncWorkspaceState(workspaceData: WorkspaceData, options?: { preferredVersionId?: string }) {
    setWorkspace(workspaceData);
    cacheLatestVersion(workspaceData);
    syncIntentDrafts(workspaceData);

    const nextVersions = Array.isArray(workspaceData.versions) ? workspaceData.versions : [];
    setVersions(nextVersions);
    setDiffData(null);

    const preferredVersionId = options?.preferredVersionId;
    const latestVersionId = workspaceData.latest_version?.id ?? nextVersions[0]?.id ?? "";
    const nextSelectedVersionId =
      preferredVersionId && nextVersions.some((item) => item.id === preferredVersionId) ? preferredVersionId : latestVersionId;

    setSelectedVersionId(nextSelectedVersionId);
    if (compareVersionId && !nextVersions.some((item) => item.id === compareVersionId)) {
      setCompareVersionId("");
    }

    if (!nextSelectedVersionId) {
      setEditorText("");
      return;
    }

    if (nextSelectedVersionId === workspaceData.latest_version?.id) {
      setEditorText(workspaceData.latest_version_text ?? "");
    }
  }

  async function loadWorkspace(chId: string, options?: { preferredVersionId?: string }) {
    const workspaceData = await requestJson<WorkspaceData>(`${API_BASE}/chapters/${chId}/workspace`);
    syncWorkspaceState(workspaceData, options);
    return workspaceData;
  }

  async function persistChapterIntent(options?: { refresh?: boolean }) {
    if (!chapterId) return null;

    const payload = {
      chapter_mission: intentMission.trim(),
      advance_goal: intentAdvanceGoal.trim() || undefined,
      conflict_target: intentConflictTarget.trim() || undefined,
      hook_target: intentHookTarget.trim() || undefined,
      pacing_direction: intentPacingDirection.trim() || undefined,
    };
    const hasAnyValue = Object.values(payload).some((value) => typeof value === "string" && value.trim().length > 0);
    if (!hasAnyValue) {
      return null;
    }
    if (!payload.chapter_mission) {
      throw new Error("请先填写章节使命，再保存本章意图");
    }

    const result = await requestJson<ChapterIntentData>(
      `${API_BASE}/chapters/${chapterId}/intent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      REQUEST_TIMEOUT_MS,
    );

    if (options?.refresh !== false) {
      await loadWorkspace(chapterId, selectedVersionId ? { preferredVersionId: selectedVersionId } : undefined);
    }
    return result;
  }

  async function saveChapterIntent() {
    if (!chapterId) return;
    setActionError("");
    setActionMessage("正在保存章节意图...");
    setActionLoading(true);
    try {
      await persistChapterIntent();
      setActionMessage("章节意图已保存");
    } catch (error) {
      setActionError(formatErrorMessage(error, "保存章节意图失败"));
      setActionMessage("");
    } finally {
      setActionLoading(false);
    }
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
        setActionMessage("");

        const chapter = await requestJson<{ id: string }>(`${API_BASE}/projects/${id}/chapters/by-no/${noInt}`);
        if (cancelled) return;

        setChapterId(chapter.id);
        versionTextCacheRef.current = {};
        await loadWorkspace(chapter.id);
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

  async function runMutation(options: {
    request: () => Promise<any>;
    loadingMessage: string;
    successMessage: string;
    fallbackError: string;
    timeoutMessage: string;
    refresh?: boolean;
    preserveSelection?: boolean;
    onSuccess?: (result: any) => Promise<void> | void;
  }) {
    if (!chapterId) return;
    setActionError("");
    setActionMessage(options.loadingMessage);
    setActionLoading(true);
    try {
      const result = await options.request();
      await options.onSuccess?.(result);
      if (options.refresh !== false) {
        await loadWorkspace(chapterId, options.preserveSelection ? { preferredVersionId: selectedVersionId } : undefined);
      }
      setActionMessage(options.successMessage);
    } catch (error) {
      const message = formatErrorMessage(error, options.fallbackError);
      if (message.includes("请求超时")) {
        setActionError(options.timeoutMessage);
        setActionMessage("");
      } else {
        setActionError(message);
        setActionMessage("");
      }
    } finally {
      setActionLoading(false);
    }
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

  function resolveSceneIndexForIssue(issue: Record<string, any>): number | null {
    const issueFrom = issue?.evidence?.from;
    if (typeof issueFrom !== "number") return null;
    const scenes = toArray<Record<string, any>>(workspace?.chapter_memory?.scene_list);
    const targetScene = scenes.find((scene) => {
      const from = scene?.anchor_span?.from;
      const to = scene?.anchor_span?.to;
      return typeof from === "number" && typeof to === "number" && issueFrom >= from && issueFrom <= to;
    });
    return typeof targetScene?.scene_index === "number" ? targetScene.scene_index : null;
  }

  function pickRecommendedStrategyIndex(issue: Record<string, any>) {
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

  function buildIssueFixPayload(issue: Record<string, any>, strategyIndex: number) {
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
        from: issue?.evidence?.from,
        to: issue?.evidence?.to,
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

  async function executeFix(payload: Record<string, unknown>, successMessage = "修复完成并已复评") {
    await runMutation({
      loadingMessage: "正在执行定向修复...",
      successMessage,
      fallbackError: "修复失败",
      timeoutMessage: "修复请求超时，后台可能仍在执行。请稍后刷新工作台查看最新版本。",
      request: async () => {
        const result = await requestJson<{ new_version_id?: string }>(
          `${API_BASE}/chapters/${chapterId}/fix`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": makeIdemKey(),
            },
            body: JSON.stringify(payload),
          },
          FIX_REQUEST_TIMEOUT_MS,
        );
        await requestJson(
          `${API_BASE}/chapters/${chapterId}/evaluate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(result?.new_version_id ? { version_id: result.new_version_id } : {}),
          },
          REQUEST_TIMEOUT_MS,
        );
        return result;
      },
      onSuccess: async () => {
        setFixPreview(null);
        setPreviewPayload(null);
      },
    });
  }

  async function runPipeline() {
    await runMutation({
      loadingMessage: "正在运行主流程...",
      successMessage: "主流程已完成，工作台已刷新",
      fallbackError: "主流程执行失败",
      timeoutMessage: "主流程请求超时，后台可能仍在执行。请稍后刷新工作台查看最新版本。",
      request: async () => {
        await persistChapterIntent({ refresh: false });
        return requestJson(
          `${API_BASE}/chapters/${chapterId}/pipeline-run`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          },
          PIPELINE_TIMEOUT_MS,
        );
      },
    });
  }

  async function runGenerate(stage: StageTab) {
    await runMutation({
      loadingMessage: `正在生成${stage === "beats" ? "场景骨架" : stage === "draft" ? "正文初稿" : "润色定稿"}...`,
      successMessage: "高级生成已完成",
      fallbackError: "生成失败",
      timeoutMessage: "生成请求超时，后台可能仍在执行。请稍后刷新工作台查看最新版本。",
      request: () =>
        requestJson(
          `${API_BASE}/chapters/${chapterId}/generate/${stage}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": makeIdemKey(),
            },
            body: JSON.stringify({ k: 50 }),
          },
          GENERATE_TIMEOUT_BY_STAGE[stage],
        ),
    });
  }

  async function runEvaluate() {
    await runMutation({
      loadingMessage: "正在执行质量评估...",
      successMessage: "质量评估已更新",
      fallbackError: "评估失败",
      timeoutMessage: "质量评估请求超时，请稍后刷新工作台查看结果。",
      preserveSelection: true,
      request: () =>
        requestJson(`${API_BASE}/chapters/${chapterId}/evaluate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(selectedVersionId ? { version_id: selectedVersionId } : {}),
        }),
    });
  }

  async function runDirectorReview(autoFix = false) {
    await runMutation({
      loadingMessage: autoFix ? "总编正在评审并自动修复..." : "总编正在评审...",
      successMessage: autoFix ? "总编闭环完成，工作台已刷新" : "总编评审完成",
      fallbackError: autoFix ? "总编闭环失败" : "总编评审失败",
      timeoutMessage: autoFix
        ? "总编闭环请求超时，后台可能仍在执行。请稍后刷新工作台查看最新版本。"
        : "总编评审请求超时，请稍后刷新工作台查看结果。",
      preserveSelection: !autoFix,
      request: () =>
        requestJson(
          `${API_BASE}/chapters/${chapterId}/director-review`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              version_id: selectedVersionId || undefined,
              auto_fix: autoFix,
            }),
          },
          autoFix ? DIRECTOR_AUTOFIX_TIMEOUT_MS : DIRECTOR_REVIEW_TIMEOUT_MS,
        ),
    });
  }

  async function runRollback() {
    if (!selectedVersionId) return;
    await runMutation({
      loadingMessage: "正在回滚版本...",
      successMessage: "版本回滚完成",
      fallbackError: "回滚失败",
      timeoutMessage: "回滚请求超时，请稍后刷新工作台查看结果。",
      request: () =>
        requestJson(`${API_BASE}/chapters/${chapterId}/rollback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ version_id: selectedVersionId }),
        }),
    });
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

  async function runFix(issue: Record<string, any>, strategyIndex: number) {
    if (!chapterId || !selectedVersionId) return;
    try {
      const payload = buildIssueFixPayload(issue, strategyIndex);
      await executeFix(payload);
    } catch (error) {
      setActionError(formatErrorMessage(error, "修复失败"));
    }
  }

  async function runIssuePreview(issue: Record<string, any>, strategyIndex: number) {
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

  async function executePreviewFix() {
    if (!previewPayload) return;
    await executeFix(previewPayload, "按预估方案修复完成并已复评");
  }

  async function readSelection() {
    try {
      const span = captureEditorSelectionSpan();
      setActionError("");
      setActionMessage(`已读取选区：${span.from}-${span.to}`);
    } catch (error) {
      setActionError(formatErrorMessage(error, "读取选区失败"));
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
          "减少重复抽象词（如权谋、代价、命运、未知）的出现频率。优先改成具体动作、细节或对白表达，不改剧情事实、时间线和数字信息。",
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
      const data = await requestJson<{ workspace_path?: string }>(`${API_BASE}/projects/${projectId}/chapters/second-template`, {
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

  async function askAuthorAdvisor(questionOverride?: string) {
    if (!chapterId) return;
    const question = (questionOverride ?? advisorInput).trim();
    if (!question) return;

    const nextMessages: AdvisorMessage[] = [...advisorMessages, { role: "user", content: question }];
    setAdvisorMessages(nextMessages);
    setAdvisorInput("");
    setAdvisorError("");
    setAdvisorLoading(true);

    try {
      const response = await requestJson<{ reply?: string; quick_prompts?: string[] }>(
        `${API_BASE}/chapters/${chapterId}/author-advice`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question,
            version_id: selectedVersionId || undefined,
            draft_text: editorText,
            messages: nextMessages,
          }),
        },
        100_000,
      );
      setAdvisorMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: typeof response.reply === "string" && response.reply.trim() ? response.reply : "我暂时没整理出有效建议。",
        },
      ]);
      if (Array.isArray(response.quick_prompts) && response.quick_prompts.length > 0) {
        setAdvisorQuickPrompts(response.quick_prompts);
      }
    } catch (error) {
      setAdvisorError(formatErrorMessage(error, "AI 建议获取失败"));
    } finally {
      setAdvisorLoading(false);
    }
  }

  async function updateItemStatus(kind: "facts" | "seeds" | "timeline", id: string, status: string) {
    if (!chapterId) return;
    await runMutation({
      loadingMessage: "正在更新抽取项状态...",
      successMessage: "抽取项状态已更新",
      fallbackError: "更新条目状态失败",
      timeoutMessage: "更新抽取项状态超时，请稍后刷新工作台查看结果。",
      preserveSelection: true,
      request: () =>
        requestJson(`${API_BASE}/chapters/${chapterId}/${kind}/${id}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        }),
    });
  }

  async function updateReferenceState(resourceType: string, resourceId: string, state: "confirmed" | "ignored" | "inferred") {
    if (!chapterId || !projectId) return;
    await runMutation({
      loadingMessage: "正在更新资源引用状态...",
      successMessage: "资源引用状态已更新",
      fallbackError: "资源引用状态更新失败",
      timeoutMessage: "资源引用状态更新超时，请稍后刷新工作台查看结果。",
      preserveSelection: true,
      request: () =>
        requestJson(`${API_BASE}/projects/${projectId}/chapters/${chapterId}/references`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: [{ resource_type: resourceType, resource_id: resourceId, state }],
          }),
        }),
    });
  }

  async function rebuildResourceReferences() {
    if (!chapterId || !projectId) return;
    await runMutation({
      loadingMessage: "正在重新扫描资源引用...",
      successMessage: "资源引用已重新扫描",
      fallbackError: "资源引用重扫失败",
      timeoutMessage: "资源引用重扫超时，请稍后刷新工作台查看结果。",
      preserveSelection: true,
      request: () =>
        requestJson(`${API_BASE}/projects/${projectId}/chapters/${chapterId}/references/rebuild`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }),
    });
  }

  function jumpToEvidence(issue: Record<string, any>) {
    if (!monacoRef.current?.editor) return;
    const model = monacoRef.current.editor.getModel();
    if (!model) return;
    if (typeof issue?.evidence?.from !== "number" || typeof issue?.evidence?.to !== "number") {
      return;
    }

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

  const diagnostics = toRecord(workspace?.diagnostics);
  const promptTrace = useMemo(() => {
    const rootTrace = toArray<PromptTraceItem>(workspace?.prompt_trace);
    if (rootTrace.length > 0) {
      return rootTrace;
    }
    return toArray<PromptTraceItem>(diagnostics?.prompt_trace);
  }, [diagnostics?.prompt_trace, workspace?.prompt_trace]);
  const continuityReport = toRecord(diagnostics?.continuity) ?? toRecord(workspace?.continuity_report);
  const continuityReportPayload =
    toRecord(toRecord(continuityReport?.report)?.raw) ??
    toRecord(workspace?.legacy_consistency_report?.report) ??
    toRecord(continuityReport?.report) ??
    {};
  const issues = useMemo<Issue[]>(
    () => toArray<Issue>(continuityReportPayload.issues),
    [continuityReportPayload],
  );
  const fixStrategies = useMemo(
    () => {
      const strategies = toArray<string>(continuityReportPayload.fix_strategies);
      return strategies.length > 0 ? strategies : ["策略1", "策略2", "策略3"];
    },
    [continuityReportPayload],
  );
  const repeatedLowIssues = useMemo(
    () => issues.filter((issue) => issue?.severity?.toLowerCase() === "low" && issue?.type === "knowledge_unknown"),
    [issues],
  );
  const nonRepeatedIssues = useMemo(
    () => issues.filter((issue) => !(issue?.severity?.toLowerCase() === "low" && issue?.type === "knowledge_unknown")),
    [issues],
  );
  const collapsedRepeatedCount = Math.max(0, repeatedLowIssues.length - 3);
  const visibleIssues = useMemo(() => {
    if (showAllIssues) {
      return issues;
    }
    return [...nonRepeatedIssues, ...repeatedLowIssues.slice(0, 3)];
  }, [issues, nonRepeatedIssues, repeatedLowIssues, showAllIssues]);

  const quality = diagnostics?.latest_quality ?? workspace?.quality_report ?? null;
  const director = diagnostics?.director ?? workspace?.director_review ?? null;
  const qualityTrend = toArray<{ version_id: string; overall_score: number }>(diagnostics?.quality_trend ?? workspace?.quality_trend);
  const recentFixTasks = toArray<Record<string, any>>(diagnostics?.fix_actions ?? workspace?.fix_tasks);
  const resourceReferences =
    toRecord(diagnostics?.resource_references)?.references ??
    toRecord(workspace?.resource_references)?.references ?? {
      characters: [],
      glossary: [],
      relationships: [],
      timeline: [],
      sensitive_words: [],
      regex_rules: [],
    };
  const resourceSummary =
    diagnostics?.resource_reference_summary ??
    workspace?.resource_summary ??
    toRecord(workspace?.resource_references)?.summary ??
    null;
  const resourceSections = Object.entries(resourceReferences).filter(([, items]) => Array.isArray(items) && items.length > 0);
  const resourceRuleHits =
    toArray<Record<string, any>>(diagnostics?.rule_hits).length > 0
      ? toArray<Record<string, any>>(diagnostics?.rule_hits)
      : issues.filter((issue) =>
          ["sensitive_word_hit", "regex_rule_hit", "confirmed_reference_missing"].includes(String(issue?.type ?? "")),
        );
  const hotResources =
    toArray<Record<string, any>>(diagnostics?.hot_resources).length > 0
      ? toArray<Record<string, any>>(diagnostics?.hot_resources)
      : buildHotResources(resourceReferences as Record<string, unknown[]>);
  const selectedVersionMeta = useMemo(
    () => versions.find((item) => item.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );
  const latestIntent = (workspace?.latest_intent ?? diagnostics?.latest_intent ?? null) as ChapterIntentData | null;
  const publishReadiness = (workspace?.publish_readiness ?? diagnostics?.publish_readiness ?? null) as PublishReadinessData | null;
  const handoffBrief = (workspace?.handoff_brief ?? diagnostics?.handoff_brief ?? null) as HandoffBriefData | null;
  const contextBrief = (workspace?.context_brief ?? diagnostics?.context_snapshot ?? null) as any;
  const legacyTraceSnapshot = workspace?.generation_context_snapshot ?? null;

  return {
    projectId,
    chapterNo,
    chapterId,
    workspace,
    versions,
    selectedVersionId,
    compareVersionId,
    tab,
    editorText,
    diffData,
    loadingMessage,
    actionError,
    actionMessage,
    actionLoading,
    intentMission,
    intentAdvanceGoal,
    intentConflictTarget,
    intentHookTarget,
    intentPacingDirection,
    showAllIssues,
    showTraceMeta,
    fixGoal,
    keepElementsText,
    forbiddenChangesText,
    targetIntensity,
    manualFixMode,
    manualSceneIndex,
    selectionSpan,
    previewPayload,
    fixPreview,
    previewError,
    previewLoading,
    advisorMessages,
    advisorInput,
    advisorLoading,
    advisorError,
    advisorQuickPrompts,
    monacoRef,
    issues,
    visibleIssues,
    collapsedRepeatedCount,
    fixStrategies,
    quality,
    director,
    qualityTrend,
    recentFixTasks,
    resourceReferences,
    resourceSummary,
    resourceSections,
    resourceRuleHits,
    hotResources,
    promptTrace,
    selectedVersionMeta,
    latestIntent,
    publishReadiness,
    handoffBrief,
    contextBrief,
    legacyTraceSnapshot,
    isReady: Boolean(projectId && chapterId),
    setTab,
    setSelectedVersionId,
    setCompareVersionId,
    setShowAllIssues,
    setShowTraceMeta,
    setIntentMission,
    setIntentAdvanceGoal,
    setIntentConflictTarget,
    setIntentHookTarget,
    setIntentPacingDirection,
    setFixGoal,
    setKeepElementsText,
    setForbiddenChangesText,
    setTargetIntensity,
    setManualFixMode,
    setManualSceneIndex,
    setEditorText,
    setAdvisorInput,
    handleEditorMount: (editor: any, monaco: any) => {
      monacoRef.current = { editor, monaco };
    },
    saveChapterIntent,
    readSelection,
    runPipeline,
    runGenerate,
    runDiff,
    runEvaluate,
    runDirectorReview,
    runRollback,
    runManualFixPreview,
    runManualFix,
    executePreviewFix,
    runSelectionFix,
    runNumericConsistencyFix,
    runDeduplicateCleanup,
    runReduceWordRepetition,
    createSecondChapterTemplate,
    askAuthorAdvisor,
    updateItemStatus,
    updateReferenceState,
    rebuildResourceReferences,
    jumpToEvidence,
    runFix,
    runIssuePreview,
    pickRecommendedStrategyIndex,
    resourceGroupLabels: RESOURCE_GROUP_LABELS,
  };
}

export type ChapterWorkspaceController = ReturnType<typeof useChapterWorkspace>;
