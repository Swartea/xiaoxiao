"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

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

export default function BiblePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [bible, setBible] = useState<BibleData>(emptyBible);
  const [jsonText, setJsonText] = useState("{}");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [quickNames, setQuickNames] = useState("");
  const [errorText, setErrorText] = useState("");
  const [saving, setSaving] = useState(false);

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
    })();
  }, [params]);

  const hasRelationships = useMemo(() => bible.relationships.length > 0, [bible.relationships.length]);

  function syncBible(next: BibleData) {
    setBible(next);
    setJsonText(JSON.stringify(next, null, 2));
  }

  async function saveWithPayload(payload: BibleData) {
    setSaving(true);
    setErrorText("");
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
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存失败，请稍后重试");
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
          motivation: "",
          secrets: "",
          abilities: {},
          catchphrases: [],
        },
      ],
    });
  }

  function removeCharacter(index: number) {
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
      <h1 className="font-heading text-3xl">故事设定</h1>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant={mode === "form" ? "default" : "ghost"} onClick={() => setMode("form")}>可视化编辑</Button>
        <Button variant={mode === "json" ? "default" : "ghost"} onClick={() => setMode("json")}>JSON 高级模式</Button>
        <Button onClick={saveStructured} disabled={saving}>
          {saving ? "保存中..." : "保存设定"}
        </Button>
      </div>

      {errorText && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorText}</p>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          {mode === "form" ? (
            <div className="space-y-6">
              <section>
                <h2 className="font-medium">人物表</h2>
                <p className="mt-1 text-xs text-black/60">快速输入人物名（用逗号、顿号或换行分隔）</p>
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded border border-black/20 px-2 py-1 text-sm"
                    placeholder="例：小帅，小美，老周"
                    value={quickNames}
                    onChange={(e) => setQuickNames(e.target.value)}
                  />
                  <Button variant="secondary" onClick={addCharactersFromQuickInput}>批量添加</Button>
                </div>

                <div className="mt-3 space-y-3">
                  {bible.characters.map((char, idx) => (
                    <div key={`char-${idx}`} className="rounded border border-black/10 p-2">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="人物名"
                          value={char.name ?? ""}
                          onChange={(e) => updateCharacter(idx, { name: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="年龄"
                          value={char.age ?? ""}
                          onChange={(e) => updateCharacter(idx, { age: e.target.value ? Number(e.target.value) : null })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="性格"
                          value={char.personality ?? ""}
                          onChange={(e) => updateCharacter(idx, { personality: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="动机"
                          value={char.motivation ?? ""}
                          onChange={(e) => updateCharacter(idx, { motivation: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm md:col-span-2"
                          placeholder="别名（逗号分隔）"
                          value={Array.isArray(char.aliases) ? char.aliases.join("，") : ""}
                          onChange={(e) => updateCharacter(idx, { aliases: splitList(e.target.value) })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm md:col-span-2"
                          placeholder="口头禅（逗号分隔）"
                          value={Array.isArray(char.catchphrases) ? char.catchphrases.join("，") : ""}
                          onChange={(e) => updateCharacter(idx, { catchphrases: splitList(e.target.value) })}
                        />
                      </div>
                      <div className="mt-2 text-right">
                        <Button variant="ghost" onClick={() => removeCharacter(idx)}>删除人物</Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2">
                  <Button variant="secondary" onClick={addCharacter}>新增人物</Button>
                </div>
              </section>

              <section>
                <h2 className="font-medium">设定库（地点/组织/道具/能力/规则）</h2>
                <div className="mt-3 space-y-3">
                  {bible.entities.map((entity, idx) => (
                    <div key={`entity-${idx}`} className="rounded border border-black/10 p-2">
                      <div className="grid gap-2 md:grid-cols-2">
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="类型：location/org/item/ability/rule"
                          value={entity.type ?? ""}
                          onChange={(e) => updateEntity(idx, { type: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="名称"
                          value={entity.name ?? ""}
                          onChange={(e) => updateEntity(idx, { name: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm md:col-span-2"
                          placeholder="描述"
                          value={entity.description ?? ""}
                          onChange={(e) => updateEntity(idx, { description: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="约束"
                          value={entity.constraints ?? ""}
                          onChange={(e) => updateEntity(idx, { constraints: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="代价"
                          value={entity.cost ?? ""}
                          onChange={(e) => updateEntity(idx, { cost: e.target.value })}
                        />
                      </div>
                      <div className="mt-2 text-right">
                        <Button variant="ghost" onClick={() => removeEntity(idx)}>删除设定</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button variant="secondary" onClick={addEntity}>新增设定</Button>
                </div>
              </section>

              <section>
                <h2 className="font-medium">术语表</h2>
                <div className="mt-3 space-y-3">
                  {bible.glossary.map((term, idx) => (
                    <div key={`term-${idx}`} className="rounded border border-black/10 p-2">
                      <div className="grid gap-2 md:grid-cols-3">
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="术语"
                          value={term.term ?? ""}
                          onChange={(e) => updateGlossary(idx, { term: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="规范写法"
                          value={term.canonical_form ?? ""}
                          onChange={(e) => updateGlossary(idx, { canonical_form: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="备注"
                          value={term.notes ?? ""}
                          onChange={(e) => updateGlossary(idx, { notes: e.target.value })}
                        />
                      </div>
                      <div className="mt-2 text-right">
                        <Button variant="ghost" onClick={() => removeGlossary(idx)}>删除术语</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button variant="secondary" onClick={addGlossary}>新增术语</Button>
                </div>
              </section>

              <section>
                <h2 className="font-medium">时间线</h2>
                <div className="mt-3 space-y-3">
                  {bible.timeline.map((item, idx) => (
                    <div key={`timeline-${idx}`} className="rounded border border-black/10 p-2">
                      <div className="grid gap-2 md:grid-cols-3">
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm"
                          placeholder="时间标记"
                          value={item.time_mark ?? ""}
                          onChange={(e) => updateTimeline(idx, { time_mark: e.target.value })}
                        />
                        <input
                          className="rounded border border-black/20 px-2 py-1 text-sm md:col-span-2"
                          placeholder="事件"
                          value={item.event ?? ""}
                          onChange={(e) => updateTimeline(idx, { event: e.target.value })}
                        />
                      </div>
                      <div className="mt-2 text-right">
                        <Button variant="ghost" onClick={() => removeTimeline(idx)}>删除事件</Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2">
                  <Button variant="secondary" onClick={addTimeline}>新增时间线事件</Button>
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
