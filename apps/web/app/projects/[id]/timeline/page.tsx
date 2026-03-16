"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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

export default function TimelinePage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState({
    time_mark: "",
    event: "",
    chapter_no_ref: 1,
  });

  async function loadTimeline(id: string, nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchProjectCollection<any[]>(id, "timeline", {
        q: nextQuery || undefined,
        include: "stats,references",
      });
      setItems(asArray(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "时间线加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await loadTimeline(id, "");
    })();
  }, [params]);

  const summary = useMemo(
    () => ({
      total: items.length,
      referenced: items.filter((item) => (item.stats?.total_hits ?? 0) > 0).length,
      latest: items.reduce((acc, item) => Math.max(acc, Number(item.chapter_no_ref ?? 0)), 0),
    }),
    [items],
  );

  async function createEvent() {
    if (!draft.time_mark.trim() || !draft.event.trim()) {
      setError("时间标记和事件不能为空");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createProjectResource(projectId, "timeline", draft);
      setDraft({ time_mark: "", event: "", chapter_no_ref: 1 });
      setMessage("时间线事件已创建");
      await loadTimeline(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "创建时间线事件失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item: any) {
    setSaving(true);
    setError("");
    try {
      await updateProjectResource(projectId, "timeline", item.id, {
        time_mark: item.time_mark,
        event: item.event,
        chapter_no_ref: Number(item.chapter_no_ref),
      });
      setMessage(`已保存事件 ${item.time_mark}`);
      await loadTimeline(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "更新时间线失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(id: string) {
    setSaving(true);
    setError("");
    try {
      await deleteProjectResource(projectId, "timeline", id);
      setMessage("事件已删除");
      await loadTimeline(projectId);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "删除时间线事件失败");
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
          <h1 className="font-heading text-3xl">时间线</h1>
          <p className="mt-2 text-sm text-black/60">按章节回链世界事件，辅助一致性检查和 AI 检索。</p>
        </div>
        <div className="grid min-w-[320px] gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            className="rounded-md border border-black/15 px-3 py-2 text-sm"
            placeholder="搜索时间标记 / 事件"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="secondary" disabled={loading} onClick={() => void loadTimeline(projectId, query)}>
            搜索
          </Button>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setQuery("");
              void loadTimeline(projectId, "");
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
          <h2 className="text-lg font-semibold">新增事件</h2>
          <div className="mt-3 grid gap-3">
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="时间标记"
              value={draft.time_mark}
              onChange={(e) => setDraft((current) => ({ ...current, time_mark: e.target.value }))}
            />
            <textarea
              className="min-h-28 rounded-md border border-black/15 px-3 py-2 text-sm"
              placeholder="事件描述"
              value={draft.event}
              onChange={(e) => setDraft((current) => ({ ...current, event: e.target.value }))}
            />
            <input
              className="rounded-md border border-black/15 px-3 py-2 text-sm"
              type="number"
              min={1}
              value={draft.chapter_no_ref}
              onChange={(e) => setDraft((current) => ({ ...current, chapter_no_ref: Number(e.target.value || 1) }))}
            />
            <Button variant="secondary" disabled={saving} onClick={() => void createEvent()}>
              {saving ? "处理中..." : "创建事件"}
            </Button>
          </div>

          <div className="mt-6 grid gap-2 text-sm text-black/70">
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">总事件数: {summary.total}</div>
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">已被引用: {summary.referenced}</div>
            <div className="rounded-lg bg-black/[0.03] px-3 py-2">最新章节锚点: {summary.latest || "-"}</div>
          </div>
        </Card>

        <div className="grid gap-4">
          {loading && <Card>时间线加载中...</Card>}
          {!loading && items.length === 0 && <Card>暂无事件，可先把关键节点和世界事件录进去。</Card>}
          {items.map((item) => (
            <Card key={item.id}>
              <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
                <div className="grid gap-2">
                  <input
                    className="rounded-md border border-black/15 px-3 py-2 text-sm font-semibold"
                    value={item.time_mark ?? ""}
                    onChange={(e) => patchItem(item.id, { time_mark: e.target.value })}
                  />
                  <textarea
                    className="min-h-24 rounded-md border border-black/15 px-3 py-2 text-sm"
                    value={item.event ?? ""}
                    onChange={(e) => patchItem(item.id, { event: e.target.value })}
                  />
                  <input
                    className="rounded-md border border-black/15 px-3 py-2 text-sm"
                    type="number"
                    min={1}
                    value={item.chapter_no_ref ?? 1}
                    onChange={(e) => patchItem(item.id, { chapter_no_ref: Number(e.target.value || 1) })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={saving} onClick={() => void saveItem(item)}>
                      保存
                    </Button>
                    <Button variant="ghost" disabled={saving} onClick={() => void removeItem(item.id)}>
                      删除
                    </Button>
                    <Link
                      className="inline-flex items-center rounded-md bg-black/[0.03] px-3 py-2 text-sm hover:bg-black/[0.06]"
                      href={`/projects/${projectId}/chapters/${item.chapter_no_ref ?? 1}/workspace`}
                    >
                      查看章节
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                    <p>引用章节数: {item.stats?.total_chapters ?? 0}</p>
                    <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                    <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold">章节回链</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {asArray(item.references).slice(0, 6).map((reference: any) => (
                        <span key={reference.id} className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                          第 {reference.chapter?.chapter_no ?? "-"} 章 · {reference.state}
                        </span>
                      ))}
                      {asArray(item.references).length === 0 && <span className="text-xs text-black/50">暂无引用</span>}
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
