"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

type StorySpine = {
  logline: string | null;
  main_conflict: string | null;
  protagonist_long_goal: string | null;
  external_pressure: string | null;
  internal_conflict: string | null;
  central_question: string | null;
  ending_direction: string | null;
  ending_cost: string | null;
  story_promise: string | null;
  theme_statement: string | null;
  non_drift_constraints: string[];
};

type OutlineState = {
  protagonist_state: string | null;
  relationship_state: string | null;
  world_state: string | null;
};

type OutlineProgress = {
  plot: number | null;
  relationship: number | null;
  information: number | null;
};

type CharacterRoleAssignment = {
  character_id: string | null;
  character_name: string | null;
  role: string | null;
};

type SeedLink = {
  seed_id: string | null;
  seed_name: string | null;
  introduce_in_stage: number | null;
  introduce_in_chapter: number | null;
  payoff_in_stage: number | null;
  payoff_in_chapter: number | null;
  current_status: string | null;
  link_type: string | null;
};

type StageItem = {
  phase_no: number;
  title: string;
  summary: string;
  goal: string | null;
  conflict: string | null;
  milestone_chapter_no: number | null;
  stage_function: string | null;
  start_state: OutlineState;
  stage_goal: string | null;
  main_opponent: string | null;
  key_events: string[];
  midpoint_change: string | null;
  climax: string | null;
  ending_state: OutlineState;
  stage_cost: string | null;
  progress: OutlineProgress;
  completion_criteria: string | null;
  no_drift_constraints: string[];
  involved_character_ids: string[];
  involved_character_names?: string[];
  character_role_assignments: CharacterRoleAssignment[];
  seed_links: SeedLink[];
  chapter_range_start: number | null;
  chapter_range_end: number | null;
  chapter_count?: number;
  assigned_chapter_nos?: number[];
};

type ChapterItem = {
  chapter_id: string;
  chapter_no: number;
  title: string;
  display_title: string;
  stage_no: number | null;
  stage_title: string | null;
  stage_position: string | null;
  goal: string | null;
  chapter_function: string | null;
  core_conflict: string | null;
  key_events: string[];
  scene_progression: string[];
  key_takeaways: string[];
  relationship_changes: string[];
  character_change: string | null;
  information_reveal: string | null;
  strategy_judgment: string | null;
  ending_hook: string | null;
  word_target: number | null;
  stage_goal: string | null;
  stage_conflict: string | null;
};

type Diagnostic = {
  scope: "story_spine" | "stage" | "chapter" | "structure" | "linking";
  level: "warn" | "info";
  code: string;
  title: string;
  message: string;
  phase_no?: number | null;
  chapter_no?: number | null;
};

type CharacterOption = {
  id: string;
  name: string;
  current_status: string | null;
};

type SeedOption = {
  id: string;
  name: string;
  status: string;
  planted_chapter_no: number;
  planned_payoff_chapter_no: number | null;
};

type OutlineWorkspace = {
  story_spine: StorySpine;
  stages: StageItem[];
  chapters: ChapterItem[];
  diagnostics: Diagnostic[];
  linking: {
    setting_impacts: Array<{
      key: string;
      label: string;
      previous: string | null;
      current: string | null;
      affected_stage_nos: number[];
      affected_chapter_nos: number[];
    }>;
  };
  meta: {
    character_options: CharacterOption[];
    seed_options: SeedOption[];
    role_options: string[];
    chapter_position_options: string[];
  };
};

type ViewMode = "macro" | "fine";

const viewModes = [
  {
    id: "macro",
    label: "总纲视图",
    helper: "Story Spine / 阶段推进 / 章节骨架",
  },
  {
    id: "fine",
    label: "细纲视图",
    helper: "章节作战信息 / 场景推进 / 关键收获",
  },
] satisfies Array<{ id: ViewMode; label: string; helper: string }>;

const diagnosticScopeLabels: Record<Diagnostic["scope"], string> = {
  story_spine: "故事总纲",
  stage: "阶段层",
  chapter: "章节层",
  structure: "结构层",
  linking: "联动层",
};

const diagnosticScopesByView: Record<ViewMode, Diagnostic["scope"][]> = {
  macro: ["story_spine", "stage", "structure", "chapter", "linking"],
  fine: ["chapter", "structure", "linking", "story_spine", "stage"],
};

const REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_CHAPTER_WORD_TARGET = 3000;
const inputClass =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-black/40";
const textareaClass =
  "w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none transition focus:border-black/40";
const chipClass = "rounded-full border px-2.5 py-1 text-xs transition";

function splitLines(input: string) {
  return input
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: Array<string | null | undefined>) {
  return items
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function stripChapterPrefix(value: string, chapterNo: number) {
  return value
    .replace(new RegExp(`^第\\s*${chapterNo}\\s*章(?:\\s*[·.、\\-]\\s*|\\s+)?`, "i"), "")
    .replace(/^第\s*\d+\s*章(?:\s*[·.、\-]\s*|\s+)?/i, "")
    .trim();
}

function formatDisplayTitle(chapterNo: number, title?: string | null) {
  const clean = stripChapterPrefix(title ?? "", chapterNo);
  return clean ? `第${chapterNo}章 · ${clean}` : `第${chapterNo}章`;
}

function toggleArrayValue(items: string[], value: string) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function roleAssignmentsToText(assignments: CharacterRoleAssignment[], characters: CharacterOption[]) {
  const nameById = new Map(characters.map((item) => [item.id, item.name]));
  return assignments
    .map((item) => `${item.character_name ?? (item.character_id ? nameById.get(item.character_id) : "") ?? ""}:${item.role ?? ""}`.trim())
    .filter(Boolean)
    .join("\n");
}

function parseRoleAssignments(input: string, characters: CharacterOption[]) {
  const byName = new Map(characters.map((item) => [item.name, item]));
  return splitLines(input)
    .map((line) => {
      const [rawName, rawRole] = line.split(":").map((item) => item.trim());
      if (!rawName && !rawRole) return null;
      const matched = byName.get(rawName);
      return {
        character_id: matched?.id ?? null,
        character_name: rawName || matched?.name || null,
        role: rawRole || null,
      } satisfies CharacterRoleAssignment;
    })
    .filter((item): item is CharacterRoleAssignment => item !== null);
}

function seedLinksToText(links: SeedLink[], seeds: SeedOption[]) {
  const nameById = new Map(seeds.map((item) => [item.id, item.name]));
  return links
    .map((item) => {
      const seedName = item.seed_name ?? (item.seed_id ? nameById.get(item.seed_id) : "") ?? "";
      const type = item.link_type ?? "";
      const status = item.current_status ?? "";
      return [seedName, type, status].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .join("\n");
}

function parseSeedLinks(input: string, seeds: SeedOption[], context: { phaseNo?: number | null; chapterNo?: number | null }) {
  const byName = new Map(seeds.map((item) => [item.name, item]));
  const parsed = splitLines(input).map<SeedLink | null>((line) => {
      const [rawName, rawType, rawStatus] = line.split("|").map((item) => item.trim());
      if (!rawName) return null;
      const matched = byName.get(rawName);
      const linkType = rawType || "introduce";
      return {
        seed_id: matched?.id ?? null,
        seed_name: rawName,
        introduce_in_stage: linkType.includes("introduce") ? context.phaseNo ?? null : null,
        introduce_in_chapter: linkType.includes("introduce") ? context.chapterNo ?? null : null,
        payoff_in_stage: linkType.includes("payoff") ? context.phaseNo ?? null : null,
        payoff_in_chapter: linkType.includes("payoff") ? context.chapterNo ?? null : null,
        current_status: rawStatus || matched?.status || null,
        link_type: linkType,
      } satisfies SeedLink;
    });
  return parsed.filter((item): item is SeedLink => item !== null);
}

function emptyStage(phaseNo: number): StageItem {
  return {
    phase_no: phaseNo,
    title: `阶段 ${phaseNo}`,
    summary: "",
    goal: "",
    conflict: "",
    milestone_chapter_no: null,
    stage_function: "",
    start_state: {
      protagonist_state: "",
      relationship_state: "",
      world_state: "",
    },
    stage_goal: "",
    main_opponent: "",
    key_events: [],
    midpoint_change: "",
    climax: "",
    ending_state: {
      protagonist_state: "",
      relationship_state: "",
      world_state: "",
    },
    stage_cost: "",
    progress: {
      plot: null,
      relationship: null,
      information: null,
    },
    completion_criteria: "",
    no_drift_constraints: [],
    involved_character_ids: [],
    character_role_assignments: [],
    seed_links: [],
    chapter_range_start: null,
    chapter_range_end: null,
    chapter_count: 0,
    assigned_chapter_nos: [],
  };
}

function emptyChapter(chapterNo: number, stageNo?: number | null): ChapterItem {
  return {
    chapter_id: `draft-${chapterNo}`,
    chapter_no: chapterNo,
    title: "未命名",
    display_title: formatDisplayTitle(chapterNo, "未命名"),
    stage_no: stageNo ?? null,
    stage_title: null,
    stage_position: "",
    goal: "",
    chapter_function: "",
    core_conflict: "",
    key_events: [],
    scene_progression: [],
    key_takeaways: [],
    relationship_changes: [],
    character_change: "",
    information_reveal: "",
    strategy_judgment: "",
    ending_hook: "",
    word_target: DEFAULT_CHAPTER_WORD_TARGET,
    stage_goal: null,
    stage_conflict: null,
  };
}

function countStageMissing(stage: StageItem) {
  let missing = 0;
  if (!stage.stage_function) missing += 1;
  if (!stage.stage_goal && !stage.goal) missing += 1;
  if (!stage.ending_state.protagonist_state && !stage.ending_state.relationship_state && !stage.ending_state.world_state) missing += 1;
  if (!stage.stage_cost) missing += 1;
  if (stage.no_drift_constraints.length === 0) missing += 1;
  return missing;
}

function countChapterOutlineMissing(chapter: ChapterItem) {
  let missing = 0;
  if (!chapter.goal) missing += 1;
  if (!chapter.core_conflict) missing += 1;
  if (chapter.key_events.length < 3) missing += 1;
  if (!chapter.ending_hook) missing += 1;
  if (!chapter.character_change) missing += 1;
  if (!chapter.information_reveal) missing += 1;
  return missing;
}

function countChapterFineOutlineMissing(chapter: ChapterItem) {
  let missing = 0;
  if (!chapter.chapter_function) missing += 1;
  if (chapter.scene_progression.length < 3) missing += 1;
  if (chapter.key_takeaways.length === 0) missing += 1;
  if (chapter.relationship_changes.length === 0) missing += 1;
  if (!chapter.strategy_judgment) missing += 1;
  if (!chapter.ending_hook) missing += 1;
  return missing;
}

function buildFineOutlinePrefill(chapter: ChapterItem) {
  return {
    scene_progression: chapter.scene_progression.length > 0 ? chapter.scene_progression : chapter.key_events,
    relationship_changes:
      chapter.relationship_changes.length > 0
        ? chapter.relationship_changes
        : chapter.character_change
          ? [chapter.character_change]
          : [],
  } satisfies Pick<ChapterItem, "scene_progression" | "relationship_changes">;
}

function canPrefillFineOutline(chapter: ChapterItem) {
  return (
    (chapter.key_events.length > 0 && chapter.scene_progression.length === 0) ||
    (!!chapter.character_change && chapter.relationship_changes.length === 0)
  );
}

function deriveStageSuggestions(storySpine: StorySpine, startPhaseNo: number) {
  const titles = ["建立困境", "首次破局", "中盘失衡", "终局对决"];
  return titles.map((title, index) => {
    const phaseNo = startPhaseNo + index;
    const stage = emptyStage(phaseNo);
    stage.title = title;
    stage.summary =
      index === 0
        ? `围绕“${storySpine.main_conflict || storySpine.logline || "主线冲突"}”建立主角初始困境。`
        : index === titles.length - 1
          ? `把主角长期目标与终局代价推到不可回避的对决。`
          : `承接上阶段结果，继续抬高“${storySpine.external_pressure || storySpine.main_conflict || "外部压力"}”。`;
    stage.stage_function = title;
    stage.goal =
      index === 0
        ? "让主角被迫入局"
        : index === titles.length - 1
          ? "完成终局抉择"
          : "完成阶段性破局并留下更大代价";
    stage.stage_goal = stage.goal;
    stage.conflict = storySpine.main_conflict || storySpine.external_pressure || "";
    stage.main_opponent = storySpine.external_pressure || "当前阶段压力源";
    stage.key_events = [
      `${title}的引爆事件`,
      `${title}中的关键失衡`,
      `${title}的阶段收束`,
    ];
    stage.completion_criteria = `${title}必须带来明确状态变化，不能只换场景不换局势。`;
    stage.stage_cost = storySpine.ending_cost || "推进必须伴随代价";
    stage.no_drift_constraints = storySpine.non_drift_constraints.slice(0, 3);
    stage.progress = {
      plot: index + 1,
      relationship: Math.min(5, index + 2),
      information: Math.min(5, index + 2),
    };
    return stage;
  });
}

function deriveChapterSuggestions(stage: StageItem, nextChapterNo: number) {
  const positions = ["开局章", "推进章", "高潮章"];
  return positions.map((position, index) => {
    const chapter = emptyChapter(nextChapterNo + index, stage.phase_no);
    chapter.title = `${stage.title}${position}`;
    chapter.display_title = formatDisplayTitle(chapter.chapter_no, chapter.title);
    chapter.stage_title = stage.title;
    chapter.stage_position = position;
    chapter.goal =
      position === "高潮章" ? stage.completion_criteria || stage.stage_goal || stage.goal || "" : stage.stage_goal || stage.goal || "";
    chapter.core_conflict = stage.conflict || stage.main_opponent || stage.stage_goal || "";
    chapter.key_events = [
      `${position}的开场施压`,
      `${position}中的关键行动`,
      `${position}的结尾变化`,
    ];
    chapter.character_change = "主角状态发生可感知变化";
    chapter.information_reveal = stage.key_events[1] || "揭露一个改变局势的信息";
    chapter.ending_hook = `${stage.title}尚未结束，下一章压力继续升级。`;
    chapter.word_target = DEFAULT_CHAPTER_WORD_TARGET;
    return chapter;
  });
}

export default function OutlinePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [workspace, setWorkspace] = useState<OutlineWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("macro");
  const [expandedStages, setExpandedStages] = useState<number[]>([]);
  const [expandedChapters, setExpandedChapters] = useState<number[]>([]);
  const [stageFilter, setStageFilter] = useState("all");

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

  async function load(id: string) {
    const data = await requestJson(`${API_BASE}/projects/${id}/outline/workspace`);
    setWorkspace(data);
    setExpandedStages(Array.isArray(data?.stages) ? data.stages.slice(0, 1).map((item: StageItem) => item.phase_no) : []);
    setExpandedChapters(Array.isArray(data?.chapters) ? data.chapters.slice(0, 2).map((item: ChapterItem) => item.chapter_no) : []);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id } = await params;
        if (cancelled) return;
        setProjectId(id);
        await load(id);
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : "大纲加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const characterOptions = workspace?.meta.character_options ?? [];
  const seedOptions = workspace?.meta.seed_options ?? [];
  const roleOptions = workspace?.meta.role_options ?? [];
  const chapterPositionOptions = workspace?.meta.chapter_position_options ?? [];

  const filteredChapters = useMemo(() => {
    if (!workspace) return [];
    return workspace.chapters.filter((chapter) => stageFilter === "all" || String(chapter.stage_no ?? "") === stageFilter);
  }, [workspace, stageFilter]);

  const diagnosticsByScope = useMemo(() => {
    const groups: Record<string, Diagnostic[]> = {
      story_spine: [],
      stage: [],
      chapter: [],
      structure: [],
      linking: [],
    };
    for (const item of workspace?.diagnostics ?? []) {
      groups[item.scope].push(item);
    }
    return groups;
  }, [workspace]);

  function updateStorySpine<K extends keyof StorySpine>(key: K, value: StorySpine[K]) {
    setWorkspace((prev) => (prev ? { ...prev, story_spine: { ...prev.story_spine, [key]: value } } : prev));
    setSaveMessage("");
  }

  function updateStage(phaseNo: number, updater: (stage: StageItem) => StageItem) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            stages: prev.stages.map((stage) => (stage.phase_no === phaseNo ? updater(stage) : stage)),
          }
        : prev,
    );
    setSaveMessage("");
  }

  function updateChapter(chapterNo: number, updater: (chapter: ChapterItem) => ChapterItem) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            chapters: prev.chapters
              .map((chapter) => (chapter.chapter_no === chapterNo ? updater(chapter) : chapter))
              .sort((a, b) => a.chapter_no - b.chapter_no),
          }
        : prev,
    );
    setSaveMessage("");
  }

  function addStage() {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const nextPhaseNo = Math.max(0, ...prev.stages.map((item) => item.phase_no)) + 1;
      return { ...prev, stages: [...prev.stages, emptyStage(nextPhaseNo)] };
    });
    setSaveMessage("");
  }

  function addChapter(stageNo?: number | null) {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const nextChapterNo = Math.max(0, ...prev.chapters.map((item) => item.chapter_no)) + 1;
      return { ...prev, chapters: [...prev.chapters, emptyChapter(nextChapterNo, stageNo)] };
    });
    setSaveMessage("");
  }

  function removeStage(phaseNo: number) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            stages: prev.stages.filter((stage) => stage.phase_no !== phaseNo),
            chapters: prev.chapters.map((chapter) =>
              chapter.stage_no === phaseNo
                ? { ...chapter, stage_no: null, stage_title: null, stage_position: "", stage_goal: null, stage_conflict: null }
                : chapter,
            ),
          }
        : prev,
    );
    setExpandedStages((prev) => prev.filter((item) => item !== phaseNo));
    setSaveMessage("");
  }

  function removeChapter(chapterNo: number) {
    setWorkspace((prev) =>
      prev ? { ...prev, chapters: prev.chapters.filter((chapter) => chapter.chapter_no !== chapterNo) } : prev,
    );
    setExpandedChapters((prev) => prev.filter((item) => item !== chapterNo));
    setSaveMessage("");
  }

  function toggleStageExpanded(phaseNo: number) {
    setExpandedStages((prev) => (prev.includes(phaseNo) ? prev.filter((item) => item !== phaseNo) : [...prev, phaseNo]));
  }

  function toggleChapterExpanded(chapterNo: number) {
    setExpandedChapters((prev) =>
      prev.includes(chapterNo) ? prev.filter((item) => item !== chapterNo) : [...prev, chapterNo],
    );
  }

  function appendDerivedStages() {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const nextPhaseNo = Math.max(0, ...prev.stages.map((item) => item.phase_no)) + 1;
      return {
        ...prev,
        stages: [...prev.stages, ...deriveStageSuggestions(prev.story_spine, nextPhaseNo)],
      };
    });
    setSaveMessage("已追加阶段建议，当前不会覆盖既有阶段。");
  }

  function appendDerivedChapters(stage: StageItem) {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const nextChapterNo = Math.max(0, ...prev.chapters.map((item) => item.chapter_no)) + 1;
      return {
        ...prev,
        chapters: [...prev.chapters, ...deriveChapterSuggestions(stage, nextChapterNo)].sort((a, b) => a.chapter_no - b.chapter_no),
      };
    });
    setSaveMessage(`已为阶段 ${stage.phase_no} 追加章节建议。`);
  }

  async function saveWorkspace() {
    if (!workspace || !projectId) return;
    setSaving(true);
    setErrorText("");
    setSaveMessage("");
    try {
      const payload = {
        story_spine: workspace.story_spine,
        stages: workspace.stages.map((stage) => ({
          phase_no: stage.phase_no,
          title: stage.title,
          summary: stage.summary,
          goal: stage.goal,
          conflict: stage.conflict,
          milestone_chapter_no: stage.milestone_chapter_no,
          stage_function: stage.stage_function,
          start_state: stage.start_state,
          stage_goal: stage.stage_goal,
          main_opponent: stage.main_opponent,
          key_events: stage.key_events,
          midpoint_change: stage.midpoint_change,
          climax: stage.climax,
          ending_state: stage.ending_state,
          stage_cost: stage.stage_cost,
          progress: stage.progress,
          completion_criteria: stage.completion_criteria,
          no_drift_constraints: stage.no_drift_constraints,
          involved_character_ids: stage.involved_character_ids,
          character_role_assignments: stage.character_role_assignments,
          seed_links: stage.seed_links,
          chapter_range_start: stage.chapter_range_start,
          chapter_range_end: stage.chapter_range_end,
        })),
        chapters: workspace.chapters.map((chapter) => ({
          chapter_id: chapter.chapter_id.startsWith("draft-") ? undefined : chapter.chapter_id,
          chapter_no: chapter.chapter_no,
          title: chapter.title,
          stage_no: chapter.stage_no,
          stage_position: chapter.stage_position,
          goal: chapter.goal,
          chapter_function: chapter.chapter_function,
          core_conflict: chapter.core_conflict,
          key_events: chapter.key_events,
          scene_progression: chapter.scene_progression,
          key_takeaways: chapter.key_takeaways,
          relationship_changes: chapter.relationship_changes,
          character_change: chapter.character_change,
          information_reveal: chapter.information_reveal,
          strategy_judgment: chapter.strategy_judgment,
          ending_hook: chapter.ending_hook,
          word_target: chapter.word_target,
        })),
      };
      const data = await requestJson(`${API_BASE}/projects/${projectId}/outline/workspace`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setWorkspace(data);
      setSaveMessage("大纲系统已保存，并重新生成诊断结果。");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !projectId) {
    return <main className="p-8">加载中...</main>;
  }

  if (!workspace) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <ProjectNav id={projectId} />
        <Card>{errorText || "大纲数据暂不可用。"}</Card>
      </main>
    );
  }

  const warningCount = workspace.diagnostics.filter((item) => item.level === "warn").length;
  const chapterOutlineGapCount = workspace.chapters.filter((chapter) => countChapterOutlineMissing(chapter) > 0).length;
  const chapterFineGapCount = workspace.chapters.filter((chapter) => countChapterFineOutlineMissing(chapter) > 0).length;
  const currentViewTitle = viewMode === "macro" ? "先锁结构，再落章节" : "只看章节作战层，避免重复改总纲";
  const currentViewDescription =
    viewMode === "macro"
      ? "维护 Story Spine、阶段推进与章节骨架，优先处理全局结构与上位约束。"
      : "细纲视图只处理章节功能、场景推进、关键收获与策略判断；总纲改动回到总纲视图。";
  const diagnosticsDescription =
    viewMode === "macro"
      ? "总纲视图优先看故事总纲、阶段层与结构层，避免章节只做局部合理。"
      : "细纲视图优先看章节层与结构层，先补功能、推进、收获与章尾钩子。";

  return (
    <main className="mx-auto max-w-[1560px] p-8">
      <ProjectNav id={projectId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl">大纲中枢</h1>
          <p className="mt-1 text-sm text-black/60">
            {viewMode === "macro"
              ? "总纲与细纲在同一工作台维护。章节生成会优先读取章节细纲，再回退到章节骨架。"
              : "当前为章节细纲模式。这里只处理章节作战信息，需要修改上位结构时再切回总纲视图。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void load(projectId)}>
            刷新
          </Button>
          {viewMode === "macro" ? (
            <Button variant="secondary" onClick={appendDerivedStages}>
              追加阶段建议
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setViewMode("macro")}>
              回总纲视图
            </Button>
          )}
          <Button disabled={saving} onClick={saveWorkspace}>
            {saving ? "保存中..." : "保存工作台"}
          </Button>
        </div>
      </div>

      {workspace.linking.setting_impacts.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">故事设定发生变化，建议重审大纲</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {workspace.linking.setting_impacts.map((impact) => (
              <div key={impact.key} className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2">
                <p className="font-medium">{impact.label}</p>
                <p className="text-xs text-black/60">旧值：{impact.previous || "未记录"}</p>
                <p className="text-xs text-black/60">现值：{impact.current || "未设置"}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(errorText || saveMessage) && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            errorText ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {errorText || saveMessage}
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-black/60">Story Spine</p>
          <p className="mt-1 text-2xl font-semibold">{workspace.story_spine.main_conflict ? "已建立" : "待补全"}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">阶段数</p>
          <p className="mt-1 text-2xl font-semibold">{workspace.stages.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">章节数</p>
          <p className="mt-1 text-2xl font-semibold">{workspace.chapters.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">诊断告警</p>
          <p className="mt-1 text-2xl font-semibold">{warningCount}</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {viewModes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              viewMode === item.id
                ? "border-black bg-ink text-paper shadow-sm"
                : "border-black/10 bg-white text-black hover:border-black/25"
            }`}
            onClick={() => setViewMode(item.id as ViewMode)}
          >
            <p className="text-sm font-semibold">{item.label}</p>
            <p className={`mt-1 text-xs ${viewMode === item.id ? "text-paper/70" : "text-black/50"}`}>{item.helper}</p>
          </button>
        ))}
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/35">
              {viewMode === "macro" ? "Structure Pass" : "Scene Pass"}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{currentViewTitle}</h2>
            <p className="mt-1 text-sm text-black/60">{currentViewDescription}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-sm">
              <p className="text-xs text-black/50">{viewMode === "macro" ? "阶段数" : "当前章节"}</p>
              <p className="mt-1 font-semibold">{viewMode === "macro" ? workspace.stages.length : filteredChapters.length}</p>
            </div>
            <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-sm">
              <p className="text-xs text-black/50">{viewMode === "macro" ? "待补骨架章节" : "待补细纲章节"}</p>
              <p className="mt-1 font-semibold">{viewMode === "macro" ? chapterOutlineGapCount : chapterFineGapCount}</p>
            </div>
            <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-sm">
              <p className="text-xs text-black/50">诊断告警</p>
              <p className="mt-1 font-semibold">{warningCount}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {viewMode === "macro" ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Story Spine（故事总纲）</h2>
                  <p className="mt-1 text-sm text-black/60">上位约束层。阶段与章节应持续回到这里校验，不允许只做局部合理。</p>
                </div>
                <Button variant="ghost" onClick={appendDerivedStages}>
                  从总纲追加阶段建议
                </Button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-medium">核心 Logline</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.logline ?? ""}
                    onChange={(e) => updateStorySpine("logline", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">主线冲突</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.main_conflict ?? ""}
                    onChange={(e) => updateStorySpine("main_conflict", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">主角长期目标</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.protagonist_long_goal ?? ""}
                    onChange={(e) => updateStorySpine("protagonist_long_goal", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">外部主线压力</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.external_pressure ?? ""}
                    onChange={(e) => updateStorySpine("external_pressure", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">内部主线缺口 / 内在冲突</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.internal_conflict ?? ""}
                    onChange={(e) => updateStorySpine("internal_conflict", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">故事核心问题</span>
                  <textarea
                    className={`${textareaClass} min-h-24`}
                    value={workspace.story_spine.central_question ?? ""}
                    onChange={(e) => updateStorySpine("central_question", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">终局方向</span>
                  <textarea
                    className={`${textareaClass} min-h-20`}
                    value={workspace.story_spine.ending_direction ?? ""}
                    onChange={(e) => updateStorySpine("ending_direction", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">终局代价</span>
                  <textarea
                    className={`${textareaClass} min-h-20`}
                    value={workspace.story_spine.ending_cost ?? ""}
                    onChange={(e) => updateStorySpine("ending_cost", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">故事承诺</span>
                  <textarea
                    className={`${textareaClass} min-h-20`}
                    value={workspace.story_spine.story_promise ?? ""}
                    onChange={(e) => updateStorySpine("story_promise", e.target.value)}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-medium">主题陈述（可选）</span>
                  <textarea
                    className={`${textareaClass} min-h-20`}
                    value={workspace.story_spine.theme_statement ?? ""}
                    onChange={(e) => updateStorySpine("theme_statement", e.target.value)}
                  />
                </label>
              </div>

              <label className="mt-4 grid gap-1">
                <span className="text-sm font-medium">主线不可偏移约束（每行一条）</span>
                <textarea
                  className={`${textareaClass} min-h-24`}
                  value={joinLines(workspace.story_spine.non_drift_constraints)}
                  onChange={(e) => updateStorySpine("non_drift_constraints", splitLines(e.target.value))}
                  placeholder="例：前期不能脱离底层求生主线"
                />
              </label>
            </Card>
          ) : (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Story Spine Snapshot（总纲约束速览）</h2>
                  <p className="mt-1 text-sm text-black/60">细纲视图只引用上位约束，不在这里重复铺开编辑；需要修改总纲时再切回总纲视图。</p>
                </div>
                <Button variant="ghost" onClick={() => setViewMode("macro")}>
                  切回总纲编辑
                </Button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  { label: "核心 Logline", value: workspace.story_spine.logline },
                  { label: "主线冲突", value: workspace.story_spine.main_conflict },
                  { label: "主角长期目标", value: workspace.story_spine.protagonist_long_goal },
                  { label: "外部主线压力", value: workspace.story_spine.external_pressure },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-black/[0.03] px-4 py-3">
                    <p className="text-xs text-black/50">{item.label}</p>
                    <p className="mt-1 text-sm leading-6">{item.value || "未填写"}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs text-amber-900/70">主线不可偏移约束</p>
                {workspace.story_spine.non_drift_constraints.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {workspace.story_spine.non_drift_constraints.map((item) => (
                      <span key={item} className="rounded-full bg-white px-3 py-1 text-xs text-amber-900">
                        {item}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-amber-900">尚未设置，建议回到总纲视图补充主线约束。</p>
                )}
              </div>
            </Card>
          )}

          {viewMode === "macro" && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Stage Outline（阶段大纲）</h2>
                  <p className="mt-1 text-sm text-black/60">阶段不再只是摘要卡片，而是章节与章节生成的上位约束源。</p>
                </div>
                <Button variant="ghost" onClick={addStage}>
                  新增阶段
                </Button>
              </div>

              {workspace.stages.length === 0 && <Card>暂无阶段大纲，可从 Story Spine 追加阶段建议。</Card>}

              {workspace.stages
                .slice()
                .sort((a, b) => a.phase_no - b.phase_no)
                .map((stage) => {
                  const expanded = expandedStages.includes(stage.phase_no);
                  const missingCount = countStageMissing(stage);
                  return (
                    <Card key={stage.phase_no}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold">阶段 {stage.phase_no} · {stage.title || "未命名阶段"}</h3>
                          <p className="mt-1 text-sm text-black/60">
                            {stage.stage_function || "阶段功能待补"} · 章节范围 {stage.chapter_range_start || "-"} - {stage.chapter_range_end || stage.milestone_chapter_no || "-"} ·
                            已归属 {stage.chapter_count ?? 0} 章
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {missingCount > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800">缺失项 {missingCount}</span>}
                          <Button variant="ghost" onClick={() => appendDerivedChapters(stage)}>
                            追加章节建议
                          </Button>
                          <Button variant="ghost" onClick={() => toggleStageExpanded(stage.phase_no)}>
                            {expanded ? "收起" : "展开"}
                          </Button>
                          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => removeStage(stage.phase_no)}>
                            删除
                          </Button>
                        </div>
                      </div>

                      {!expanded && (
                        <div className="mt-3 grid gap-2 md:grid-cols-3">
                          <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                            <p className="text-xs text-black/50">阶段目标</p>
                            <p>{stage.stage_goal || stage.goal || "未填写"}</p>
                          </div>
                          <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                            <p className="text-xs text-black/50">主要冲突</p>
                            <p>{stage.conflict || "未填写"}</p>
                          </div>
                          <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                            <p className="text-xs text-black/50">阶段收束</p>
                            <p>{stage.climax || stage.completion_criteria || "未填写"}</p>
                          </div>
                        </div>
                      )}

                      {expanded && (
                        <div className="mt-4 space-y-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段标题</span>
                              <input className={inputClass} value={stage.title} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, title: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段功能</span>
                              <input className={inputClass} value={stage.stage_function ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, stage_function: e.target.value }))} />
                            </label>
                            <label className="grid gap-1 md:col-span-2">
                              <span className="text-sm font-medium">阶段摘要</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.summary} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, summary: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段目标</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.stage_goal ?? stage.goal ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, stage_goal: e.target.value, goal: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段主要冲突</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.conflict ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, conflict: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">主要对手 / 压力源</span>
                              <input className={inputClass} value={stage.main_opponent ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, main_opponent: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段完成判定</span>
                              <input className={inputClass} value={stage.completion_criteria ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, completion_criteria: e.target.value }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">进入阶段时：主角处境</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.start_state.protagonist_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, start_state: { ...current.start_state, protagonist_state: e.target.value } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">进入阶段时：关键关系</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.start_state.relationship_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, start_state: { ...current.start_state, relationship_state: e.target.value } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">进入阶段时：世界局势</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.start_state.world_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, start_state: { ...current.start_state, world_state: e.target.value } }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段中点变化</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.midpoint_change ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, midpoint_change: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段高潮</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.climax ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, climax: e.target.value }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段代价</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.stage_cost ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, stage_cost: e.target.value }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段结束后：主角状态</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.ending_state.protagonist_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, ending_state: { ...current.ending_state, protagonist_state: e.target.value } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段结束后：关系状态</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.ending_state.relationship_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, ending_state: { ...current.ending_state, relationship_state: e.target.value } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段结束后：世界局势</span>
                              <textarea className={`${textareaClass} min-h-20`} value={stage.ending_state.world_state ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, ending_state: { ...current.ending_state, world_state: e.target.value } }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-3">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">剧情推进值（0-5）</span>
                              <input className={inputClass} type="number" min={0} max={5} value={stage.progress.plot ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, progress: { ...current.progress, plot: e.target.value ? Number(e.target.value) : null } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">关系推进值（0-5）</span>
                              <input className={inputClass} type="number" min={0} max={5} value={stage.progress.relationship ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, progress: { ...current.progress, relationship: e.target.value ? Number(e.target.value) : null } }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">信息推进值（0-5）</span>
                              <input className={inputClass} type="number" min={0} max={5} value={stage.progress.information ?? ""} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, progress: { ...current.progress, information: e.target.value ? Number(e.target.value) : null } }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段关键事件节点（每行一条）</span>
                              <textarea className={`${textareaClass} min-h-28`} value={joinLines(stage.key_events)} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, key_events: splitLines(e.target.value) }))} />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">阶段禁止偏移项（每行一条）</span>
                              <textarea className={`${textareaClass} min-h-28`} value={joinLines(stage.no_drift_constraints)} onChange={(e) => updateStage(stage.phase_no, (current) => ({ ...current, no_drift_constraints: splitLines(e.target.value) }))} />
                            </label>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="grid gap-2">
                              <span className="text-sm font-medium">涉及核心角色</span>
                              <div className="flex flex-wrap gap-2">
                                {characterOptions.map((character) => {
                                  const active = stage.involved_character_ids.includes(character.id);
                                  return (
                                    <button
                                      key={character.id}
                                      type="button"
                                      className={`${chipClass} ${active ? "border-black bg-black text-white" : "border-black/10 bg-white text-black/70"}`}
                                      onClick={() =>
                                        updateStage(stage.phase_no, (current) => ({
                                          ...current,
                                          involved_character_ids: toggleArrayValue(current.involved_character_ids, character.id),
                                        }))
                                      }
                                    >
                                      {character.name}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <label className="grid gap-1">
                              <span className="text-sm font-medium">角色职责标记（每行：角色名:role）</span>
                              <textarea
                                className={`${textareaClass} min-h-24`}
                                value={roleAssignmentsToText(stage.character_role_assignments, characterOptions)}
                                onChange={(e) =>
                                  updateStage(stage.phase_no, (current) => ({
                                    ...current,
                                    character_role_assignments: parseRoleAssignments(e.target.value, characterOptions),
                                  }))
                                }
                                placeholder={`例：林川:${roleOptions[0] || "mentor"}`}
                              />
                            </label>
                          </div>

                          <label className="grid gap-1">
                            <span className="text-sm font-medium">阶段伏笔关联（每行：seed名 | introduce/payoff/both | 状态）</span>
                            <textarea
                              className={`${textareaClass} min-h-24`}
                              value={seedLinksToText(stage.seed_links, seedOptions)}
                              onChange={(e) =>
                                updateStage(stage.phase_no, (current) => ({
                                  ...current,
                                  seed_links: parseSeedLinks(e.target.value, seedOptions, { phaseNo: stage.phase_no }),
                                }))
                              }
                              placeholder="例：古钟异动 | introduce | planned"
                            />
                          </label>
                        </div>
                      )}
                    </Card>
                  );
                })}
            </section>
          )}

          <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {viewMode === "macro" ? "Chapter Outline（章节骨架）" : "Fine Outline（章节细纲）"}
                  </h2>
                  <p className="mt-1 text-sm text-black/60">
                    {viewMode === "macro"
                      ? "章节骨架层保留目标、冲突、事件、揭露与钩子，用来锁定生成方向。"
                      : "细纲视图只聚焦章节写作作战信息：功能、场景推进、关键收获、关系变化、判断策略与章尾钩子。"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => addChapter(stageFilter === "all" ? null : Number(stageFilter))}>
                    新增章节
                  </Button>
                </div>
              </div>

              <Card>
                <div className="grid gap-3 md:grid-cols-1">
                  <label className="grid gap-1">
                    <span className="text-xs text-black/50">按阶段筛选</span>
                    <select className={inputClass} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
                      <option value="all">全部阶段</option>
                      {workspace.stages
                        .slice()
                        .sort((a, b) => a.phase_no - b.phase_no)
                        .map((stage) => (
                          <option key={stage.phase_no} value={String(stage.phase_no)}>
                            阶段 {stage.phase_no} · {stage.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </Card>

              {filteredChapters.length === 0 && <Card>当前筛选条件下暂无章节。</Card>}

              {filteredChapters
                .slice()
                .sort((a, b) => a.chapter_no - b.chapter_no)
                .map((chapter) => {
                  const expanded = expandedChapters.includes(chapter.chapter_no);
                  const missingCount =
                    viewMode === "macro" ? countChapterOutlineMissing(chapter) : countChapterFineOutlineMissing(chapter);
                  return (
                    <Card key={chapter.chapter_no}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold">{formatDisplayTitle(chapter.chapter_no, chapter.title)}</h3>
                          <p className="mt-1 text-sm text-black/60">
                            {chapter.stage_no ? `阶段 ${chapter.stage_no}${chapter.stage_title ? ` · ${chapter.stage_title}` : ""}` : "未归属阶段"} ·
                            {chapter.stage_position || "阶段位置待补"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {missingCount > 0 && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800">
                              {viewMode === "macro" ? "骨架缺失" : "细纲缺失"} {missingCount}
                            </span>
                          )}
                          <Button variant="ghost" onClick={() => toggleChapterExpanded(chapter.chapter_no)}>
                            {expanded ? "收起" : "展开"}
                          </Button>
                          <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => removeChapter(chapter.chapter_no)}>
                            删除
                          </Button>
                        </div>
                      </div>

                      {!expanded && (
                        viewMode === "macro" ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">本章目标</p>
                              <p>{chapter.goal || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">核心冲突</p>
                              <p>{chapter.core_conflict || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">关键事件</p>
                              <p>{chapter.key_events[0] || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">结尾钩子</p>
                              <p>{chapter.ending_hook || "未填写"}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 grid gap-2 md:grid-cols-4">
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">本章功能</p>
                              <p>{chapter.chapter_function || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">场景推进</p>
                              <p>{chapter.scene_progression[0] || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">关键收获</p>
                              <p>{chapter.key_takeaways[0] || "未填写"}</p>
                            </div>
                            <div className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">
                              <p className="text-xs text-black/50">章尾钩子</p>
                              <p>{chapter.ending_hook || "未填写"}</p>
                            </div>
                          </div>
                        )
                      )}

                      {expanded && (
                        viewMode === "macro" ? (
                          <div className="mt-4 space-y-4">
                            <div className="grid gap-4 md:grid-cols-3">
                              <label className="grid gap-1 md:col-span-2">
                                <span className="text-sm font-medium">章节标题</span>
                                <input
                                  className={inputClass}
                                  value={chapter.title}
                                  onChange={(e) =>
                                    updateChapter(chapter.chapter_no, (current) => ({
                                      ...current,
                                      title: stripChapterPrefix(e.target.value, current.chapter_no) || "未命名",
                                      display_title: formatDisplayTitle(current.chapter_no, e.target.value),
                                    }))
                                  }
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">预计字数</span>
                                <input
                                  className={inputClass}
                                  type="number"
                                  min={1000}
                                  step={100}
                                  value={chapter.word_target ?? ""}
                                  onChange={(e) =>
                                    updateChapter(chapter.chapter_no, (current) => ({
                                      ...current,
                                      word_target: e.target.value ? Number(e.target.value) : null,
                                    }))
                                  }
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">所属阶段</span>
                                <select
                                  className={inputClass}
                                  value={chapter.stage_no ?? ""}
                                  onChange={(e) =>
                                    updateChapter(chapter.chapter_no, (current) => {
                                      const nextStageNo = e.target.value ? Number(e.target.value) : null;
                                      const stage = workspace.stages.find((item) => item.phase_no === nextStageNo) ?? null;
                                      return {
                                        ...current,
                                        stage_no: nextStageNo,
                                        stage_title: stage?.title ?? null,
                                        stage_goal: stage?.stage_goal ?? stage?.goal ?? null,
                                        stage_conflict: stage?.conflict ?? null,
                                      };
                                    })
                                  }
                                >
                                  <option value="">未归属</option>
                                  {workspace.stages
                                    .slice()
                                    .sort((a, b) => a.phase_no - b.phase_no)
                                    .map((stage) => (
                                      <option key={stage.phase_no} value={stage.phase_no}>
                                        阶段 {stage.phase_no} · {stage.title}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">阶段内位置</span>
                                <select
                                  className={inputClass}
                                  value={chapter.stage_position ?? ""}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, stage_position: e.target.value }))}
                                >
                                  <option value="">未设置</option>
                                  {chapterPositionOptions.map((item) => (
                                    <option key={item} value={item}>
                                      {item}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">本章目标</span>
                                <textarea className={`${textareaClass} min-h-20`} value={chapter.goal ?? ""} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, goal: e.target.value }))} />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">本章核心冲突</span>
                                <textarea className={`${textareaClass} min-h-20`} value={chapter.core_conflict ?? ""} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, core_conflict: e.target.value }))} />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">结尾变化 / 钩子</span>
                                <input className={inputClass} value={chapter.ending_hook ?? ""} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, ending_hook: e.target.value }))} />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">角色变化</span>
                                <textarea className={`${textareaClass} min-h-20`} value={chapter.character_change ?? ""} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, character_change: e.target.value }))} />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">信息揭露</span>
                                <textarea className={`${textareaClass} min-h-20`} value={chapter.information_reveal ?? ""} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, information_reveal: e.target.value }))} />
                              </label>
                            </div>

                            <div className="grid gap-4">
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">关键事件（每行一条，建议 3-5 条）</span>
                                <textarea className={`${textareaClass} min-h-28`} value={joinLines(chapter.key_events)} onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, key_events: splitLines(e.target.value) }))} />
                              </label>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-3 text-sm">
                              <div>
                                <p className="font-medium">{formatDisplayTitle(chapter.chapter_no, chapter.title)}</p>
                                <p className="mt-1 text-black/60">
                                  {chapter.stage_no ? `阶段 ${chapter.stage_no}${chapter.stage_title ? ` · ${chapter.stage_title}` : ""}` : "未归属阶段"}
                                  {chapter.stage_position ? ` · ${chapter.stage_position}` : ""}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-black/50">共享骨架字段仍可在总纲视图编辑</span>
                                <Button
                                  variant="ghost"
                                  disabled={!canPrefillFineOutline(chapter)}
                                  onClick={() =>
                                    updateChapter(chapter.chapter_no, (current) => ({
                                      ...current,
                                      ...buildFineOutlinePrefill(current),
                                    }))
                                  }
                                >
                                  从骨架预填
                                </Button>
                              </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">本章功能</span>
                                <textarea
                                  className={`${textareaClass} min-h-24`}
                                  value={chapter.chapter_function ?? ""}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, chapter_function: e.target.value }))}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">章尾钩子</span>
                                <input
                                  className={inputClass}
                                  value={chapter.ending_hook ?? ""}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, ending_hook: e.target.value }))}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">场景推进（每行一条）</span>
                                <textarea
                                  className={`${textareaClass} min-h-28`}
                                  value={joinLines(chapter.scene_progression)}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, scene_progression: splitLines(e.target.value) }))}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">关键收获（每行一条）</span>
                                <textarea
                                  className={`${textareaClass} min-h-28`}
                                  value={joinLines(chapter.key_takeaways)}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, key_takeaways: splitLines(e.target.value) }))}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">关系变化（每行一条）</span>
                                <textarea
                                  className={`${textareaClass} min-h-28`}
                                  value={joinLines(chapter.relationship_changes)}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, relationship_changes: splitLines(e.target.value) }))}
                                />
                              </label>
                              <label className="grid gap-1">
                                <span className="text-sm font-medium">主角判断 / 策略</span>
                                <textarea
                                  className={`${textareaClass} min-h-28`}
                                  value={chapter.strategy_judgment ?? ""}
                                  onChange={(e) => updateChapter(chapter.chapter_no, (current) => ({ ...current, strategy_judgment: e.target.value }))}
                                />
                              </label>
                            </div>
                          </div>
                        )
                      )}
                    </Card>
                  );
                })}
          </section>
        </div>

        <div className="space-y-4">
          <Card className="sticky top-6">
            <h2 className="text-lg font-semibold">Outline Diagnostics</h2>
            <p className="mt-1 text-sm text-black/60">{diagnosticsDescription}</p>
            <div className="mt-4 space-y-4">
              {diagnosticScopesByView[viewMode].map((scope) => (
                <section key={scope}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{diagnosticScopeLabels[scope]}</h3>
                    <span className="text-xs text-black/45">{diagnosticsByScope[scope].length}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {diagnosticsByScope[scope].length === 0 && (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">当前未发现明显问题。</div>
                    )}
                    {diagnosticsByScope[scope].map((item) => (
                      <div
                        key={`${scope}-${item.code}-${item.phase_no ?? ""}-${item.chapter_no ?? ""}`}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          item.level === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"
                        }`}
                      >
                        <p className="font-medium">{item.title}</p>
                        <p className="mt-1 text-xs leading-5">
                          {item.message}
                          {item.phase_no ? ` · 阶段 ${item.phase_no}` : ""}
                          {item.chapter_no ? ` · 第 ${item.chapter_no} 章` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
