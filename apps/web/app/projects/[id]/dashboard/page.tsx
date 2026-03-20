"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BootstrapAdvisorPanel } from "@/components/bootstrap-advisor-panel";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

type InspirationChoice = {
  id: string;
  label: string;
  description: string;
};

type StorySeedOption = {
  id: string;
  label: string;
  setup: string;
  subGenres?: string[];
  tropes?: string[];
};

type ProtagonistTemplate = {
  id: string;
  roleIdentity: string;
  strength: string;
  weakness: string;
  subGenres: string[];
  tropes: string[];
};

type GenreTaxonomy = {
  id: string;
  label: string;
  description: string;
  subGenres: InspirationChoice[];
  tropes: InspirationChoice[];
  storySeeds: StorySeedOption[];
  protagonistTemplates: ProtagonistTemplate[];
};

type VolumeMission = {
  chapterNo: number;
  title: string;
  mission: string;
};

type VolumePlan = {
  volumeTitle: string;
  mainObjective: string;
  antagonistForce: string;
  centralMystery: string;
  firstTurningPoint: string;
  chapterMissions: VolumeMission[];
};

type PersistedWizardState = {
  version: number;
  wizardStep: WizardStep;
  selectedGenreId: string;
  selectedSubGenreId: string;
  selectedTropeIds: string[];
  storySeedOptions: StorySeedOption[];
  selectedStorySeed: StorySeedOption | null;
  selectedProtagonistTemplate: ProtagonistTemplate | null;
  titleOptions: string[];
  selectedTitle: string;
  loglineOptions: string[];
  selectedLogline: string;
  selectedVolumePlan: VolumePlan | null;
};

const REQUEST_TIMEOUT_MS = 120_000;
const CHAPTER_READY_RETRIES = 25;
const POLL_INTERVAL_MS = 1_200;
const STORAGE_VERSION = 2;
const STEP_LABELS: Array<{ step: WizardStep; label: string }> = [
  { step: 1, label: "题材" },
  { step: 2, label: "子类" },
  { step: 3, label: "爽点" },
  { step: 4, label: "故事种子" },
  { step: 5, label: "主角模板" },
  { step: 6, label: "标题" },
  { step: 7, label: "Logline" },
  { step: 8, label: "卷一骨架" },
];
const DEFAULT_BOOTSTRAP_QUICK_PROMPTS = [
  "这个题材组合够抓人吗？",
  "这个故事种子开篇够狠吗？",
  "这个标题和 logline 还差什么？",
] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function storageKey(projectId: string) {
  return `story-start-wizard:${projectId}`;
}

function buildProtagonistBrief(template: ProtagonistTemplate | null) {
  if (!template) {
    return "";
  }
  return `身份：${template.roleIdentity}。强项：${template.strength}。弱点：${template.weakness}。`;
}

function scoreTaggedItem(item: { subGenres: string[]; tropes: string[] }, subGenreId: string, tropeIds: string[]) {
  let score = 0;
  if (item.subGenres.includes(subGenreId)) {
    score += 4;
  }
  for (const tropeId of tropeIds) {
    if (item.tropes.includes(tropeId)) {
      score += 2;
    }
  }
  return score;
}

function SelectionCard({
  title,
  subtitle,
  selected,
  onClick,
  badge,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onClick: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected ? "border-ink bg-white shadow-sm" : "border-black/10 bg-white/70 hover:bg-white"
      }`}
    >
      {badge ? <p className="text-[11px] font-semibold uppercase tracking-wide text-black/45">{badge}</p> : null}
      <p className="text-base font-semibold text-ink">{title}</p>
      {subtitle ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-black/65">{subtitle}</p> : null}
    </button>
  );
}

function SummaryPill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/70">{children}</span>;
}

function toCamelTaxonomy(data: any): GenreTaxonomy[] {
  if (!Array.isArray(data?.genres)) {
    return [];
  }
  return data.genres.map((genre: any) => ({
    id: genre.id,
    label: genre.label,
    description: genre.description,
    subGenres: Array.isArray(genre.sub_genres) ? genre.sub_genres : [],
    tropes: Array.isArray(genre.tropes) ? genre.tropes : [],
    storySeeds: Array.isArray(genre.story_seeds)
      ? genre.story_seeds.map((seed: any) => ({
          id: seed.id,
          label: seed.label,
          setup: seed.setup,
          subGenres: seed.sub_genres ?? [],
          tropes: seed.tropes ?? [],
        }))
      : [],
    protagonistTemplates: Array.isArray(genre.protagonist_templates)
      ? genre.protagonist_templates.map((template: any) => ({
          id: template.id,
          roleIdentity: template.role_identity,
          strength: template.strength,
          weakness: template.weakness,
          subGenres: template.sub_genres ?? [],
          tropes: template.tropes ?? [],
        }))
      : [],
  }));
}

function toVolumePlan(plan: any): VolumePlan | null {
  if (!plan || typeof plan !== "object") {
    return null;
  }
  return {
    volumeTitle: plan.volume_title ?? "",
    mainObjective: plan.main_objective ?? "",
    antagonistForce: plan.antagonist_force ?? "",
    centralMystery: plan.central_mystery ?? "",
    firstTurningPoint: plan.first_turning_point ?? "",
    chapterMissions: Array.isArray(plan.chapter_missions)
      ? plan.chapter_missions.map((mission: any) => ({
          chapterNo: Number(mission.chapter_no),
          title: mission.title,
          mission: mission.mission,
        }))
      : [],
  };
}

export default function DashboardPage({ params }: Props) {
  const router = useRouter();
  const restoredRef = useRef(false);
  const [projectId, setProjectId] = useState("");
  const [project, setProject] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [taxonomy, setTaxonomy] = useState<GenreTaxonomy[]>([]);
  const [taxonomyError, setTaxonomyError] = useState("");

  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [selectedGenreId, setSelectedGenreId] = useState("");
  const [selectedSubGenreId, setSelectedSubGenreId] = useState("");
  const [selectedTropeIds, setSelectedTropeIds] = useState<string[]>([]);
  const [storySeedOptions, setStorySeedOptions] = useState<StorySeedOption[]>([]);
  const [selectedStorySeed, setSelectedStorySeed] = useState<StorySeedOption | null>(null);
  const [selectedProtagonistTemplate, setSelectedProtagonistTemplate] = useState<ProtagonistTemplate | null>(null);
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [selectedTitle, setSelectedTitle] = useState("");
  const [loglineOptions, setLoglineOptions] = useState<string[]>([]);
  const [selectedLogline, setSelectedLogline] = useState("");
  const [selectedVolumePlan, setSelectedVolumePlan] = useState<VolumePlan | null>(null);

  const [storySeedLoading, setStorySeedLoading] = useState(false);
  const [storySeedError, setStorySeedError] = useState("");
  const [titleLoading, setTitleLoading] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [loglineLoading, setLoglineLoading] = useState(false);
  const [loglineError, setLoglineError] = useState("");
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeError, setVolumeError] = useState("");
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomError, setRandomError] = useState("");

  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapStatus, setBootstrapStatus] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");

  const [advisorMessages, setAdvisorMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [advisorInput, setAdvisorInput] = useState("");
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [advisorError, setAdvisorError] = useState("");
  const [advisorQuickPrompts, setAdvisorQuickPrompts] = useState<string[]>([...DEFAULT_BOOTSTRAP_QUICK_PROMPTS]);

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

  const selectedGenre = useMemo(
    () => taxonomy.find((genre) => genre.id === selectedGenreId) ?? null,
    [taxonomy, selectedGenreId],
  );
  const selectedSubGenre = useMemo(
    () => selectedGenre?.subGenres.find((subGenre) => subGenre.id === selectedSubGenreId) ?? null,
    [selectedGenre, selectedSubGenreId],
  );
  const selectedTropeChoices = useMemo(
    () => selectedGenre?.tropes.filter((trope) => selectedTropeIds.includes(trope.id)) ?? [],
    [selectedGenre, selectedTropeIds],
  );
  const protagonistOptions = useMemo(() => {
    if (!selectedGenre || !selectedSubGenreId || selectedTropeIds.length === 0) {
      return [];
    }
    return selectedGenre.protagonistTemplates
      .slice()
      .sort(
        (left, right) =>
          scoreTaggedItem(right, selectedSubGenreId, selectedTropeIds) - scoreTaggedItem(left, selectedSubGenreId, selectedTropeIds),
      );
  }, [selectedGenre, selectedSubGenreId, selectedTropeIds]);

  const maxUnlockedStep: WizardStep = useMemo(() => {
    if (!selectedGenreId) return 1;
    if (!selectedSubGenreId) return 2;
    if (selectedTropeIds.length < 2) return 3;
    if (!selectedStorySeed) return 4;
    if (!selectedProtagonistTemplate) return 5;
    if (!selectedTitle) return 6;
    if (!selectedLogline) return 7;
    return 8;
  }, [selectedGenreId, selectedSubGenreId, selectedTropeIds.length, selectedStorySeed, selectedProtagonistTemplate, selectedTitle, selectedLogline]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { id } = await params;
        if (cancelled) return;
        setProjectId(id);
        const [projectData, chapterData, projectsData, taxonomyData] = await Promise.all([
          requestJson(`${API_BASE}/projects/${id}`),
          requestJson(`${API_BASE}/projects/${id}/chapters`),
          requestJson(`${API_BASE}/projects`),
          requestJson(`${API_BASE}/projects/${id}/bootstrap-inspiration`),
        ]);
        if (cancelled) return;
        setProject(projectData);
        setChapters(Array.isArray(chapterData) ? chapterData : []);
        setTotalProjects(Array.isArray(projectsData) ? projectsData.length : 0);
        setTaxonomy(toCamelTaxonomy(taxonomyData));
      } catch (error) {
        if (!cancelled) {
          setTaxonomyError(formatErrorMessage(error, "开局灵感系统加载失败，请刷新后重试"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!projectId || restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    try {
      const raw = window.localStorage.getItem(storageKey(projectId));
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as PersistedWizardState;
      if (saved.version !== STORAGE_VERSION) {
        return;
      }
      setWizardStep(saved.wizardStep);
      setSelectedGenreId(saved.selectedGenreId);
      setSelectedSubGenreId(saved.selectedSubGenreId);
      setSelectedTropeIds(saved.selectedTropeIds);
      setStorySeedOptions(saved.storySeedOptions ?? []);
      setSelectedStorySeed(saved.selectedStorySeed ?? null);
      setSelectedProtagonistTemplate(saved.selectedProtagonistTemplate ?? null);
      setTitleOptions(saved.titleOptions ?? []);
      setSelectedTitle(saved.selectedTitle ?? "");
      setLoglineOptions(saved.loglineOptions ?? []);
      setSelectedLogline(saved.selectedLogline ?? "");
      setSelectedVolumePlan(saved.selectedVolumePlan ?? null);
    } catch {
      window.localStorage.removeItem(storageKey(projectId));
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !restoredRef.current) {
      return;
    }
    const nextState: PersistedWizardState = {
      version: STORAGE_VERSION,
      wizardStep,
      selectedGenreId,
      selectedSubGenreId,
      selectedTropeIds,
      storySeedOptions,
      selectedStorySeed,
      selectedProtagonistTemplate,
      titleOptions,
      selectedTitle,
      loglineOptions,
      selectedLogline,
      selectedVolumePlan,
    };
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(nextState));
  }, [
    loglineOptions,
    projectId,
    selectedGenreId,
    selectedLogline,
    selectedProtagonistTemplate,
    selectedStorySeed,
    selectedSubGenreId,
    selectedTitle,
    selectedTropeIds,
    selectedVolumePlan,
    storySeedOptions,
    titleOptions,
    wizardStep,
  ]);

  useEffect(() => {
    if (wizardStep > maxUnlockedStep) {
      setWizardStep(maxUnlockedStep);
    }
  }, [maxUnlockedStep, wizardStep]);

  async function askBootstrapAdvisor(questionOverride?: string) {
    if (!projectId) return;
    const question = (questionOverride ?? advisorInput).trim();
    if (!question) return;

    const nextMessages = [...advisorMessages, { role: "user" as const, content: question }];
    setAdvisorMessages(nextMessages);
    setAdvisorInput("");
    setAdvisorError("");
    setAdvisorLoading(true);
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          logline: selectedLogline || undefined,
          protagonist_brief: buildProtagonistBrief(selectedProtagonistTemplate) || undefined,
          tone_setting: [selectedGenre?.label, selectedSubGenre?.label].filter(Boolean).join(" / ") || undefined,
          messages: nextMessages,
        }),
      });
      setAdvisorMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: typeof data?.reply === "string" && data.reply.trim() ? data.reply : "我暂时没整理出有效建议。",
        },
      ]);
      if (Array.isArray(data?.quick_prompts) && data.quick_prompts.length > 0) {
        setAdvisorQuickPrompts(data.quick_prompts);
      }
    } catch (error) {
      setAdvisorError(formatErrorMessage(error, "获取开局建议失败"));
    } finally {
      setAdvisorLoading(false);
    }
  }

  function clearFromStep(step: WizardStep) {
    if (step <= 2) {
      setSelectedSubGenreId("");
    }
    if (step <= 3) {
      setSelectedTropeIds([]);
    }
    if (step <= 4) {
      setStorySeedOptions([]);
      setSelectedStorySeed(null);
      setStorySeedError("");
    }
    if (step <= 5) {
      setSelectedProtagonistTemplate(null);
    }
    if (step <= 6) {
      setTitleOptions([]);
      setSelectedTitle("");
      setTitleError("");
    }
    if (step <= 7) {
      setLoglineOptions([]);
      setSelectedLogline("");
      setLoglineError("");
    }
    if (step <= 8) {
      setSelectedVolumePlan(null);
      setVolumeError("");
    }
  }

  function resetWizard() {
    setWizardStep(1);
    setSelectedGenreId("");
    setSelectedSubGenreId("");
    setSelectedTropeIds([]);
    setStorySeedOptions([]);
    setSelectedStorySeed(null);
    setSelectedProtagonistTemplate(null);
    setTitleOptions([]);
    setSelectedTitle("");
    setLoglineOptions([]);
    setSelectedLogline("");
    setSelectedVolumePlan(null);
    setStorySeedError("");
    setTitleError("");
    setLoglineError("");
    setVolumeError("");
    setRandomError("");
    if (projectId) {
      window.localStorage.removeItem(storageKey(projectId));
    }
  }

  async function generateStorySeeds() {
    if (!projectId || !selectedGenre || !selectedSubGenre || selectedTropeIds.length < 2) return;
    setStorySeedLoading(true);
    setStorySeedError("");
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-story-seeds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre: selectedGenre.id,
          sub_genre: selectedSubGenre.id,
          tropes: selectedTropeIds,
          exclude_ids: storySeedOptions.map((option) => option.id),
        }),
      });
      const nextOptions = Array.isArray(data?.options) ? data.options : [];
      const mapped = nextOptions.map((option: any, index: number) => ({
        id: option.id || `seed-${Date.now()}-${index}`,
        label: option.label,
        setup: option.setup,
      }));
      setStorySeedOptions(mapped);
      if (!mapped.some((option: StorySeedOption) => option.id === selectedStorySeed?.id)) {
        setSelectedStorySeed(null);
      }
    } catch (error) {
      setStorySeedError(formatErrorMessage(error, "生成故事种子失败，请稍后重试"));
    } finally {
      setStorySeedLoading(false);
    }
  }

  async function generateTitles() {
    if (!projectId || !selectedGenre || !selectedSubGenre || selectedTropeIds.length < 2 || !selectedStorySeed || !selectedProtagonistTemplate) return;
    setTitleLoading(true);
    setTitleError("");
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-titles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre: selectedGenre.id,
          sub_genre: selectedSubGenre.id,
          tropes: selectedTropeIds,
          story_seed: {
            label: selectedStorySeed.label,
            setup: selectedStorySeed.setup,
          },
          protagonist_template: {
            role_identity: selectedProtagonistTemplate.roleIdentity,
            strength: selectedProtagonistTemplate.strength,
            weakness: selectedProtagonistTemplate.weakness,
          },
        }),
      });
      const nextOptions = Array.isArray(data?.options) ? data.options.filter((item: unknown) => typeof item === "string") : [];
      setTitleOptions(nextOptions);
      if (!nextOptions.includes(selectedTitle)) {
        setSelectedTitle("");
      }
    } catch (error) {
      setTitleError(formatErrorMessage(error, "生成标题失败，请稍后重试"));
    } finally {
      setTitleLoading(false);
    }
  }

  async function generateLoglines() {
    if (!projectId || !selectedGenre || !selectedSubGenre || selectedTropeIds.length < 2 || !selectedStorySeed || !selectedProtagonistTemplate || !selectedTitle) return;
    setLoglineLoading(true);
    setLoglineError("");
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-loglines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre: selectedGenre.id,
          sub_genre: selectedSubGenre.id,
          tropes: selectedTropeIds,
          story_seed: {
            label: selectedStorySeed.label,
            setup: selectedStorySeed.setup,
          },
          protagonist_template: {
            role_identity: selectedProtagonistTemplate.roleIdentity,
            strength: selectedProtagonistTemplate.strength,
            weakness: selectedProtagonistTemplate.weakness,
          },
          selected_title: selectedTitle,
        }),
      });
      const nextOptions = Array.isArray(data?.options) ? data.options.filter((item: unknown) => typeof item === "string") : [];
      setLoglineOptions(nextOptions);
      if (!nextOptions.includes(selectedLogline)) {
        setSelectedLogline("");
      }
    } catch (error) {
      setLoglineError(formatErrorMessage(error, "生成 logline 失败，请稍后重试"));
    } finally {
      setLoglineLoading(false);
    }
  }

  async function generateVolumePlan() {
    if (!projectId || !selectedGenre || !selectedSubGenre || selectedTropeIds.length < 2 || !selectedStorySeed || !selectedProtagonistTemplate || !selectedTitle || !selectedLogline) return;
    setVolumeLoading(true);
    setVolumeError("");
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-volume-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre: selectedGenre.id,
          sub_genre: selectedSubGenre.id,
          tropes: selectedTropeIds,
          story_seed: {
            label: selectedStorySeed.label,
            setup: selectedStorySeed.setup,
          },
          protagonist_template: {
            role_identity: selectedProtagonistTemplate.roleIdentity,
            strength: selectedProtagonistTemplate.strength,
            weakness: selectedProtagonistTemplate.weakness,
          },
          selected_title: selectedTitle,
          selected_logline: selectedLogline,
        }),
      });
      setSelectedVolumePlan(toVolumePlan(data?.plan));
    } catch (error) {
      setVolumeError(formatErrorMessage(error, "生成卷一骨架失败，请稍后重试"));
    } finally {
      setVolumeLoading(false);
    }
  }

  async function generateRandomIdea() {
    if (!projectId) return;
    setRandomLoading(true);
    setRandomError("");
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap-random-idea`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genre: selectedGenreId || undefined,
        }),
      });
      const setup = data?.setup ?? {};
      setSelectedGenreId(setup.genre ?? "");
      setSelectedSubGenreId(setup.sub_genre ?? "");
      setSelectedTropeIds(Array.isArray(setup.tropes) ? setup.tropes : []);
      setStorySeedOptions(Array.isArray(data?.options?.story_seeds) ? data.options.story_seeds : []);
      setSelectedStorySeed(setup.story_seed ?? null);
      setSelectedProtagonistTemplate(
        setup.protagonist_template
          ? {
              id: setup.protagonist_template.id ?? `random-template-${Date.now()}`,
              roleIdentity: setup.protagonist_template.role_identity,
              strength: setup.protagonist_template.strength,
              weakness: setup.protagonist_template.weakness,
              subGenres: setup.protagonist_template.sub_genres ?? [],
              tropes: setup.protagonist_template.tropes ?? [],
            }
          : null,
      );
      setTitleOptions(Array.isArray(data?.options?.titles) ? data.options.titles : []);
      setSelectedTitle(setup.selected_title ?? "");
      setLoglineOptions(Array.isArray(data?.options?.loglines) ? data.options.loglines : []);
      setSelectedLogline(setup.selected_logline ?? "");
      setSelectedVolumePlan(toVolumePlan(setup.selected_volume_plan));
      setWizardStep(8);
    } catch (error) {
      setRandomError(formatErrorMessage(error, "随机灵感生成失败，请稍后重试"));
    } finally {
      setRandomLoading(false);
    }
  }

  async function runBootstrap() {
    if (!projectId || !selectedGenre || !selectedSubGenre || !selectedStorySeed || !selectedProtagonistTemplate || !selectedTitle || !selectedLogline || !selectedVolumePlan) {
      return;
    }
    setBootstrapError("");
    setBootstrapStatus("向导执行中：正在写入卷一骨架、初始化圣经并生成第一章 Beats...");
    setBootstrapping(true);
    try {
      const data = await requestJson(`${API_BASE}/projects/${projectId}/bootstrap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          logline: selectedLogline,
          protagonist_brief: buildProtagonistBrief(selectedProtagonistTemplate),
          tone_setting: [selectedGenre.label, selectedSubGenre.label].filter(Boolean).join(" / "),
          genre: [selectedGenre.label, selectedSubGenre.label].filter(Boolean).join(" · "),
          sub_genre: selectedSubGenre.label,
          tropes: selectedTropeChoices.map((trope) => trope.label),
          story_seed: `${selectedStorySeed.label}：${selectedStorySeed.setup}`,
          protagonist_template: {
            role_identity: selectedProtagonistTemplate.roleIdentity,
            strength: selectedProtagonistTemplate.strength,
            weakness: selectedProtagonistTemplate.weakness,
          },
          selected_title: selectedTitle,
          selected_volume_plan: {
            volume_title: selectedVolumePlan.volumeTitle,
            main_objective: selectedVolumePlan.mainObjective,
            antagonist_force: selectedVolumePlan.antagonistForce,
            central_mystery: selectedVolumePlan.centralMystery,
            first_turning_point: selectedVolumePlan.firstTurningPoint,
            chapter_missions: selectedVolumePlan.chapterMissions.map((mission) => ({
              chapter_no: mission.chapterNo,
              title: mission.title,
              mission: mission.mission,
            })),
          },
        }),
      });

      const targetChapterNo = Number(data?.chapter_no) > 0 ? Number(data.chapter_no) : 1;
      const readyChapter = await waitForChapterReady(projectId, targetChapterNo);
      if (!readyChapter) {
        throw new Error("章节初始化超时，请稍后重试。");
      }

      await reloadDashboard(projectId);
      window.localStorage.removeItem(storageKey(projectId));
      setBootstrapStatus("初始化完成，正在进入工作台...");
      router.push(data.workspace_path ?? `/projects/${projectId}/chapters/${targetChapterNo}/workspace`);
    } catch (error) {
      setBootstrapError(formatErrorMessage(error, "启动向导失败，请稍后重试"));
      setBootstrapStatus("");
    } finally {
      setBootstrapping(false);
    }
  }

  useEffect(() => {
    if (wizardStep === 4 && selectedGenre && selectedSubGenre && selectedTropeIds.length >= 2 && storySeedOptions.length === 0 && !storySeedLoading) {
      void generateStorySeeds();
    }
  }, [selectedGenre, selectedSubGenre, selectedTropeIds.length, storySeedLoading, storySeedOptions.length, wizardStep]);

  useEffect(() => {
    if (wizardStep === 6 && selectedStorySeed && selectedProtagonistTemplate && titleOptions.length === 0 && !titleLoading) {
      void generateTitles();
    }
  }, [selectedProtagonistTemplate, selectedStorySeed, titleLoading, titleOptions.length, wizardStep]);

  useEffect(() => {
    if (wizardStep === 7 && selectedTitle && selectedStorySeed && selectedProtagonistTemplate && loglineOptions.length === 0 && !loglineLoading) {
      void generateLoglines();
    }
  }, [loglineLoading, loglineOptions.length, selectedProtagonistTemplate, selectedStorySeed, selectedTitle, wizardStep]);

  useEffect(() => {
    if (wizardStep === 8 && selectedLogline && !selectedVolumePlan && !volumeLoading) {
      void generateVolumePlan();
    }
  }, [selectedLogline, selectedVolumePlan, volumeLoading, wizardStep]);

  if (!projectId) {
    return <main className="p-8">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">{project?.title ?? "项目仪表盘"}</h1>
      <div className="mt-5 grid gap-4 md:grid-cols-4">
        <Card><p className="text-sm text-black/60">作品总数</p><p className="text-2xl font-semibold">{totalProjects}</p></Card>
        <Card><p className="text-sm text-black/60">题材类型</p><p>{project?.genre ?? "未设置"}</p></Card>
        <Card><p className="text-sm text-black/60">叙事视角 / 时态</p><p>{(project?.pov ?? "third")}/{project?.tense ?? "past"}</p></Card>
        <Card><p className="text-sm text-black/60">章节数</p><p>{chapters.length}</p></Card>
      </div>

      <Card className="mt-6 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,244,223,0.95),rgba(255,255,255,0.9)_48%,rgba(243,247,255,0.92))]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">AI 灵感开局系统</h2>
            <p className="mt-1 max-w-2xl text-sm text-black/65">
              这次不再要求你先写标题或 logline。我们先选题材，再一步步收窄到故事种子、主角模板、标题、logline 和卷一骨架。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={randomLoading || bootstrapping} onClick={generateRandomIdea}>
              {randomLoading ? "随机灵感生成中..." : "随机灵感"}
            </Button>
            <Button variant="ghost" disabled={bootstrapping} onClick={resetWizard}>
              重新开始
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[1.45fr,0.95fr]">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {STEP_LABELS.map((item) => {
                const enabled = item.step <= maxUnlockedStep;
                const active = item.step === wizardStep;
                return (
                  <button
                    key={item.step}
                    type="button"
                    disabled={!enabled || bootstrapping}
                    onClick={() => setWizardStep(item.step)}
                    className={`rounded-full px-3 py-1.5 text-xs transition ${
                      active ? "bg-ink text-paper" : enabled ? "bg-black/5 text-ink hover:bg-black/10" : "bg-black/[0.03] text-black/35"
                    }`}
                  >
                    {item.step}. {item.label}
                  </button>
                );
              })}
            </div>

            {taxonomyError && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{taxonomyError}</div>}
            {randomError && <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{randomError}</div>}

            <Card className="bg-white/75">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-black/45">Step {wizardStep}/8</p>
                  <h3 className="mt-1 text-xl font-semibold">{STEP_LABELS.find((item) => item.step === wizardStep)?.label}</h3>
                </div>
                <p className="text-xs text-black/50">{chapters.length === 0 ? "零灵感也能起步" : "重新生成会覆盖开局设定"}</p>
              </div>

              {wizardStep === 1 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {taxonomy.map((genre) => (
                    <SelectionCard
                      key={genre.id}
                      title={genre.label}
                      subtitle={genre.description}
                      selected={selectedGenreId === genre.id}
                      onClick={() => {
                        setSelectedGenreId(genre.id);
                        clearFromStep(2);
                        setWizardStep(2);
                      }}
                    />
                  ))}
                </div>
              )}

              {wizardStep === 2 && selectedGenre && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {selectedGenre.subGenres.map((subGenre) => (
                    <SelectionCard
                      key={subGenre.id}
                      title={subGenre.label}
                      subtitle={subGenre.description}
                      selected={selectedSubGenreId === subGenre.id}
                      onClick={() => {
                        setSelectedSubGenreId(subGenre.id);
                        clearFromStep(3);
                        setWizardStep(3);
                      }}
                    />
                  ))}
                </div>
              )}

              {wizardStep === 3 && selectedGenre && (
                <div className="mt-4">
                  <p className="text-sm text-black/60">请选择 2-3 个爽点，它们会直接收窄后面的故事种子和主角模板。</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedGenre.tropes.map((trope) => {
                      const selected = selectedTropeIds.includes(trope.id);
                      return (
                        <button
                          key={trope.id}
                          type="button"
                          onClick={() => {
                            if (selected) {
                              setSelectedTropeIds((current) => current.filter((item) => item !== trope.id));
                              clearFromStep(4);
                              return;
                            }
                            if (selectedTropeIds.length >= 3) {
                              return;
                            }
                            setSelectedTropeIds((current) => [...current, trope.id]);
                            clearFromStep(4);
                          }}
                          className={`rounded-full px-4 py-2 text-sm transition ${
                            selected ? "bg-ink text-paper" : "bg-black/5 text-ink hover:bg-black/10"
                          }`}
                        >
                          {trope.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {wizardStep === 4 && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-black/60">AI 会先给你 6 个更具体的开场事件。选一个，后面会围着它继续收窄。</p>
                    <Button variant="ghost" disabled={storySeedLoading || bootstrapping} onClick={generateStorySeeds}>
                      {storySeedLoading ? "正在生成..." : storySeedOptions.length > 0 ? "Regenerate" : "AI 生成故事种子"}
                    </Button>
                  </div>
                  {storySeedError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{storySeedError}</div>}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {storySeedOptions.map((option) => (
                      <SelectionCard
                        key={option.id}
                        title={option.label}
                        subtitle={option.setup === option.label ? undefined : option.setup}
                        selected={selectedStorySeed?.id === option.id}
                        onClick={() => {
                          setSelectedStorySeed(option);
                          clearFromStep(5);
                          setWizardStep(5);
                        }}
                        badge="Story Seed"
                      />
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 5 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {protagonistOptions.map((template, index) => (
                    <SelectionCard
                      key={template.id}
                      title={template.roleIdentity}
                      subtitle={`强项：${template.strength}\n弱点：${template.weakness}`}
                      selected={selectedProtagonistTemplate?.id === template.id}
                      onClick={() => {
                        setSelectedProtagonistTemplate(template);
                        clearFromStep(6);
                        setWizardStep(6);
                      }}
                      badge={index < 3 ? "Recommended" : undefined}
                    />
                  ))}
                </div>
              )}

              {wizardStep === 6 && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-black/60">标题不需要你先写，先挑一个最有卖相的版本。</p>
                    <Button variant="ghost" disabled={titleLoading || bootstrapping} onClick={generateTitles}>
                      {titleLoading ? "正在生成..." : titleOptions.length > 0 ? "Regenerate" : "AI 生成标题"}
                    </Button>
                  </div>
                  {titleError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{titleError}</div>}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {titleOptions.map((title) => (
                      <SelectionCard
                        key={title}
                        title={title}
                        selected={selectedTitle === title}
                        onClick={() => {
                          setSelectedTitle(title);
                          clearFromStep(7);
                          setWizardStep(7);
                        }}
                        badge="Title"
                      />
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 7 && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-black/60">这里的每条 logline 都会带上主角身份、具体事件和核心冲突。</p>
                    <Button variant="ghost" disabled={loglineLoading || bootstrapping} onClick={generateLoglines}>
                      {loglineLoading ? "正在生成..." : loglineOptions.length > 0 ? "Regenerate" : "AI 生成 Logline"}
                    </Button>
                  </div>
                  {loglineError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{loglineError}</div>}
                  <div className="mt-4 grid gap-3">
                    {loglineOptions.map((option, index) => (
                      <SelectionCard
                        key={`${option}-${index}`}
                        title={`Option ${index + 1}`}
                        subtitle={option}
                        selected={selectedLogline === option}
                        onClick={() => {
                          setSelectedLogline(option);
                          clearFromStep(8);
                          setWizardStep(8);
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {wizardStep === 8 && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-black/60">卷一骨架会直接喂给 bootstrap，用来初始化第一章和整体方向。</p>
                    <Button variant="ghost" disabled={volumeLoading || bootstrapping} onClick={generateVolumePlan}>
                      {volumeLoading ? "正在生成..." : selectedVolumePlan ? "Regenerate" : "AI 生成卷一骨架"}
                    </Button>
                  </div>
                  {volumeError && <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{volumeError}</div>}
                  {selectedVolumePlan && (
                    <div className="mt-4 rounded-2xl border border-black/10 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-black/45">Volume 1</p>
                          <h4 className="text-xl font-semibold">{selectedVolumePlan.volumeTitle}</h4>
                        </div>
                        <SummaryPill>{selectedGenre?.label}</SummaryPill>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div><p className="text-xs text-black/45">主要目标</p><p className="mt-1 text-sm leading-6">{selectedVolumePlan.mainObjective}</p></div>
                        <div><p className="text-xs text-black/45">反派力量</p><p className="mt-1 text-sm leading-6">{selectedVolumePlan.antagonistForce}</p></div>
                        <div><p className="text-xs text-black/45">核心谜团</p><p className="mt-1 text-sm leading-6">{selectedVolumePlan.centralMystery}</p></div>
                        <div><p className="text-xs text-black/45">第一次转折</p><p className="mt-1 text-sm leading-6">{selectedVolumePlan.firstTurningPoint}</p></div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {selectedVolumePlan.chapterMissions.map((mission) => (
                          <div key={mission.chapterNo} className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-black/45">Chapter {mission.chapterNo}</p>
                            <p className="mt-1 font-medium">{mission.title}</p>
                            <p className="mt-2 text-sm leading-6 text-black/65">{mission.mission}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {bootstrapping && <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{bootstrapStatus}</div>}
              {bootstrapError && <div className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{bootstrapError}</div>}
            </Card>

            <BootstrapAdvisorPanel
              messages={advisorMessages}
              input={advisorInput}
              loading={advisorLoading}
              error={advisorError}
              quickPrompts={advisorQuickPrompts}
              onInputChange={setAdvisorInput}
              onAsk={askBootstrapAdvisor}
            />

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                disabled={wizardStep === 1 || bootstrapping}
                onClick={() => setWizardStep((current) => (current === 1 ? 1 : ((current - 1) as WizardStep)))}
              >
                上一步
              </Button>

              {wizardStep < 8 ? (
                <Button
                  disabled={bootstrapping || wizardStep >= maxUnlockedStep}
                  onClick={() => setWizardStep((current) => Math.min(maxUnlockedStep, current + 1) as WizardStep)}
                >
                  下一步
                </Button>
              ) : (
                <Button disabled={bootstrapping || !selectedVolumePlan || !selectedLogline || !selectedTitle} onClick={runBootstrap}>
                  {bootstrapping ? "进入中..." : "进入起稿"}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <Card className="bg-white/75">
              <p className="text-xs uppercase tracking-wide text-black/45">灵感摘要</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedGenre ? <SummaryPill>{selectedGenre.label}</SummaryPill> : null}
                {selectedSubGenre ? <SummaryPill>{selectedSubGenre.label}</SummaryPill> : null}
                {selectedTropeChoices.map((trope) => <SummaryPill key={trope.id}>{trope.label}</SummaryPill>)}
              </div>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-black/45">故事种子</p>
                  <p className="mt-1 leading-6">{selectedStorySeed ? `${selectedStorySeed.label}：${selectedStorySeed.setup}` : "还没选。"}</p>
                </div>
                <div>
                  <p className="text-black/45">主角模板</p>
                  <p className="mt-1 leading-6">
                    {selectedProtagonistTemplate
                      ? `${selectedProtagonistTemplate.roleIdentity} / 强项：${selectedProtagonistTemplate.strength} / 弱点：${selectedProtagonistTemplate.weakness}`
                      : "还没选。"}
                  </p>
                </div>
                <div>
                  <p className="text-black/45">标题</p>
                  <p className="mt-1 leading-6">{selectedTitle || "还没选。"}</p>
                </div>
                <div>
                  <p className="text-black/45">Logline</p>
                  <p className="mt-1 leading-6">{selectedLogline || "还没选。"}</p>
                </div>
              </div>
            </Card>

            <Card className="bg-white/75">
              <p className="text-xs uppercase tracking-wide text-black/45">为什么这样走</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-black/65">
                <p>1. 先选题材，再选母题，目的是先收窄气质和冲突类型。</p>
                <p>2. 故事种子必须是具体事件，这样后面的标题、logline 和卷一骨架才会更实。</p>
                <p>3. 主角模板先定强项和弱点，后面生成的内容才会更像“能写”的故事，而不是空文案。</p>
              </div>
            </Card>
          </div>
        </div>
      </Card>
    </main>
  );
}
