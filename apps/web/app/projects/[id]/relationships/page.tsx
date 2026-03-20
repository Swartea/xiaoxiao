"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createProjectResource,
  deleteProjectResource,
  fetchProjectCollection,
  updateProjectResource,
} from "@/lib/story-resources";

type Props = { params: Promise<{ id: string }> };

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

const RELATION_TYPE_OPTIONS = [
  { value: "ally", label: "ally" },
  { value: "friend", label: "friend" },
  { value: "mentor", label: "mentor" },
  { value: "family", label: "family" },
  { value: "love", label: "love" },
  { value: "rival", label: "rival" },
  { value: "enemy", label: "enemy" },
  { value: "unknown", label: "unknown" },
] as const;

export default function RelationshipsPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [characters, setCharacters] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    from_character_id: "",
    to_character_id: "",
    relation_type: "ally",
    intensity: 60,
    notes: "",
    last_updated_chapter_no: 1,
  });

  async function loadData(id: string) {
    setLoading(true);
    setError("");
    try {
      const [characterData, relationshipData] = await Promise.all([
        fetchProjectCollection<any[]>(id, "characters", { include: "stats" }),
        fetchProjectCollection<any[]>(id, "relationships", { include: "stats,references" }),
      ]);
      const nextCharacters = asArray(characterData);
      const nextRelationships = asArray(relationshipData);
      setCharacters(nextCharacters);
      setRelationships(nextRelationships);
      setDraft((current) => ({
        ...current,
        from_character_id: current.from_character_id || nextCharacters[0]?.id || "",
        to_character_id: current.to_character_id || nextCharacters[1]?.id || nextCharacters[0]?.id || "",
      }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "关系图谱加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await loadData(id);
    })();
  }, [params]);

  function patchItem(id: string, patch: Record<string, unknown>) {
    setRelationships((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function createRelationship() {
    if (!draft.from_character_id || !draft.to_character_id) {
      setError("请选择双方角色");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createProjectResource(projectId, "relationships", {
        ...draft,
        intensity: Number(draft.intensity),
        last_updated_chapter_no: Number(draft.last_updated_chapter_no),
      });
      setMessage("关系已创建");
      await loadData(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创建关系失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveRelationship(item: any) {
    setSaving(true);
    setError("");
    try {
      await updateProjectResource(projectId, "relationships", item.id, {
        from_character_id: item.from_character_id,
        to_character_id: item.to_character_id,
        relation_type: item.relation_type,
        intensity: Number(item.intensity),
        notes: item.notes,
        last_updated_chapter_no: Number(item.last_updated_chapter_no || 1),
      });
      setMessage("关系已保存");
      await loadData(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新关系失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeRelationship(id: string) {
    setSaving(true);
    setError("");
    try {
      await deleteProjectResource(projectId, "relationships", id);
      setMessage("关系已删除");
      await loadData(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "删除关系失败");
    } finally {
      setSaving(false);
    }
  }

  const nodes = useMemo(
    () =>
      characters.map((item, index) => ({
        id: item.id,
        data: { label: item.name },
        position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
        style: { border: "1px solid #111827", borderRadius: 12, padding: 10, background: "#fffef7" },
      })),
    [characters],
  );

  const edges = useMemo(
    () =>
      relationships.map((item) => ({
        id: item.id,
        source: item.from_character_id,
        target: item.to_character_id,
        label: `${item.relation_type} · ${item.intensity}`,
        animated: Number(item.intensity) >= 75,
      })),
    [relationships],
  );

  if (!projectId) {
    return <main className="p-8">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl">关系图谱</h1>
          <p className="mt-2 text-sm text-black/60">用 React Flow 展示角色关系，并保留章节引用和热度统计。</p>
        </div>
      </div>

      {(error || message) && (
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
          {error || message}
        </div>
      )}

      <Card className="mt-6 h-[520px] p-0">
        <ReactFlow fitView nodes={nodes} edges={edges}>
          <Background />
          <Controls />
        </ReactFlow>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <h2 className="text-lg font-semibold">新增关系</h2>
          <div className="mt-3 grid gap-3">
            <select
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              value={draft.from_character_id}
              onChange={(e) => setDraft((current) => ({ ...current, from_character_id: e.target.value }))}
            >
              {characters.map((item) => (
                <option key={`from-${item.id}`} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              value={draft.to_character_id}
              onChange={(e) => setDraft((current) => ({ ...current, to_character_id: e.target.value }))}
            >
              {characters.map((item) => (
                <option key={`to-${item.id}`} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              value={draft.relation_type}
              onChange={(e) => setDraft((current) => ({ ...current, relation_type: e.target.value }))}
            >
              {RELATION_TYPE_OPTIONS.map((option) => (
                <option key={`draft-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              type="number"
              min={0}
              max={100}
              value={draft.intensity}
              onChange={(e) => setDraft((current) => ({ ...current, intensity: Number(e.target.value || 0) }))}
            />
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              type="number"
              min={1}
              value={draft.last_updated_chapter_no}
              onChange={(e) =>
                setDraft((current) => ({ ...current, last_updated_chapter_no: Number(e.target.value || 1) }))
              }
            />
            <textarea
              className="min-h-24 rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="备注"
              value={draft.notes}
              onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
            />
            <Button variant="secondary" disabled={saving || characters.length < 2} onClick={() => void createRelationship()}>
              {saving ? "处理中..." : "创建关系"}
            </Button>
          </div>
        </Card>

        <div className="grid gap-4">
          {loading && <Card>关系加载中...</Card>}
          {!loading && relationships.length === 0 && <Card>暂无关系，先把主要角色对建立起来。</Card>}
          {relationships.map((item) => (
            <Card key={item.id}>
              <div className="grid gap-3 md:grid-cols-[1.1fr_1fr]">
                <div className="grid gap-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <select
                      className="rounded-md border border-black/15 px-3 py-2 text-sm"
                      value={item.from_character_id ?? ""}
                      onChange={(e) => patchItem(item.id, { from_character_id: e.target.value })}
                    >
                      {characters.map((character) => (
                        <option key={`${item.id}-from-${character.id}`} value={character.id}>
                          {character.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-md border border-black/15 px-3 py-2 text-sm"
                      value={item.to_character_id ?? ""}
                      onChange={(e) => patchItem(item.id, { to_character_id: e.target.value })}
                    >
                      {characters.map((character) => (
                        <option key={`${item.id}-to-${character.id}`} value={character.id}>
                          {character.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <select
                    className="rounded-md border border-black/15 px-3 py-2 text-sm"
                    value={item.relation_type ?? "unknown"}
                    onChange={(e) => patchItem(item.id, { relation_type: e.target.value })}
                  >
                    {RELATION_TYPE_OPTIONS.map((option) => (
                      <option key={`${item.id}-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-md border border-black/15 px-3 py-2 text-sm"
                    type="number"
                    min={0}
                    max={100}
                    value={item.intensity ?? 0}
                    onChange={(e) => patchItem(item.id, { intensity: Number(e.target.value || 0) })}
                  />
                  <textarea
                    className="min-h-20 rounded-md border border-black/15 px-3 py-2 text-sm"
                    value={item.notes ?? ""}
                    onChange={(e) => patchItem(item.id, { notes: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={saving} onClick={() => void saveRelationship(item)}>
                      保存
                    </Button>
                    <Button variant="ghost" disabled={saving} onClick={() => void removeRelationship(item.id)}>
                      删除
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                    <p>引用章节数: {item.stats?.total_chapters ?? 0}</p>
                    <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                    <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                    <p>强度: {item.intensity ?? 0}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {asArray(item.references).slice(0, 6).map((reference: any) => (
                      <span key={reference.id} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                        第 {reference.chapter?.chapter_no ?? "-"} 章 · {reference.state}
                      </span>
                    ))}
                    {asArray(item.references).length === 0 && <span className="text-xs text-black/50">暂无引用</span>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
