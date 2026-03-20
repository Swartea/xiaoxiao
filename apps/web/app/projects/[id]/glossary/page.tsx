"use client";

import { useEffect, useMemo, useState } from "react";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  createProjectResource,
  deleteProjectResource,
  displayReferenceName,
  fetchProjectCollection,
  updateProjectResource,
} from "@/lib/story-resources";

type Props = { params: Promise<{ id: string }> };

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default function GlossaryPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    term: "",
    canonical_form: "",
    notes: "",
  });

  async function loadGlossary(id: string, nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchProjectCollection<any[]>(id, "glossary", {
        q: nextQuery || undefined,
        include: "stats,references",
      });
      setItems(asArray(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "术语库加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await loadGlossary(id, "");
    })();
  }, [params]);

  const stats = useMemo(
    () => ({
      terms: items.length,
      used: items.filter((item) => (item.stats?.total_hits ?? 0) > 0).length,
      conflicts: items.reduce((acc, item) => acc + (item.stats?.canonical_conflict_count ?? 0), 0),
    }),
    [items],
  );

  async function createTerm() {
    if (!projectId || !draft.term.trim() || !draft.canonical_form.trim()) {
      setError("术语和规范写法不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createProjectResource(projectId, "glossary", draft);
      setDraft({ term: "", canonical_form: "", notes: "" });
      setMessage("术语已创建");
      await loadGlossary(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创建术语失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item: any) {
    setSaving(true);
    setError("");
    try {
      await updateProjectResource(projectId, "glossary", item.id, {
        term: item.term,
        canonical_form: item.canonical_form,
        notes: item.notes,
      });
      setMessage(`已保存术语 ${item.term}`);
      await loadGlossary(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新术语失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    setSaving(true);
    setError("");
    try {
      await deleteProjectResource(projectId, "glossary", id);
      setMessage("术语已删除");
      await loadGlossary(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "删除术语失败");
    } finally {
      setSaving(false);
    }
  }

  function patchItem(id: string, patch: Record<string, unknown>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  if (!projectId) {
    return <main className="p-8">加载中...</main>;
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl">术语库</h1>
          <p className="mt-2 text-sm text-black/60">统一规范写法，并追踪术语在章节中的引用热度。</p>
        </div>
        <div className="grid min-w-[320px] gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            className="rounded-md border border-black/15 px-3 py-2 text-sm"
            placeholder="搜索术语 / 规范写法 / 备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="secondary" disabled={loading} onClick={() => void loadGlossary(projectId, query)}>
            搜索
          </Button>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setQuery("");
              void loadGlossary(projectId, "");
            }}
          >
            清空
          </Button>
        </div>
      </div>

      {(error || message) && (
        <div className={`mt-4 rounded-md px-3 py-2 text-sm ${error ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
          {error || message}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <h2 className="text-lg font-semibold">新增术语</h2>
          <div className="mt-3 grid gap-3">
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="术语"
              value={draft.term}
              onChange={(e) => setDraft((current) => ({ ...current, term: e.target.value }))}
            />
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="规范写法"
              value={draft.canonical_form}
              onChange={(e) => setDraft((current) => ({ ...current, canonical_form: e.target.value }))}
            />
            <textarea
              className="min-h-28 rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="备注"
              value={draft.notes}
              onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
            />
            <Button variant="secondary" disabled={saving} onClick={() => void createTerm()}>
              {saving ? "处理中..." : "创建术语"}
            </Button>
          </div>
          <div className="mt-6 grid gap-2 text-sm text-black/70">
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">术语总数: {stats.terms}</div>
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">已被章节引用: {stats.used}</div>
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">规范写法冲突: {stats.conflicts}</div>
          </div>
        </Card>

        <div className="grid gap-4">
          {loading && <Card>术语库加载中...</Card>}
          {!loading && items.length === 0 && <Card>暂无术语，先创建几个高频术语试试。</Card>}
          {items.map((item) => (
            <Card key={item.id}>
              <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
                <div className="grid gap-2">
                  <input
                    className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold"
                    value={item.term ?? ""}
                    onChange={(e) => patchItem(item.id, { term: e.target.value })}
                  />
                  <input
                    className="rounded-md border border-black/15 px-3 py-2 text-sm"
                    value={item.canonical_form ?? ""}
                    onChange={(e) => patchItem(item.id, { canonical_form: e.target.value })}
                  />
                  <textarea
                    className="min-h-24 rounded-md border border-black/15 px-3 py-2 text-sm"
                    value={item.notes ?? ""}
                    onChange={(e) => patchItem(item.id, { notes: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={saving} onClick={() => void saveItem(item)}>
                      保存
                    </Button>
                    <Button variant="ghost" disabled={saving} onClick={() => void removeItem(item.id)}>
                      删除
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                    <p>使用章节数: {item.stats?.total_chapters ?? 0}</p>
                    <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                    <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                    <p>规范冲突: {item.stats?.canonical_conflict_count ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">引用章节</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {asArray(item.references).slice(0, 6).map((reference: any) => (
                        <span key={reference.id} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                          第 {reference.chapter?.chapter_no ?? "-"} 章 · {reference.state}
                        </span>
                      ))}
                      {asArray(item.references).length === 0 && <span className="text-xs text-black/50">暂无引用</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">热度预览</p>
                    <div className="mt-2 space-y-2">
                      {asArray(item.references).slice(0, 3).map((reference: any) => (
                        <div key={`${item.id}-${reference.id}`} className="rounded-md border border-black/10 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span>{displayReferenceName(reference)}</span>
                            <span>{reference.stats?.total_hits ?? reference.occurrence_count ?? 0} hits</span>
                          </div>
                        </div>
                      ))}
                    </div>
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
