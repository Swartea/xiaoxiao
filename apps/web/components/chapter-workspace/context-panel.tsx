import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

function renderList(title: string, items: unknown) {
  const values = Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
  if (values.length === 0) {
    return null;
  }

  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-1 list-disc pl-4 text-xs">
        {values.map((item) => (
          <li key={`${title}-${item}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function ContextPanel({ controller }: Props) {
  const contextBrief = controller.contextBrief;
  const legacyTraceSnapshot = controller.legacyTraceSnapshot as any;
  const brief = contextBrief?.context_brief;

  return (
    <Card className="col-span-12 h-[760px] overflow-auto lg:col-span-3">
      <h2 className="font-medium">StoryOS 上下文摘要</h2>
      {!contextBrief && !legacyTraceSnapshot && <p className="mt-2 text-sm text-black/60">尚无上下文快照，先运行主流程或高级生成。</p>}

      {contextBrief && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="rounded border border-black/10 bg-black/[0.02] p-2 text-xs">
            <p>来源: {contextBrief.source ?? "storyos"}</p>
            <p>阶段: {contextBrief.stage ?? "-"}</p>
            <p>context_hash: {contextBrief.context_hash ?? "-"}</p>
            <p>tags: {Array.isArray(contextBrief.tags) && contextBrief.tags.length > 0 ? contextBrief.tags.join(" / ") : "-"}</p>
          </div>

          <section>
            <h3 className="font-semibold">章节使命</h3>
            <p className="mt-1 text-sm">{brief?.chapter_mission ?? "暂无章节使命"}</p>
          </section>

          {renderList("必须记住", brief?.must_remember)}
          {renderList("不可违背", brief?.must_not_violate)}
          {renderList("活跃关系", brief?.active_relationships)}
          {renderList("待兑现目标", brief?.payoff_targets)}
          {renderList("风险点", brief?.danger_points)}
        </div>
      )}

      <section className="mt-4 rounded border border-black/10 bg-black/[0.02] p-3">
        <h3 className="font-semibold">下一章交接单</h3>
        {!controller.handoffBrief && <p className="mt-2 text-xs text-black/60">先运行主流程或质量评估，系统会为你整理这一章的交接重点。</p>}
        {controller.handoffBrief && (
          <div className="mt-2 space-y-3 text-sm">
            {renderList("本章带走什么", controller.handoffBrief.chapter_takeaways)}
            {renderList("仍未兑现的伏笔", controller.handoffBrief.unresolved_seeds)}
            {renderList("人物关系变化", controller.handoffBrief.relationship_changes)}
            {renderList("下一章必须延续的压力", controller.handoffBrief.carry_over_pressure)}
            {renderList("建议开篇切口", controller.handoffBrief.next_opening_options)}
          </div>
        )}
      </section>

      {legacyTraceSnapshot && (
        <section className="mt-4">
          <h3 className="font-semibold">兼容追溯信息</h3>
          {!controller.showTraceMeta ? (
            <Button className="mt-2" variant="ghost" onClick={() => controller.setShowTraceMeta(true)}>
              展开详细追溯 JSON
            </Button>
          ) : (
            <div className="mt-2">
              <pre className="max-h-56 overflow-auto rounded bg-black/5 p-2 text-xs">
                {JSON.stringify(
                  {
                    context_hash: legacyTraceSnapshot?.context_hash,
                    retriever_meta: legacyTraceSnapshot?.retriever_meta,
                    trace_map: legacyTraceSnapshot?.trace_map,
                  },
                  null,
                  2,
                )}
              </pre>
              <Button className="mt-2" variant="ghost" onClick={() => controller.setShowTraceMeta(false)}>
                收起详细追溯 JSON
              </Button>
            </div>
          )}
        </section>
      )}
    </Card>
  );
}
