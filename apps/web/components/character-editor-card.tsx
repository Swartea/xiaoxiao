"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type CharacterWeight = "lead" | "side";

type CharacterEditorCardProps = {
  index: number;
  character: any;
  weight: CharacterWeight;
  onWeightChange: (weight: CharacterWeight) => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  splitList: (input: string) => string[];
};

const inputBaseClass =
  "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 placeholder:text-slate-400";

export function CharacterEditorCard({
  index,
  character,
  weight,
  onWeightChange,
  onPatch,
  onDelete,
  splitList,
}: CharacterEditorCardProps) {
  const [expanded, setExpanded] = useState(weight === "lead");
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (weight === "lead") {
      setExpanded(true);
      return;
    }

    setExpanded(false);
    setShowMore(false);
  }, [weight]);

  const compactHint = useMemo(() => {
    return character.current_status?.trim() || "一句话人设（例：忠心耿耿的马夫）";
  }, [character.current_status]);

  return (
    <div className="group relative rounded-lg border border-slate-200 bg-slate-50/40 p-3 transition-all hover:bg-white">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-28 rounded-md border border-transparent bg-white/70 px-2 py-1.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 placeholder:text-slate-400"
          placeholder="角色名"
          value={character.name ?? ""}
          onChange={(e) => onPatch({ name: e.target.value })}
        />

        <input
          className="min-w-[200px] flex-1 rounded-md border border-transparent bg-white/70 px-2 py-1.5 text-sm text-slate-600 outline-none transition focus:border-sky-400 placeholder:text-slate-400"
          placeholder="一句话人设（如：忠心耿耿的马夫）"
          value={character.current_status ?? ""}
          onChange={(e) => onPatch({ current_status: e.target.value })}
        />

        <div className="flex items-center rounded-md border border-slate-200 bg-white p-1 text-xs">
          <button
            type="button"
            className={`rounded px-2 py-1 transition ${weight === "lead" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            onClick={() => onWeightChange("lead")}
          >
            主角
          </button>
          <button
            type="button"
            className={`rounded px-2 py-1 transition ${weight === "side" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            onClick={() => onWeightChange("side")}
          >
            配角
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
          <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : "详情"}
          </Button>
          <Button variant="ghost" className="h-8 px-2 text-xs text-red-500 hover:bg-red-50" onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>

      {!expanded && weight === "side" && (
        <p className="mt-2 text-xs text-slate-500">
          配角紧凑模式：仅维护“姓名 + 当前状态”，点击“详情”可编辑完整属性。
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">核心字段</p>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className={inputBaseClass}
                placeholder="性格"
                value={character.personality ?? ""}
                onChange={(e) => onPatch({ personality: e.target.value })}
              />
              <input
                className={inputBaseClass}
                placeholder="外貌锚点（例：偏窄鹅蛋脸、薄唇）"
                value={character.visual_anchors ?? ""}
                onChange={(e) => onPatch({ visual_anchors: e.target.value })}
              />
              <input
                className={`${inputBaseClass} md:col-span-2`}
                placeholder="外貌描述"
                value={character.appearance ?? ""}
                onChange={(e) => onPatch({ appearance: e.target.value })}
              />
              <input
                className={inputBaseClass}
                placeholder="气质底色（例：强撑威仪、内里心虚）"
                value={character.personality_tags ?? ""}
                onChange={(e) => onPatch({ personality_tags: e.target.value })}
              />
              <input
                className={inputBaseClass}
                placeholder="年龄"
                value={character.age ?? ""}
                onChange={(e) => onPatch({ age: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white/60 p-2">
            <button
              type="button"
              className="w-full text-left text-xs font-semibold text-slate-600"
              onClick={() => setShowMore((v) => !v)}
            >
              {showMore ? "收起更多属性" : "展开更多属性"}
            </button>

            {showMore && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <input
                  className={`${inputBaseClass} md:col-span-2`}
                  placeholder="动机"
                  value={character.motivation ?? ""}
                  onChange={(e) => onPatch({ motivation: e.target.value })}
                />
                <input
                  className={`${inputBaseClass} md:col-span-2`}
                  placeholder="秘密"
                  value={character.secrets ?? ""}
                  onChange={(e) => onPatch({ secrets: e.target.value })}
                />
                <input
                  className={`${inputBaseClass} md:col-span-2`}
                  placeholder="别名（逗号分隔）"
                  value={Array.isArray(character.aliases) ? character.aliases.join("，") : ""}
                  onChange={(e) => onPatch({ aliases: splitList(e.target.value) })}
                />
                <input
                  className={`${inputBaseClass} md:col-span-2`}
                  placeholder="口头禅（逗号分隔）"
                  value={Array.isArray(character.catchphrases) ? character.catchphrases.join("，") : ""}
                  onChange={(e) => onPatch({ catchphrases: splitList(e.target.value) })}
                />
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">角色 #{index + 1} · 当前摘要：{compactHint}</p>
        </div>
      )}
    </div>
  );
}
