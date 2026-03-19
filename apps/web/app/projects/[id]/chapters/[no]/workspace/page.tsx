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

type FixMode = "replace_span" | "rewrite_section" | "rewrite_chapter";
type FixIntensity = "low" | "medium" | "high";
type ExtractionStatus = "extracted" | "confirmed" | "rejected" | "superseded";

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
const REVIEW_BLOCK_SOURCE_LABELS: Record<string, string> = {
  continuity_fail: "一致性检测触发挂起",
  quality_fail: "质量评估触发挂起",
  fix_exhaustion: "自动修复轮次耗尽",
  manual: "人工挂起",
};
const EXTRACTION_STATUS_LABELS: Record<ExtractionStatus, string> = {
  extracted: "待确认",
  confirmed: "已采纳",
  rejected: "已驳回",
  superseded: "已替代",
};

const QUICK_FIX_PRESETS = [
  { key: "emotion", label: "增强情绪", instruction: "在不改变剧情事实、时间线、人物关系的前提下，增强当前内容的情绪张力和临场感。", mode: "replace_span" as FixMode },
  { key: "reduce-exposition", label: "减少解释", instruction: "保留信息点，但减少解释性叙述和抽象总结，尽量改成动作、细节或对白。", mode: "replace_span" as FixMode },
  { key: "conflict", label: "强化冲突", instruction: "保留剧情走向，增强人物对抗、阻力和压迫感，让冲突更具体。", mode: "replace_span" as FixMode },
  { key: "ending-hook", label: "加强章尾钩子", instruction: "不改变本章结局事实，只增强章尾悬念、追读欲和下一章拉力。", mode: "rewrite_section" as FixMode },
  { key: "agency", label: "提升主角主动性", instruction: "保持剧情结果不变，强化主角的判断、选择和推进感，避免过度被动。", mode: "rewrite_section" as FixMode },
];

const ISSUE_TYPE_LABELS: Record<string, string> = {
  knowledge_unknown: "知情人未标注",
  knowledge_mismatch: "知情范围不匹配",
  knowledge_time_travel: "信息穿越",
  glossary_consistency: "术语不统一",
  character_age_consistency: "年龄不一致",
  ability_constraint: "能力约束冲突",
  inventory_regression: "物品状态回退",
  condition_regression: "状态回退",
  ability_regression: "能力状态回退",
  identity_regression: "身份状态回退",
  allegiance_regression: "阵营状态回退",
};

type IssueGuide = {
  typeLabel: string;
  title: string;
  note?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExtractionStatus(item: any): ExtractionStatus {
  return (item?.extraction_status ?? item?.status ?? "extracted") as ExtractionStatus;
}

function extractionStatusClass(status: ExtractionStatus) {
  if (status === "confirmed") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  if (status === "superseded") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-700";
}

function extractionStatusLabel(status: ExtractionStatus) {
  return EXTRACTION_STATUS_LABELS[status] ?? status;
}

function extractionStatusOptionLabel(status: ExtractionStatus) {
  if (status === "extracted") return "待确认（新抽取）";
  if (status === "confirmed") return "采纳（纳入约束）";
  if (status === "rejected") return "驳回（误抽取）";
  if (status === "superseded") return "替代（旧条目失效）";
  return status;
}

function toSeverityLabel(severity: string) {
  const normalized = String(severity ?? "low").toLowerCase();
  if (normalized === "high") return "高风险";
  if (normalized === "med") return "中风险";
  return "低风险";
}

function formatIssueSnippet(issue: any) {
  const snippet = typeof issue?.evidence?.snippet === "string" ? issue.evidence.snippet.trim() : "";
  if (!snippet) return "未提供证据片段";
  return snippet.replace(/\s+/g, " ");
}

function resolveIssueSuggestedFix(issue: any) {
  if (typeof issue?.suggested_fix === "string" && issue.suggested_fix.trim()) {
    return issue.suggested_fix.trim();
  }
  if (String(issue?.type ?? "") === "knowledge_unknown") {
    return "优先去下方 Facts 补“谁知道”；如果这条是误抽取，再改成“驳回”或“替代”。";
  }
  return "先跳转定位问题片段，再决定是改正文、改设定，还是调整下方记忆状态。";
}

function toIssueGuide(issue: any): IssueGuide {
  const issueType = String(issue?.type ?? "unknown");
  const typeLabel = ISSUE_TYPE_LABELS[issueType] ?? issueType;

  if (issueType === "knowledge_unknown") {
    return {
      typeLabel,
      title: "这条事实还没标记“谁知道”",
      note: "这类通常先处理 Facts，不一定需要改正文。",
    };
  }

  if (issueType === "knowledge_mismatch") {
    return {
      typeLabel,
      title: "当前出场角色和已知信息范围对不上",
      note: "先核对 Facts，再决定是补正文还是调整知情范围。",
    };
  }

  if (issueType === "knowledge_time_travel") {
    return {
      typeLabel,
      title: "信息出现时间早于设定时间线",
    };
  }

  if (issueType === "glossary_consistency") {
    return {
      typeLabel,
      title: "术语写法不统一",
    };
  }

  if (issueType.includes("regression")) {
    return {
      typeLabel,
      title: "当前描写和前文状态记录冲突",
    };
  }

  if (issueType === "character_age_consistency") {
    return {
      typeLabel,
      title: "角色年龄和设定不一致",
    };
  }

  if (issueType === "ability_constraint") {
    return {
      typeLabel,
      title: "能力表现碰到了设定约束",
    };
  }

  return {
    typeLabel,
    title: "检测到一致性风险",
  };
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
  const [intentMission, setIntentMission] = useState("");
  const [intentAdvanceGoal, setIntentAdvanceGoal] = useState("");
  const [intentConflictTarget, setIntentConflictTarget] = useState("");
  const [intentHookTarget, setIntentHookTarget] = useState("");
  const [intentPacingDirection, setIntentPacingDirection] = useState("");
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

  function buildFixConstraintPayload() {
    const keepElements = splitListInput(keepElementsText);
    const forbiddenChanges = splitListInput(forbiddenChangesText);
    return {
      fix_goal: fixGoal.trim() || undefined,
      keep_elements: keepElements.length > 0 ? keepElements : undefined,
      forbidden_changes: forbiddenChanges.length > 0 ? forbiddenChanges : undefined,
      target_intensity: targetIntensity,
    };
  }

  function buildCustomInstruction(extraHint?: string) {
    return [extraHint ? `问题描述：${extraHint}` : ""].filter(Boolean).join("；");
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

  useEffect(() => {
    const intent = workspace?.latest_intent;
    setIntentMission(intent?.chapter_mission ?? workspace?.chapter?.goal ?? "");
    setIntentAdvanceGoal(intent?.advance_goal ?? "");
    setIntentConflictTarget(intent?.conflict_target ?? workspace?.chapter?.conflict ?? "");
    setIntentHookTarget(intent?.hook_target ?? workspace?.chapter?.cliffhanger ?? "");
    setIntentPacingDirection(intent?.pacing_direction ?? "");
  }, [workspace]);

  async function runGenerate(stage: "beats" | "draft" | "polish") {
    if (!chapterId) return;
    if (workspace?.review_block?.status === "blocked_review" || workspace?.chapter?.status === "blocked_review") {
      setActionError("当前章节处于 blocked_review。请先人工确认并解除阻断，再继续自动生成。");
      return;
    }
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
    if (autoFix && (workspace?.review_block?.status === "blocked_review" || workspace?.chapter?.status === "blocked_review")) {
      setActionError("当前章节处于 blocked_review。请先人工确认并解除阻断，再继续总编闭环。");
      return;
    }
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
    if (workspace?.review_block?.status === "blocked_review" || workspace?.chapter?.status === "blocked_review") {
      setActionError("当前章节处于 blocked_review。请先人工确认并解除阻断，再继续修复。");
      return;
    }
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
      instruction: buildCustomInstruction(issue?.message) || undefined,
      ...buildFixConstraintPayload(),
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
      instruction: buildCustomInstruction("自定义修复请求") || undefined,
      ...buildFixConstraintPayload(),
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
        instruction: buildCustomInstruction("对当前选区做局部修复") || undefined,
        ...buildFixConstraintPayload(),
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
        ...buildFixConstraintPayload(),
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
        ...buildFixConstraintPayload(),
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
        ...buildFixConstraintPayload(),
      },
      "降重复词完成并已复评",
    );
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

  async function updateReviewBlock(blocked: boolean) {
    if (!chapterId) return;
    setActionError("");
    setActionMessage(blocked ? "正在更新阻断状态..." : "正在解除阻断...");
    setActionLoading(true);
    try {
      await requestJson(`${API_BASE}/chapters/${chapterId}/review-block`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ blocked }),
      });
      await reload(chapterId);
      setActionMessage(blocked ? "阻断状态已更新" : "已解除阻断，可继续人工操作或重新触发流程");
    } catch (error) {
      setActionError(formatErrorMessage(error, "更新阻断状态失败"));
      setActionMessage("");
    } finally {
      setActionLoading(false);
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
  const qualityReportPayload = quality?.report ?? null;
  const evaluatedQuality = qualityReportPayload?.quality ?? null;
  const qualityDiagnostics = Array.isArray(qualityReportPayload?.diagnostics) ? qualityReportPayload.diagnostics : [];
  const directorFixPlan = director?.fix_plan ?? null;
  const reviewBlock = workspace?.review_block ?? null;
  const chapterBlocked = reviewBlock?.status === "blocked_review" || workspace?.chapter?.status === "blocked_review";
  const reviewBlockMeta =
    (reviewBlock?.meta as { source?: string; details?: string[]; blocked_at?: string } | null) ??
    (workspace?.chapter?.review_block_meta as { source?: string; details?: string[]; blocked_at?: string } | null) ??
    null;
  const reviewBlockDetails = Array.isArray(reviewBlockMeta?.details) ? reviewBlockMeta.details : [];
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
      {chapterBlocked && (
        <div className="mt-4 rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-semibold">流程已挂起：需要人工确认后再继续</p>
          <p className="mt-1 text-xs text-rose-800/80">系统状态：blocked_review</p>
          <p className="mt-1">{reviewBlock?.reason ?? workspace?.chapter?.review_block_reason ?? "需要人工处理后再继续。"}</p>
          <p className="mt-1 text-rose-800/80">
            来源：{REVIEW_BLOCK_SOURCE_LABELS[reviewBlockMeta?.source ?? "manual"] ?? reviewBlockMeta?.source ?? "manual"}
            {reviewBlockMeta?.blocked_at ? ` / ${reviewBlockMeta.blocked_at}` : ""}
          </p>
          <p className="mt-2 text-xs text-rose-900/85">详细处理建议看下方“一致性报告”，不用只根据这里判断是否要重写正文。</p>
          {reviewBlockDetails.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-900/85">
              {reviewBlockDetails.map((item, idx) => (
                <li key={`${item}-${idx}`}>{item}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={actionLoading} onClick={() => void updateReviewBlock(false)}>
              人工确认后解除阻断
            </Button>
            <Button variant="ghost" disabled={actionLoading} onClick={runEvaluate}>
              重新执行质量评估
            </Button>
          </div>
        </div>
      )}
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
            <Button variant="secondary" disabled={actionLoading || chapterBlocked} onClick={() => runGenerate(tab)}>
              {actionLoading ? "处理中..." : `生成${STAGE_LABELS[tab]}`}
            </Button>
            <Button variant="ghost" disabled={actionLoading} onClick={runEvaluate}>
              质量评估
            </Button>
            <Button variant="ghost" disabled={actionLoading} onClick={() => void runDirectorReview(false)}>
              总编评审
            </Button>
            <Button variant="secondary" disabled={actionLoading || chapterBlocked} onClick={() => void runDirectorReview(true)}>
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
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId || chapterBlocked} onClick={runSelectionFix}>
              选区局部修复
            </Button>
            {tab === "polish" && (
              <Button variant="ghost" disabled={actionLoading || !selectedVersionId || chapterBlocked} onClick={runNumericConsistencyFix}>
                数字一致性修复
              </Button>
            )}
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId || chapterBlocked} onClick={runDeduplicateCleanup}>
              清理重复段
            </Button>
            <Button variant="ghost" disabled={actionLoading || !selectedVersionId || chapterBlocked} onClick={runReduceWordRepetition}>
              降重复词
            </Button>
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
                <Button variant="ghost" disabled={actionLoading || chapterBlocked} onClick={runManualFix}>
                  执行自定义修复
                </Button>
                <Button
                  variant="ghost"
                  disabled={actionLoading || !previewPayload || chapterBlocked}
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
                  {fixPreview.fix_constraints?.fix_goal ? <p>修复目标：{fixPreview.fix_constraints.fix_goal}</p> : null}
                  {Array.isArray(fixPreview.fix_constraints?.keep_elements) && fixPreview.fix_constraints.keep_elements.length > 0 ? (
                    <p>保留元素：{fixPreview.fix_constraints.keep_elements.join("、")}</p>
                  ) : null}
                  {Array.isArray(fixPreview.fix_constraints?.forbidden_changes) && fixPreview.fix_constraints.forbidden_changes.length > 0 ? (
                    <p>禁止改动：{fixPreview.fix_constraints.forbidden_changes.join("、")}</p>
                  ) : null}
                  {fixPreview.fix_constraints?.target_intensity ? <p>目标强度：{fixPreview.fix_constraints.target_intensity}</p> : null}
                  {fixPreview.fix_instruction ? <p>附加说明：{fixPreview.fix_instruction}</p> : null}
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
            <p>对白自然度：{evaluatedQuality?.dialogue_naturalness?.score ?? quality?.dialogue_quality ?? "-"}</p>
            <p>场景表现：{evaluatedQuality?.scene_vividness?.score ?? quality?.scene_vividness ?? "-"}</p>
            <p>说明控制：{evaluatedQuality?.exposition_control?.score ?? quality?.exposition_control ?? "-"}</p>
            <p>AI 味风险控制：{evaluatedQuality?.ai_tone_risk?.score ?? "-"}</p>
            <p>结尾钩子分：{quality?.ending_hook ?? "-"}</p>
            <p>总分：{quality?.overall_score ?? "-"}</p>
            {quality?.summary && <p className="mt-1 text-black/70">评语：{quality.summary}</p>}
          </div>

          <div className="mt-2 rounded border border-black/10 p-2 text-xs">
            <p className="font-medium">定向诊断</p>
            {qualityDiagnostics.length === 0 && <p className="text-black/60">暂无诊断项</p>}
            {qualityDiagnostics.slice(0, 4).map((item: any, idx: number) => (
              <div key={`${item.issue_type}-${idx}`} className="mt-2 rounded border border-black/10 bg-black/[0.02] p-2">
                <p>
                  {item.issue_type} / {item.severity} / {item.score}
                </p>
                <p className="mt-1 text-black/70">{item.reason}</p>
                {Array.isArray(item?.evidence) && item.evidence.length > 0 && (
                  <p className="mt-1 text-black/70">证据：{item.evidence.join("；")}</p>
                )}
                {Array.isArray(item?.suggested_actions) && item.suggested_actions.length > 0 && (
                  <p className="mt-1 text-black/70">建议：{item.suggested_actions.join("；")}</p>
                )}
              </div>
            ))}
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
                {director.summary && <p className="mt-1 text-black/70">摘要：{director.summary}</p>}
                {directorFixPlan && (
                  <>
                    <p className="mt-1">修复类型：{directorFixPlan.issue_type ?? "-"}</p>
                    {Array.isArray(directorFixPlan?.rewrite_tactics) && directorFixPlan.rewrite_tactics.length > 0 && (
                      <p className="text-black/70">手术策略：{directorFixPlan.rewrite_tactics.join("；")}</p>
                    )}
                  </>
                )}
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
              <p className="font-medium text-black/80">怎么看这份报告</p>
              <p>先看“问题标题”，确认系统到底在提醒什么。</p>
              <p>再看“系统判断”和“证据片段”，确认它指的是正文哪一段。</p>
              <p>最后看“系统建议”，决定是改正文，还是去下方 Facts / Seeds / Timeline 调整记忆状态。</p>
              <p className="mt-1">高风险优先处理；低风险里“知情人未标注”通常先去 Facts 处理，不一定要改正文。</p>
              <p className="mt-1">策略1=局部替换，策略2=场景重写，策略3=整章重写。</p>
            </div>

            {!showAllIssues && collapsedRepeatedCount > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                已折叠 {collapsedRepeatedCount} 条重复的低优先级“知情人未标注”提示。
                这类通常先去下方 Facts 标记“谁知道”或调整状态，不一定要改正文。
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
              const issueGuide = toIssueGuide(issue);
              const suggestedFix = resolveIssueSuggestedFix(issue);
              return (
              <div key={issue.issue_id} className="rounded border border-black/10 p-2">
                <p className="text-[11px] text-black/55">{toSeverityLabel(issue.severity)} / {issueGuide.typeLabel}</p>
                <p className="mt-1 text-sm font-medium">{issueGuide.title}</p>
                <p className="mt-1 text-xs text-black/70">系统判断：{String(issue?.message ?? "未提供说明")}</p>
                <p className="mt-1 text-xs text-black/70">证据片段：{formatIssueSnippet(issue)}</p>
                <p className="mt-1 text-xs text-black/70">系统建议：{suggestedFix}</p>
                {issueGuide.note ? <p className="mt-1 text-xs text-black/70">补充说明：{issueGuide.note}</p> : null}
                <Button className="mt-2" variant="ghost" onClick={() => jumpToEvidence(issue)}>
                  跳转段落
                </Button>
                <details className="mt-2 rounded border border-black/10 px-2 py-1 text-[11px] text-black/65">
                  <summary className="cursor-pointer">查看原始检测信息</summary>
                  <p className="mt-1 break-all">类型：{String(issue?.type ?? "unknown")}</p>
                  <p className="mt-1 whitespace-pre-wrap break-all">原始文案：{String(issue?.message ?? "（空）")}</p>
                </details>
                <p className="mt-1 text-[11px] text-black/60">
                  推荐策略风险：{recommendedRisk}
                </p>
                <div className="mt-2 grid gap-1">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={actionLoading || chapterBlocked}
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
                            disabled={actionLoading || chapterBlocked}
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
          {workspace?.chapter_memory ? (
            <div className="mt-2 rounded border border-black/10 bg-black/[0.02] p-2 text-[11px] text-black/70">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 ${workspace.chapter_memory.needs_manual_review ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                >
                  {workspace.chapter_memory.needs_manual_review ? "待人工审查" : "已完成状态校验"}
                </span>
              </div>
              {workspace.chapter_memory.review_notes ? (
                <p className="mt-2 whitespace-pre-wrap">{workspace.chapter_memory.review_notes}</p>
              ) : null}
              {workspace.chapter_memory.character_state_snapshot ? (
                <details className="mt-2 rounded border border-black/10 bg-white/70 p-2">
                  <summary className="cursor-pointer text-black/80">角色/剧情状态快照</summary>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[11px]">
                    {JSON.stringify(workspace.chapter_memory.character_state_snapshot, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
          <div className="mt-2 space-y-2 text-xs">
            <p className="text-[11px] text-black/60">
              状态判定：待确认=新抽取待你判断；采纳=纳入后续一致性约束；驳回=误抽取作废；替代=旧条目被新条目覆盖。
            </p>
            {["facts", "seeds", "timeline"].map((kind) => (
              <div key={kind}>
                <p className="font-medium">{kind}</p>
                {(workspace?.extracted_items?.[kind] ?? []).map((item: any) => (
                  <div key={item.id} className="mb-2 rounded border border-black/10 p-2">
                    <p>{item.content ?? item.event}</p>
                    {kind === "timeline" && item.time_mark ? (
                      <p className="mt-1 text-[11px] text-black/55">time_mark: {item.time_mark}</p>
                    ) : null}
                    {kind === "seeds" ? (
                      <p className="mt-1 text-[11px] text-black/55">plot_status: {item.status ?? "planted"}</p>
                    ) : null}
                    <div className="mt-1">
                      <span className={`rounded-full px-2 py-1 text-[11px] ${extractionStatusClass(getExtractionStatus(item))}`}>
                        记忆状态：{extractionStatusLabel(getExtractionStatus(item))}
                      </span>
                    </div>
                    <select
                      className="mt-1 rounded border border-black/20 px-2 py-1"
                      value={getExtractionStatus(item)}
                      onChange={(e) => updateItemStatus(kind as any, item.id, e.target.value)}
                    >
                      <option value="extracted">{extractionStatusOptionLabel("extracted")}</option>
                      <option value="confirmed">{extractionStatusOptionLabel("confirmed")}</option>
                      <option value="rejected">{extractionStatusOptionLabel("rejected")}</option>
                      <option value="superseded">{extractionStatusOptionLabel("superseded")}</option>
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
