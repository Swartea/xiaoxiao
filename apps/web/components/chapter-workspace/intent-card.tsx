import { Button } from "@/components/ui/button";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

export function IntentCard({ controller }: Props) {
  return (
    <div className="mb-3 rounded-xl border border-black/10 bg-amber-50/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">本章意图卡</p>
          <p className="mt-1 text-xs text-black/65">先定义这一章要推进什么，再运行主流程。运行主流程前会自动带上当前意图草稿。</p>
        </div>
        <div className="text-right text-[11px] text-black/55">
          <p>{controller.latestIntent ? `已保存 v${controller.latestIntent.version_no}` : "尚未保存意图"}</p>
          {controller.publishReadiness?.label && <p className="mt-1">当前发布判断：{controller.publishReadiness.label}</p>}
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs text-black/70">章节使命</span>
          <textarea
            className="h-20 rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
            value={controller.intentMission}
            onChange={(e) => controller.setIntentMission(e.target.value)}
            placeholder="这一章必须完成什么推进？"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-black/70">推进目标</span>
          <input
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
            value={controller.intentAdvanceGoal}
            onChange={(e) => controller.setIntentAdvanceGoal(e.target.value)}
            placeholder="人物/主线推进到哪里"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-black/70">本章冲突</span>
          <input
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
            value={controller.intentConflictTarget}
            onChange={(e) => controller.setIntentConflictTarget(e.target.value)}
            placeholder="这一章最该顶起来的冲突"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-black/70">结尾钩子</span>
          <input
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
            value={controller.intentHookTarget}
            onChange={(e) => controller.setIntentHookTarget(e.target.value)}
            placeholder="读者看到章末最想追的点"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-black/70">节奏方向</span>
          <input
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm"
            value={controller.intentPacingDirection}
            onChange={(e) => controller.setIntentPacingDirection(e.target.value)}
            placeholder="提速 / 压速 / 强化情绪沉淀"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={controller.actionLoading} onClick={controller.saveChapterIntent}>
          保存本章意图
        </Button>
        <p className="text-[11px] text-black/60">建议至少填完“章节使命 + 本章冲突 + 结尾钩子”。</p>
      </div>
    </div>
  );
}
