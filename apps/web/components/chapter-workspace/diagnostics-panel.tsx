import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FIX_MODE_BY_STRATEGY_INDEX, FIX_MODE_LABELS, FIX_MODE_RISK_LABELS } from "./constants";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

const STAGE_LABELS: Record<string, string> = {
  beats: "Beats",
  draft: "Draft",
  polish: "Polish",
  fix: "Fix",
  quality_eval: "Quality",
  director: "Director",
  adaptation: "Adaptation",
};

function stringifyPromptInput(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "无";
  }
  const json = JSON.stringify(value, null, 2);
  return json.length > 320 ? `${json.slice(0, 320)}...` : json;
}

function shortHash(value?: string | null) {
  if (!value) return "-";
  return value.length > 16 ? `${value.slice(0, 16)}...` : value;
}

export function DiagnosticsPanel({ controller }: Props) {
  return (
    <Card className="col-span-12 h-[760px] overflow-auto lg:col-span-3">
      <h2 className="font-medium">Diagnostics Panel</h2>
      <div className="mt-2 rounded border border-black/10 bg-black/[0.02] p-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">发布判断</p>
          <span className="rounded-full bg-white px-2 py-1 text-[11px]">{controller.publishReadiness?.label ?? "待评估"}</span>
        </div>
        <p className="mt-2 text-sm text-black/80">{controller.publishReadiness?.summary ?? "先运行主流程或质量评估，才能判断是否能发。"}</p>
        {controller.publishReadiness?.strongest_point && (
          <p className="mt-2 text-[11px] text-emerald-800">本章最强卖点：{controller.publishReadiness.strongest_point}</p>
        )}
        {Array.isArray(controller.publishReadiness?.top_actions) && controller.publishReadiness.top_actions.length > 0 && (
          <div className="mt-2">
            <p className="font-medium">发布前优先改</p>
            {controller.publishReadiness.top_actions.map((item) => (
              <p key={item} className="mt-1 text-[11px]">
                {item}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <p>开头钩子分：{controller.quality?.opening_hook ?? "-"}</p>
        <p>冲突分：{controller.quality?.conflict_strength ?? "-"}</p>
        <p>节奏分：{controller.quality?.pacing ?? "-"}</p>
        <p>对白分：{controller.quality?.dialogue_quality ?? "-"}</p>
        <p>结尾钩子分：{controller.quality?.ending_hook ?? "-"}</p>
        <p>总分：{controller.quality?.overall_score ?? "-"}</p>
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <p className="font-medium">最近 3 次分数趋势</p>
        {controller.qualityTrend.length === 0 && <p className="text-black/60">暂无趋势数据</p>}
        {controller.qualityTrend.map((item) => (
          <p key={item.version_id}>
            {item.version_id.slice(0, 8)}... : {item.overall_score}
          </p>
        ))}
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <p className="font-medium">Director 建议</p>
        {!controller.director && <p className="text-black/60">暂无总编建议</p>}
        {controller.director && (
          <>
            <p>决策：{controller.director.decision}</p>
            <p>节奏方向：{controller.director.pacing_direction ?? "-"}</p>
            <p>钩子建议：{controller.director.hook_upgrade ?? "-"}</p>
            <p>主线校正：{controller.director.arc_correction ?? "-"}</p>
            <p className="mt-1 text-black/65">{controller.director.summary ?? "-"}</p>
          </>
        )}
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <p className="font-medium">推荐 Fix 操作</p>
        {controller.recentFixTasks.length === 0 && <p className="text-black/60">暂无 fix task</p>}
        {controller.recentFixTasks.slice(0, 3).map((task: any) => (
          <p key={task.id}>
            {task.issue_type}
            {" -> "}
            {task.status}
          </p>
        ))}
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">Prompt Trace</p>
          <span className="text-[11px] text-black/50">{controller.promptTrace.length} stages</span>
        </div>
        {controller.promptTrace.length === 0 && <p className="mt-2 text-black/60">暂无 prompt trace，先运行生成或修复。</p>}
        <div className="mt-2 space-y-2">
          {controller.promptTrace.map((item) => (
            <div
              key={`${item.stage}-${item.prompt_template_version_id ?? item.prompt_version ?? "trace"}`}
              className="rounded border border-black/10 bg-black/[0.02] p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{STAGE_LABELS[item.stage] ?? item.stage}</p>
                  <p className="text-[11px] text-black/60">
                    {(item.prompt_name ?? "unknown")}/{item.prompt_version ?? "-"}
                  </p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px]">{item.platform_variant ?? "default"}</span>
              </div>
              <p className="mt-1 text-[11px] text-black/65">
                style: {item.style_preset_name ?? "-"} · model: {item.model ?? "-"}
              </p>
              <p className="text-[11px] text-black/65">context: {shortHash(item.context_hash)}</p>
              <details className="mt-2 rounded border border-black/10 bg-white/80 px-2 py-1">
                <summary className="cursor-pointer text-[11px] text-black/65">输入摘要</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-5 text-black/75">
                  {stringifyPromptInput(item.input_summary)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 rounded border border-black/10 p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">Resources</p>
          <Button variant="ghost" className="h-7 px-2 text-xs" disabled={controller.actionLoading} onClick={controller.rebuildResourceReferences}>
            重新扫描
          </Button>
        </div>

        <div className="mt-2 rounded border border-black/10 bg-black/[0.02] p-2 text-[11px]">
          <p>总引用: {controller.resourceSummary?.total ?? 0}</p>
          <p>confirmed: {controller.resourceSummary?.confirmed ?? 0}</p>
          <p>inferred: {controller.resourceSummary?.inferred ?? 0}</p>
          <p>ignored: {controller.resourceSummary?.ignored ?? 0}</p>
        </div>

        {controller.hotResources.length > 0 && (
          <div className="mt-2 rounded border border-black/10 p-2 text-[11px]">
            <p className="font-medium">引用热度</p>
            {controller.hotResources.map(({ group, item }: any) => (
              <p key={item.id}>
                {controller.resourceGroupLabels[group] ?? group}: {item.resource?.name ?? item.resource?.term ?? item.resource?.event ?? item.resource_id}
                {" · "}
                {item.stats?.total_hits ?? item.occurrence_count ?? item.total_hits ?? 0} hits
              </p>
            ))}
          </div>
        )}

        {controller.resourceRuleHits.length > 0 && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
            <p className="font-medium">规则命中</p>
            {controller.resourceRuleHits.slice(0, 5).map((issue: any) => (
              <p key={issue.issue_id}>{issue.message}</p>
            ))}
          </div>
        )}

        <div className="mt-2 space-y-2">
          {controller.resourceSections.length === 0 && <p className="text-black/60">暂无资源引用，先运行主流程或点击重新扫描。</p>}
          {controller.resourceSections.map(([group, items]) => (
            <div key={group} className="rounded border border-black/10 p-2">
              <p className="font-medium">{controller.resourceGroupLabels[group] ?? group}</p>
              <div className="mt-2 space-y-2">
                {(items as any[]).slice(0, 4).map((item) => (
                  <div key={item.id} className="rounded border border-black/10 px-2 py-2">
                    <p className="text-[11px] font-medium">
                      {item.resource?.name ?? item.resource?.term ?? item.resource?.event ?? item.resource_id}
                    </p>
                    <p className="text-[11px] text-black/60">
                      {item.state} · {item.stats?.total_hits ?? item.occurrence_count ?? 0} hits
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={controller.actionLoading}
                        onClick={() => controller.updateReferenceState(item.resource_type, item.resource_id, "confirmed")}
                      >
                        确认
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={controller.actionLoading}
                        onClick={() => controller.updateReferenceState(item.resource_type, item.resource_id, "ignored")}
                      >
                        忽略
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={controller.actionLoading}
                        onClick={() => controller.updateReferenceState(item.resource_type, item.resource_id, "inferred")}
                      >
                        恢复
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="mt-4 font-medium">一致性报告</h2>
      <div className="mt-2 space-y-3">
        <div className="rounded border border-black/10 bg-black/[0.02] p-2 text-[11px] text-black/70">
          <p className="font-medium text-black/80">处理顺序</p>
          <p>1) 先点“跳转段落”定位问题。</p>
          <p>2) 优先点“推荐修复”。</p>
          <p>3) 修完后点“质量评估”复评。</p>
          <p className="mt-1">策略1=局部替换，策略2=场景重写，策略3=整章重写。</p>
        </div>

        {!controller.showAllIssues && controller.collapsedRepeatedCount > 0 && (
          <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            已折叠 {controller.collapsedRepeatedCount} 条重复的低优先级问题（knowledge_unknown）。
            <button
              type="button"
              className="ml-2 underline underline-offset-2"
              onClick={() => controller.setShowAllIssues(true)}
            >
              展开全部
            </button>
          </div>
        )}
        {controller.showAllIssues && controller.collapsedRepeatedCount > 0 && (
          <div className="rounded border border-black/10 px-2 py-1 text-[11px] text-black/70">
            已展开全部问题。
            <button
              type="button"
              className="ml-2 underline underline-offset-2"
              onClick={() => controller.setShowAllIssues(false)}
            >
              收起重复项
            </button>
          </div>
        )}

        {controller.visibleIssues.length === 0 && <p className="text-sm text-black/60">暂无问题</p>}
        {controller.visibleIssues.map((issue: any) => {
          const recommendedIdx = controller.pickRecommendedStrategyIndex(issue);
          const recommendedMode = FIX_MODE_BY_STRATEGY_INDEX[recommendedIdx] ?? "replace_span";
          const recommendedLabel = FIX_MODE_LABELS[recommendedMode];
          const recommendedRisk = FIX_MODE_RISK_LABELS[recommendedMode];
          return (
            <div key={issue.issue_id} className="rounded border border-black/10 p-2">
              <p className="text-xs uppercase text-black/60">{issue.severity}</p>
              <p className="text-sm">{issue.message}</p>
              <Button className="mt-2" variant="ghost" onClick={() => controller.jumpToEvidence(issue)}>
                跳转段落
              </Button>
              <p className="mt-1 text-[11px] text-black/60">推荐策略风险：{recommendedRisk}</p>
              <div className="mt-2 grid gap-1">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={controller.actionLoading}
                    onClick={() => controller.runFix(issue, recommendedIdx)}
                    title={controller.fixStrategies[recommendedIdx] ?? ""}
                  >
                    {`推荐修复：策略${recommendedIdx + 1}（${recommendedLabel}）`}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={controller.previewLoading}
                    onClick={() => controller.runIssuePreview(issue, recommendedIdx)}
                  >
                    {controller.previewLoading ? "预估中..." : "预估影响"}
                  </Button>
                </div>
                <details className="rounded border border-black/10 px-2 py-1">
                  <summary className="cursor-pointer text-[11px] text-black/65">更多策略</summary>
                  <div className="mt-2 grid gap-1">
                    {controller.fixStrategies.map((strategy: string, idx: number) => {
                      if (idx === recommendedIdx) return null;
                      const mode = FIX_MODE_BY_STRATEGY_INDEX[idx] ?? "replace_span";
                      const label = FIX_MODE_LABELS[mode];
                      const riskLabel = FIX_MODE_RISK_LABELS[mode];
                      return (
                        <Button
                          key={`${issue.issue_id}-${idx}`}
                          variant="ghost"
                          disabled={controller.actionLoading}
                          onClick={() => controller.runFix(issue, idx)}
                          title={strategy}
                        >
                          {`策略${idx + 1}：${label}（${riskLabel}）`}
                        </Button>
                      );
                    })}
                  </div>
                </details>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="mt-4 font-semibold">本章抽取项（Facts / Seeds / Timeline）</h3>
      <div className="mt-2 space-y-2 text-xs">
        {["facts", "seeds", "timeline"].map((kind) => (
          <div key={kind}>
            <p className="font-medium">{kind}</p>
            {((controller.workspace?.extracted_items?.[kind] as any[]) ?? []).map((item: any) => (
              <div key={item.id} className="mb-2 rounded border border-black/10 p-2">
                <p>{item.content ?? item.event}</p>
                <select
                  className="mt-1 rounded border border-black/20 px-2 py-1"
                  value={item.status ?? item.extraction_status}
                  onChange={(e) => controller.updateItemStatus(kind as any, item.id, e.target.value)}
                >
                  <option value="extracted">extracted</option>
                  <option value="confirmed">confirmed</option>
                  <option value="rejected">rejected</option>
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}
