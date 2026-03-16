"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { ProjectNav } from "@/components/project-nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchProjectCollection } from "@/lib/story-resources";

type Props = { params: Promise<{ id: string }> };

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default function CharactersPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [characters, setCharacters] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadData(id: string, nextQuery = query) {
    setLoading(true);
    setError("");
    try {
      const [characterData, relationshipData] = await Promise.all([
        fetchProjectCollection<any[]>(id, "characters", {
          q: nextQuery || undefined,
          include: "stats,references",
        }),
        fetchProjectCollection<any[]>(id, "relationships", { include: "stats,references" }),
      ]);
      setCharacters(asArray(characterData));
      setRelationships(asArray(relationshipData));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "人物图谱加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      await loadData(id, "");
    })();
  }, [params]);

  const summary = useMemo(
    () => ({
      total: characters.length,
      active: characters.filter((item) => (item.stats?.total_hits ?? 0) > 0).length,
      hotspots: characters.reduce((acc, item) => acc + (item.stats?.total_hits ?? 0), 0),
      linked: relationships.length,
    }),
    [characters, relationships],
  );

  const hottestCharacter = useMemo(() => {
    return [...characters].sort((a, b) => (b.stats?.total_hits ?? 0) - (a.stats?.total_hits ?? 0))[0] ?? null;
  }, [characters]);

  const nodes = useMemo(
    () =>
      characters.map((item, index) => ({
        id: item.id,
        data: { label: `${item.name}${item.age ? ` (${item.age})` : ""}` },
        position: { x: (index % 4) * 220, y: Math.floor(index / 4) * 140 },
        style: { border: "1px solid #12263a", borderRadius: 10, padding: 8, background: "#fff" },
      })),
    [characters],
  );

  const edges = useMemo(
    () =>
      relationships.map((item) => ({
        id: item.id,
        source: item.from_character_id,
        target: item.to_character_id,
        label: `${item.relation_type} (${item.intensity})`,
        animated: Number(item.intensity) > 75,
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
          <h1 className="font-heading text-3xl">人物图谱</h1>
          <p className="mt-2 text-sm text-black/60">
            人物新增与设定编辑已合并到故事设定页，这里只看出场热度、章节引用和关系网络。
          </p>
        </div>
        <Link
          href={`/projects/${projectId}/bible#characters`}
          className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"
        >
          去故事设定编辑人物
        </Link>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
        <input
          className="rounded-md border border-black/15 px-3 py-2 text-sm"
          placeholder="搜索角色 / 状态 / 外貌锚点"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button variant="secondary" disabled={loading} onClick={() => void loadData(projectId, query)}>
          搜索
        </Button>
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => {
            setQuery("");
            void loadData(projectId, "");
          }}
        >
          清空
        </Button>
      </div>

      {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Card>
          <p className="text-sm text-black/60">角色总数</p>
          <p className="mt-2 text-2xl font-semibold">{summary.total}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">已出场角色</p>
          <p className="mt-2 text-2xl font-semibold">{summary.active}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">累计引用热度</p>
          <p className="mt-2 text-2xl font-semibold">{summary.hotspots}</p>
        </Card>
        <Card>
          <p className="text-sm text-black/60">关系条数</p>
          <p className="mt-2 text-2xl font-semibold">{summary.linked}</p>
        </Card>
      </div>

      <Card className="mt-4">
        <p className="text-sm font-semibold">当前热度最高角色</p>
        <p className="mt-2 text-lg">
          {hottestCharacter ? hottestCharacter.name : "暂无"}
        </p>
        <p className="mt-1 text-sm text-black/60">
          {hottestCharacter
            ? `累计 ${hottestCharacter.stats?.total_hits ?? 0} 次命中，最近出现在第 ${hottestCharacter.stats?.latest_chapter_no ?? "-"} 章`
            : "先生成章节后，这里会显示引用最频繁的人物。"}
        </p>
      </Card>

      <Card className="mt-6 h-[520px] p-0">
        <ReactFlow fitView nodes={nodes} edges={edges}>
          <Background />
          <Controls />
        </ReactFlow>
      </Card>

      <div className="mt-6 grid gap-4">
        {loading && <Card>人物图谱加载中...</Card>}
        {!loading && characters.length === 0 && (
          <Card>
            暂无人角色数据，先去
            {" "}
            <Link className="text-sky-700 underline-offset-2 hover:underline" href={`/projects/${projectId}/bible#characters`}>
              故事设定
            </Link>
            {" "}
            录入核心人物。
          </Card>
        )}
        {characters.map((item) => (
          <Card key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{item.name}</h2>
                <p className="mt-1 text-sm text-black/60">
                  {item.current_status || item.personality || "暂无一句话人物摘要"}
                </p>
              </div>
              <Link
                href={`/projects/${projectId}/bible#characters`}
                className="rounded-md border border-black/10 px-3 py-2 text-sm hover:bg-black/[0.03]"
              >
                编辑设定
              </Link>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <div className="grid gap-2 text-sm text-black/70">
                <p><span className="text-black/50">年龄：</span>{item.age ?? "-"}</p>
                <p><span className="text-black/50">外貌锚点：</span>{item.visual_anchors ?? "-"}</p>
                <p><span className="text-black/50">性格：</span>{item.personality ?? "-"}</p>
                <p><span className="text-black/50">当前状态：</span>{item.current_status ?? "-"}</p>
                <p><span className="text-black/50">动机：</span>{item.motivation ?? "-"}</p>
              </div>

              <div className="grid gap-3">
                <div className="rounded-lg bg-black/[0.03] p-3 text-sm">
                  <p>出场章节数: {item.stats?.total_chapters ?? 0}</p>
                  <p>累计命中数: {item.stats?.total_hits ?? 0}</p>
                  <p>最近章节: {item.stats?.latest_chapter_no ?? "-"}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold">章节引用</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {asArray(item.references).slice(0, 8).map((reference: any) => (
                      <span key={reference.id} className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
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
    </main>
  );
}
