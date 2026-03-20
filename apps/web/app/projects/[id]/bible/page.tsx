"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";
import { CharacterEditorCard } from "@/components/character-editor-card";

type Props = { params: Promise<{ id: string }> };

type BibleData = {
  characters: any[];
  relationships: any[];
  entities: any[];
  glossary: any[];
  timeline: any[];
};

const emptyBible: BibleData = {
  characters: [],
  relationships: [],
  entities: [],
  glossary: [],
  timeline: [],
};

function normalizeBible(data: any): BibleData {
  return {
    characters: Array.isArray(data?.characters) ? data.characters : [],
    relationships: Array.isArray(data?.relationships) ? data.relationships : [],
    entities: Array.isArray(data?.entities) ? data.entities : [],
    glossary: Array.isArray(data?.glossary) ? data.glossary : [],
    timeline: Array.isArray(data?.timeline) ? data.timeline : [],
  };
}

function splitList(input: string): string[] {
  return input
    .split(/[，,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hashBible(data: BibleData): string {
  return JSON.stringify(data);
}

export default function BiblePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [bible, setBible] = useState<BibleData>(emptyBible);
  const [jsonText, setJsonText] = useState("{}");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [quickNames, setQuickNames] = useState("");
  const [characterWeights, setCharacterWeights] = useState<Record<number, "lead" | "side">>({});
  const [errorText, setErrorText] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastSavedHashRef = useRef("");

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      const res = await fetch(`${API_BASE}/projects/${id}/bible`);
      const data = await res.json();
      const normalized = normalizeBible(data.structured);
      setBible(normalized);
      setMarkdown(data.markdown ?? "");
      setJsonText(JSON.stringify(normalized, null, 2));
      lastSavedHashRef.current = hashBible(normalized);
      setSaveState("saved");
      setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      setHydrated(true);
    })();
  }, [params]);

  const hasRelationships = useMemo(() => bible.relationships.length > 0, [bible.relationships.length]);
  const glossaryConflictKeys = useMemo(() => {
    const canonicalSetByTerm = new Map<string, Set<string>>();
    for (const item of bible.glossary) {
      const term = String(item?.term ?? "").trim().toLowerCase();
      const canonical = String(item?.canonical_form ?? "").trim().toLowerCase();
      if (!term || !canonical) continue;
      if (!canonicalSetByTerm.has(term)) {
        canonicalSetByTerm.set(term, new Set());
      }
      canonicalSetByTerm.get(term)!.add(canonical);
    }

    const conflicts = new Set<string>();
    for (const [term, canonicalSet] of canonicalSetByTerm.entries()) {
      if (canonicalSet.size > 1) {
        conflicts.add(term);
      }
    }
    return conflicts;
  }, [bible.glossary]);

  useEffect(() => {
    if (!hydrated || !projectId || mode !== "form") return;
    const nextHash = hashBible(bible);
    if (nextHash === lastSavedHashRef.current) return;

    const timer = setTimeout(() => {
      void saveWithPayload(bible, { silent: true });
    }, 900);

    return () => clearTimeout(timer);
  }, [bible, hydrated, mode, projectId]);

  function syncBible(next: BibleData) {
    setBible(next);
    setJsonText(JSON.stringify(next, null, 2));
    if (hashBible(next) !== lastSavedHashRef.current) {
      setSaveState("idle");
    }
  }

  function getCharacterWeight(index: number): "lead" | "side" {
    return characterWeights[index] ?? (index === 0 ? "lead" : "side");
  }

  function setCharacterWeight(index: number, weight: "lead" | "side") {
    setCharacterWeights((prev) => ({
      ...prev,
      [index]: weight,
    }));
  }

  async function saveWithPayload(payload: BibleData, options?: { silent?: boolean }) {
    if (saving) return;
    setSaving(true);
    setSaveState("saving");
    if (!options?.silent) {
      setErrorText("");
    }
    try {
      const res = await fetch(`${API_BASE}/projects/${projectId}/bible`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`保存失败：${res.status}`);
      }

      const data = await res.json();
      const normalized = normalizeBible(data.structured);
      setMarkdown(data.markdown ?? "");
      syncBible(normalized);
      lastSavedHashRef.current = hashBible(normalized);
      setSaveState("saved");
      setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存失败，请稍后重试");
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }

  async function saveStructured() {
    if (mode === "form") {
      await saveWithPayload(bible);
      return;
    }

    try {
      const parsed = normalizeBible(JSON.parse(jsonText));
      await saveWithPayload(parsed);
    } catch (error) {
      setErrorText(
        `JSON 格式错误：${error instanceof Error ? error.message : "请检查逗号、引号和括号。字符串要加双引号"}`,
      );
    }
  }

  function addCharactersFromQuickInput() {
    const names = splitList(quickNames);
    if (names.length === 0) return;

    const appended = names.map((name) => ({
      name,
      aliases: [],
      age: null,
      appearance: "",
      personality: "",
      visual_anchors: "",
      personality_tags: "",
      current_status: "",
      motivation: "",
      secrets: "",
      abilities: {},
      catchphrases: [],
    }));

    syncBible({
      ...bible,
      characters: [...bible.characters, ...appended],
    });
    setQuickNames("");
  }

  function updateCharacter(index: number, patch: Record<string, unknown>) {
    const next = [...bible.characters];
    next[index] = { ...next[index], ...patch };
    syncBible({ ...bible, characters: next });
  }

  function addCharacter() {
    syncBible({
      ...bible,
      characters: [
        ...bible.characters,
        {
          name: "",
          aliases: [],
          age: null,
          appearance: "",
          personality: "",
          visual_anchors: "",
          personality_tags: "",
          current_status: "",
          motivation: "",
          secrets: "",
          abilities: {},
          catchphrases: [],
        },
      ],
    });
  }

  function removeCharacter(index: number) {
    setCharacterWeights((prev) => {
      const next: Record<number, "lead" | "side"> = {};
      for (const [rawKey, value] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (key < index) next[key] = value;
        if (key > index) next[key - 1] = value;
      }
      return next;
    });

    syncBible({
      ...bible,
      characters: bible.characters.filter((_, i) => i !== index),
    });
  }

  function updateEntity(index: number, patch: Record<string, unknown>) {
    const next = [...bible.entities];
    next[index] = { ...next[index], ...patch };
    syncBible({ ...bible, entities: next });
  }

  function addEntity() {
    syncBible({
      ...bible,
      entities: [
        ...bible.entities,
        {
          type: "rule",
          name: "",
          description: "",
          constraints: "",
          cost: "",
          first_appearance_chapter_no: null,
        },
      ],
    });
  }

  function removeEntity(index: number) {
    syncBible({
      ...bible,
      entities: bible.entities.filter((_, i) => i !== index),
    });
  }

  function updateGlossary(index: number, patch: Record<string, unknown>) {
    const next = [...bible.glossary];
    next[index] = { ...next[index], ...patch };
    syncBible({ ...bible, glossary: next });
  }

  function addGlossary() {
    syncBible({
      ...bible,
      glossary: [...bible.glossary, { term: "", canonical_form: "", notes: "" }],
    });
  }

  function removeGlossary(index: number) {
    syncBible({
      ...bible,
      glossary: bible.glossary.filter((_, i) => i !== index),
    });
  }

  function updateTimeline(index: number, patch: Record<string, unknown>) {
    const next = [...bible.timeline];
    next[index] = { ...next[index], ...patch };
    syncBible({ ...bible, timeline: next });
  }

  function addTimeline() {
    syncBible({
      ...bible,
      timeline: [...bible.timeline, { time_mark: "", event: "", chapter_no_ref: 1, involved_entities: {} }],
    });
  }

  function removeTimeline(index: number) {
    syncBible({
      ...bible,
      timeline: bible.timeline.filter((_, i) => i !== index),
    });
  }

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">人物与故事设定</h1>

      <Card className="mt-4 border-slate-200 bg-slate-50/80">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">人物编辑已统一收口到这里</p>
            <p className="mt-1 text-xs text-slate-600">
              人物新增、设定修改都在当前页面完成；人物图谱页只保留引用热度、章节痕迹和关系网络，减少双入口重复维护。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              href={`/projects/${projectId}/characters`}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100"
            >
              查看人物图谱
            </Link>
            <Link
              href={`/projects/${projectId}/relationships`}
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:bg-slate-100"
            >
              查看关系图谱
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-4">
          <div className="rounded-lg bg-white px-3 py-2">人物数: {bible.characters.length}</div>
          <div className="rounded-lg bg-white px-3 py-2">关系数: {bible.relationships.length}</div>
          <div className="rounded-lg bg-white px-3 py-2">术语数: {bible.glossary.length}</div>
          <div className="rounded-lg bg-white px-3 py-2">时间线节点: {bible.timeline.length}</div>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant={mode === "form" ? "default" : "ghost"} onClick={() => setMode("form")}>可视化编辑</Button>
        <Button variant={mode === "json" ? "default" : "ghost"} onClick={() => setMode("json")}>JSON 高级模式</Button>
        <Button onClick={saveStructured} disabled={saving}>
          {saving ? "保存中..." : "立即保存"}
        </Button>
      </div>

      {mode === "form" && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {saveState === "saving" && "自动保存中..."}
          {saveState === "saved" && `已保存${lastSavedAt ? `（${lastSavedAt}）` : ""}`}
          {saveState === "idle" && "有未保存修改，系统将在 1 秒内自动保存"}
          {saveState === "error" && "自动保存失败，请检查网络后点击“立即保存”重试"}
        </div>
      )}

      {errorText && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          {mode === "form" ? (
            <div className="space-y-6">
              <section id="characters">
                <h2 className="font-medium">人物表</h2>
                <p className="mt-1 text-xs text-black/60">
                  人物资料统一在这里维护；引用热度和出场关系可去
                  {" "}
                  <Link className="text-sky-700 underline-offset-2 hover:underline" href={`/projects/${projectId}/characters`}>
                    人物图谱
                  </Link>
                  {" "}
                  查看。
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded border border-black/20 px-2 py-1 text-sm"
                    placeholder="例：小帅，小美，老周"
                    value={quickNames}
                    onChange={(e) => setQuickNames(e.target.value)}
                  />
                  {bible.characters.length === 0 ? (
                    <Button variant="secondary" onClick={addCharactersFromQuickInput}>批量添加</Button>
                  ) : (
                    <Button variant="ghost" onClick={addCharactersFromQuickInput}>＋</Button>
                  )}
                </div>

                <div className="mt-3 space-y-3">
                  {bible.characters.map((char, idx) => (
                    <CharacterEditorCard
                      key={`char-${idx}`}
                      index={idx}
                      character={char}
                      weight={getCharacterWeight(idx)}
                      onWeightChange={(weight) => setCharacterWeight(idx, weight)}
                      onPatch={(patch) => updateCharacter(idx, patch)}
                      onDelete={() => removeCharacter(idx)}
                      splitList={splitList}
                    />
                  ))}
                </div>

                <div className="mt-2">
                  <Button variant="secondary" onClick={addCharacter}>新增人物</Button>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">设定库（地点/组织/道具/能力/规则）</h2>
                  <Button
                    variant="ghost"
                    className="h-8 border border-dashed border-slate-300 text-slate-600 hover:border-slate-500"
                    onClick={addEntity}
                  >
                    +
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  {bible.entities.map((entity, idx) => (
                    <div key={`entity-${idx}`} className="group relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <button
                        type="button"
                        className="absolute right-2 top-2 hidden h-6 w-6 rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500 group-hover:block"
                        onClick={() => removeEntity(idx)}
                      >
                        ×
                      </button>
                      <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                        <input
                          className="rounded-md border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                          placeholder="设定名称（核心）"
                          value={entity.name ?? ""}
                          onChange={(e) => updateEntity(idx, { name: e.target.value })}
                        />
                        <input
                          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                          placeholder="类型：rule/item/org..."
                          value={entity.type ?? ""}
                          onChange={(e) => updateEntity(idx, { type: e.target.value })}
                        />
                        <input
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none md:col-span-2"
                          placeholder="描述"
                          value={entity.description ?? ""}
                          onChange={(e) => updateEntity(idx, { description: e.target.value })}
                        />
                        <input
                          className="rounded-md border border-red-100 bg-red-50/70 px-2 py-1.5 text-sm text-slate-700 placeholder:text-red-300 focus:border-red-300 focus:outline-none"
                          placeholder="约束（冲突点）"
                          value={entity.constraints ?? ""}
                          onChange={(e) => updateEntity(idx, { constraints: e.target.value })}
                        />
                        <input
                          className="rounded-md border border-sky-100 bg-sky-50/70 px-2 py-1.5 text-sm text-slate-700 placeholder:text-sky-300 focus:border-sky-300 focus:outline-none"
                          placeholder="代价（冲突点）"
                          value={entity.cost ?? ""}
                          onChange={(e) => updateEntity(idx, { cost: e.target.value })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">术语表</h2>
                  <Button
                    variant="ghost"
                    className="h-8 border border-dashed border-slate-300 text-slate-600 hover:border-slate-500"
                    onClick={addGlossary}
                  >
                    +
                  </Button>
                </div>
                <div className="mt-3 space-y-3">
                  {bible.glossary.map((term, idx) => {
                    const conflict = glossaryConflictKeys.has(String(term?.term ?? "").trim().toLowerCase());
                    return (
                      <div
                        key={`term-${idx}`}
                        className={`group relative rounded-lg border p-3 ${
                          conflict ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-white"
                        }`}
                      >
                        <button
                          type="button"
                          className="absolute right-2 top-2 hidden h-6 w-6 rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500 group-hover:block"
                          onClick={() => removeGlossary(idx)}
                        >
                          ×
                        </button>
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                            placeholder="术语（核心）"
                            value={term.term ?? ""}
                            onChange={(e) => updateGlossary(idx, { term: e.target.value })}
                          />
                          <input
                            className="rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                            placeholder="规范写法"
                            value={term.canonical_form ?? ""}
                            onChange={(e) => updateGlossary(idx, { canonical_form: e.target.value })}
                          />
                        </div>
                        <input
                          className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                          placeholder="备注"
                          value={term.notes ?? ""}
                          onChange={(e) => updateGlossary(idx, { notes: e.target.value })}
                        />
                        {conflict && <p className="mt-2 text-xs text-red-600">冲突：同一术语存在多个规范写法，请统一。</p>}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">时间线</h2>
                  <Button
                    variant="ghost"
                    className="h-8 border border-dashed border-slate-300 text-slate-600 hover:border-slate-500"
                    onClick={addTimeline}
                  >
                    +
                  </Button>
                </div>
                <div className="relative mt-3 pl-5">
                  <div className="pointer-events-none absolute bottom-2 left-[8px] top-2 w-px bg-slate-200" />
                  <div className="space-y-3">
                    {bible.timeline.map((item, idx) => (
                      <div key={`timeline-${idx}`} className="group relative">
                        <span className="absolute -left-[13px] top-6 h-2.5 w-2.5 rounded-full bg-slate-400 ring-2 ring-white" />
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <button
                            type="button"
                            className="absolute right-2 top-2 hidden h-6 w-6 rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500 group-hover:block"
                            onClick={() => removeTimeline(idx)}
                          >
                            ×
                          </button>
                          <div className="grid gap-2 md:grid-cols-[180px_1fr_120px]">
                            <input
                              className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                              placeholder="时间标记"
                              value={item.time_mark ?? ""}
                              onChange={(e) => updateTimeline(idx, { time_mark: e.target.value })}
                            />
                            <input
                              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                              placeholder="事件"
                              value={item.event ?? ""}
                              onChange={(e) => updateTimeline(idx, { event: e.target.value })}
                            />
                            <input
                              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                              placeholder="章节号"
                              value={item.chapter_no_ref ?? 1}
                              onChange={(e) =>
                                updateTimeline(idx, { chapter_no_ref: e.target.value ? Number(e.target.value) : 1 })
                              }
                            />
                          </div>
                          <div className="mt-2 text-right">
                            <a
                              className="text-xs text-sky-600 hover:underline"
                              href={`/projects/${projectId}/chapters/${item.chapter_no_ref ?? 1}/workspace`}
                            >
                              跳到第 {item.chapter_no_ref ?? 1} 章工作台
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded bg-yellow-50 p-3 text-xs text-yellow-800">
                关系网当前有 {bible.relationships.length} 条。为避免误删，人物关系建议在 JSON 高级模式下编辑。
                {hasRelationships ? "（已有关系数据已自动保留）" : ""}
              </section>
            </div>
          ) : (
            <div>
              <h2 className="font-medium">JSON 高级模式</h2>
              <p className="mt-1 text-xs text-black/60">
                请使用标准 JSON：字符串必须加双引号，例如 {"{\"characters\":[{\"name\":\"小帅\"}]}"}。
              </p>
              <textarea
                className="mt-3 h-[640px] w-full rounded-md border border-black/15 p-3 font-mono text-sm"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
            </div>
          )}
        </Card>

        <Card>
          <h2 className="font-medium">派生 Markdown 预览</h2>
          <pre className="mt-3 h-[720px] overflow-auto whitespace-pre-wrap text-sm">{markdown}</pre>
        </Card>
      </div>
    </main>
  );
}
