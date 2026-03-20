import { MonacoEditor } from "@/components/monaco-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { STAGE_LABELS } from "./constants";
import { FixPanel } from "./fix-panel";
import { IntentCard } from "./intent-card";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

export function EditorPanel({ controller }: Props) {
  return (
    <Card className="col-span-12 lg:col-span-6">
      <IntentCard controller={controller} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={controller.actionLoading} onClick={controller.runPipeline}>
          {controller.actionLoading ? "处理中..." : "运行主流程"}
        </Button>
        <Button variant="ghost" disabled={controller.actionLoading} onClick={controller.runEvaluate}>
          质量评估
        </Button>
        {controller.chapterNo === 1 && (
          <Button variant="ghost" disabled={controller.actionLoading} onClick={controller.createSecondChapterTemplate}>
            创建第2章衔接模板
          </Button>
        )}
      </div>

      <details className="mb-3 rounded border border-black/10 px-3 py-2">
        <summary className="cursor-pointer text-sm font-semibold">高级操作</summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={controller.tab === "beats" ? "default" : "ghost"} onClick={() => controller.setTab("beats")}>
              场景骨架
            </Button>
            <Button variant={controller.tab === "draft" ? "default" : "ghost"} onClick={() => controller.setTab("draft")}>
              正文初稿
            </Button>
            <Button variant={controller.tab === "polish" ? "default" : "ghost"} onClick={() => controller.setTab("polish")}>
              润色定稿
            </Button>
            <Button variant="ghost" disabled={controller.actionLoading} onClick={() => controller.runGenerate(controller.tab)}>
              生成{STAGE_LABELS[controller.tab]}
            </Button>
            <Button variant="ghost" disabled={controller.actionLoading} onClick={() => controller.runDirectorReview(false)}>
              总编评审
            </Button>
            <Button variant="ghost" disabled={controller.actionLoading} onClick={() => controller.runDirectorReview(true)}>
              总编闭环（自动修复）
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={controller.actionLoading} onClick={controller.readSelection}>
              读取选区
            </Button>
            <Button variant="ghost" disabled={controller.actionLoading || !controller.selectedVersionId} onClick={controller.runSelectionFix}>
              选区局部修复
            </Button>
            {controller.tab === "polish" && (
              <Button
                variant="ghost"
                disabled={controller.actionLoading || !controller.selectedVersionId}
                onClick={controller.runNumericConsistencyFix}
              >
                数字一致性修复
              </Button>
            )}
            <Button variant="ghost" disabled={controller.actionLoading || !controller.selectedVersionId} onClick={controller.runDeduplicateCleanup}>
              清理重复段
            </Button>
            <Button variant="ghost" disabled={controller.actionLoading || !controller.selectedVersionId} onClick={controller.runReduceWordRepetition}>
              降重复词
            </Button>
          </div>
        </div>
      </details>

      {controller.actionError && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{controller.actionError}</div>
      )}
      {!controller.actionError && controller.actionMessage && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {controller.actionMessage}
        </div>
      )}

      <FixPanel controller={controller} />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          className="rounded border border-black/15 px-2 py-1"
          value={controller.selectedVersionId}
          onChange={(e) => controller.setSelectedVersionId(e.target.value)}
        >
          <option value="">选择版本</option>
          {controller.versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version_no} ({version.stage}{version.fix_mode ? `/${version.fix_mode}` : ""})
            </option>
          ))}
        </select>

        <select
          className="rounded border border-black/15 px-2 py-1"
          value={controller.compareVersionId}
          onChange={(e) => controller.setCompareVersionId(e.target.value)}
        >
          <option value="">对比版本</option>
          {controller.versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version_no} ({version.stage}{version.fix_mode ? `/${version.fix_mode}` : ""})
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={controller.runDiff}>
          查看差异
        </Button>
        <Button variant="ghost" disabled={controller.actionLoading || !controller.selectedVersionId} onClick={controller.runRollback}>
          回滚到当前选择版本
        </Button>
      </div>

      {controller.selectedVersionMeta && (
        <div className="mb-3 rounded border border-black/10 bg-black/[0.02] p-2 text-xs">
          <p>
            当前版本：v{controller.selectedVersionMeta.version_no}
            {controller.selectedVersionMeta.fix_mode ? ` / ${controller.selectedVersionMeta.fix_mode}` : ""}
            {controller.selectedVersionMeta.strategy_id ? ` / ${controller.selectedVersionMeta.strategy_id}` : ""}
          </p>
          {controller.selectedVersionMeta.parent_version_id && (
            <p>父版本：{String(controller.selectedVersionMeta.parent_version_id).slice(0, 8)}...</p>
          )}
          {controller.selectedVersionMeta.instruction_excerpt && (
            <p className="mt-1 text-black/70">指令摘要：{controller.selectedVersionMeta.instruction_excerpt}</p>
          )}
        </div>
      )}

      <MonacoEditor value={controller.editorText} onChange={controller.setEditorText} onMount={controller.handleEditorMount} />

      {controller.diffData && (
        <pre className="mt-3 max-h-56 overflow-auto rounded bg-black/5 p-3 text-xs">
          {JSON.stringify(controller.diffData, null, 2)}
        </pre>
      )}
    </Card>
  );
}
