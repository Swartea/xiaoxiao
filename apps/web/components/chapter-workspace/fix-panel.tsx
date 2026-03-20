import { Button } from "@/components/ui/button";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

export function FixPanel({ controller }: Props) {
  return (
    <div className="mb-3 rounded border border-black/10 bg-black/[0.02] p-3">
      <p className="text-sm font-semibold">Fix Panel</p>
      <div className="mt-2 grid gap-2 text-xs">
        <label className="grid gap-1">
          <span className="text-black/70">修复目标（fix_goal）</span>
          <textarea
            className="h-16 rounded border border-black/15 px-2 py-1 text-xs"
            value={controller.fixGoal}
            onChange={(e) => controller.setFixGoal(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-black/70">保留元素（keep_elements，用逗号分隔）</span>
          <input
            className="rounded border border-black/15 px-2 py-1 text-xs"
            value={controller.keepElementsText}
            onChange={(e) => controller.setKeepElementsText(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-black/70">禁止改动（forbidden_changes，用逗号分隔）</span>
          <input
            className="rounded border border-black/15 px-2 py-1 text-xs"
            value={controller.forbiddenChangesText}
            onChange={(e) => controller.setForbiddenChangesText(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-black/70">目标强度</span>
            <select
              className="rounded border border-black/15 px-2 py-1 text-xs"
              value={controller.targetIntensity}
              onChange={(e) => controller.setTargetIntensity(e.target.value as any)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-black/70">自定义模式</span>
            <select
              className="rounded border border-black/15 px-2 py-1 text-xs"
              value={controller.manualFixMode}
              onChange={(e) => controller.setManualFixMode(e.target.value as any)}
            >
              <option value="replace_span">局部替换</option>
              <option value="rewrite_section">场景重写</option>
              <option value="rewrite_chapter">整章重写</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-black/70">场景序号（场景重写用）</span>
            <input
              className="rounded border border-black/15 px-2 py-1 text-xs"
              value={controller.manualSceneIndex}
              onChange={(e) => controller.setManualSceneIndex(e.target.value)}
              placeholder="0"
            />
          </label>
        </div>
        <p className="text-[11px] text-black/60">
          当前选区：{controller.selectionSpan ? `${controller.selectionSpan.from}-${controller.selectionSpan.to}` : "未读取选区"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={controller.actionLoading || controller.previewLoading} onClick={controller.runManualFixPreview}>
            {controller.previewLoading ? "预估中..." : "预估自定义修复"}
          </Button>
          <Button variant="ghost" disabled={controller.actionLoading} onClick={controller.runManualFix}>
            执行自定义修复
          </Button>
          <Button
            variant="ghost"
            disabled={controller.actionLoading || !controller.previewPayload}
            onClick={controller.executePreviewFix}
          >
            执行当前预估方案
          </Button>
        </div>
        {controller.previewError && <p className="text-[11px] text-red-700">{controller.previewError}</p>}
        {controller.fixPreview && (
          <div className="rounded border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-900">
            <p className="font-semibold">修复预估</p>
            <p>
              风险：{controller.fixPreview.risk_level} | 覆盖范围：{controller.fixPreview.target_chars}/{controller.fixPreview.chapter_chars} (
              {(Number(controller.fixPreview.impact_ratio) * 100).toFixed(1)}%)
            </p>
            <p>模式：{controller.fixPreview.mode}</p>
            <p>操作：{controller.fixPreview.estimated_operation}</p>
            <p>建议：{controller.fixPreview.suggestion}</p>
            <p className="mt-1">
              可能影响角色：
              {Array.isArray(controller.fixPreview.touched_entities?.characters)
                ? controller.fixPreview.touched_entities.characters.join("、") || "无"
                : "无"}
            </p>
            <p>
              可能关联种子：
              {Array.isArray(controller.fixPreview.touched_entities?.seeds) ? controller.fixPreview.touched_entities.seeds.length : 0} 条
            </p>
            <p>
              可能关联事实：
              {Array.isArray(controller.fixPreview.touched_entities?.facts) ? controller.fixPreview.touched_entities.facts.length : 0} 条
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
