"use client";

import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import { Card } from "@/components/ui/card";
import { ProjectNav } from "@/components/project-nav";
import { API_BASE } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export default function CharactersPage({ params }: Props) {
  const [projectId, setProjectId] = useState("");
  const [characters, setCharacters] = useState<any[]>([]);
  const [relationships, setRelationships] = useState<any[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void (async () => {
      const { id } = await params;
      setProjectId(id);
      setLoadError("");
      try {
        const [charRes, relRes] = await Promise.all([
          fetch(`${API_BASE}/projects/${id}/characters`),
          fetch(`${API_BASE}/projects/${id}/relationships`),
        ]);

        const [charData, relData] = await Promise.all([charRes.json(), relRes.json()]);
        setCharacters(asArray(charData));
        setRelationships(asArray(relData));

        if (!charRes.ok || !relRes.ok) {
          setLoadError("人物或关系数据加载失败，已使用空列表兜底显示。");
        }
      } catch {
        setCharacters([]);
        setRelationships([]);
        setLoadError("网络异常，人物关系图加载失败。");
      }
    })();
  }, [params]);

  const nodes = useMemo(
    () =>
      characters.map((c, idx) => ({
        id: c.id,
        data: { label: `${c.name}${c.age ? ` (${c.age})` : ""}` },
        position: { x: (idx % 4) * 220, y: Math.floor(idx / 4) * 140 },
        style: { border: "1px solid #12263a", borderRadius: 10, padding: 8, background: "#fff" },
      })),
    [characters],
  );

  const edges = useMemo(
    () =>
      relationships.map((r) => ({
        id: r.id,
        source: r.from_character_id,
        target: r.to_character_id,
        label: `${r.relation_type}(${r.intensity})`,
        animated: r.intensity > 75,
      })),
    [relationships],
  );

  if (!projectId) return <main className="p-8">加载中...</main>;

  return (
    <main className="mx-auto max-w-7xl p-8">
      <ProjectNav id={projectId} />
      <h1 className="font-heading text-3xl">人物关系图谱</h1>
      {loadError && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
      <Card className="mt-4 h-[680px] p-0">
        <ReactFlow fitView nodes={nodes} edges={edges}>
          <Background />
          <Controls />
        </ReactFlow>
      </Card>
    </main>
  );
}
