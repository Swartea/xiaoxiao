import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ChapterWorkspaceController } from "./use-chapter-workspace";

type Props = {
  controller: ChapterWorkspaceController;
};

export function AuthorAdvisorPanel({ controller }: Props) {
  return (
    <Card className="col-span-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">AI 创作建议口</h2>
          <p className="mt-1 text-sm text-black/65">这个口子只负责陪你拆问题、提建议，不直接改稿，也不会替你一键写正文。</p>
        </div>
        {controller.publishReadiness?.label && (
          <div className="rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-xs text-black/70">
            当前状态：{controller.publishReadiness.label}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {controller.advisorQuickPrompts.map((prompt) => (
          <Button
            key={prompt}
            variant="ghost"
            className="h-auto whitespace-normal px-3 py-2 text-left text-xs"
            disabled={controller.advisorLoading}
            onClick={() => controller.askAuthorAdvisor(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-black/10 bg-black/[0.02] p-3">
        {controller.advisorMessages.length === 0 && (
          <div className="space-y-2 text-sm text-black/65">
            <p>你可以直接问它：</p>
            <p>“这章开头弱在哪里？”</p>
            <p>“如果下一章要更抓人，第一场怎么起？”</p>
            <p>“这章如果只能改 3 处，优先改哪里？”</p>
          </div>
        )}
        {controller.advisorMessages.length > 0 && (
          <div className="space-y-3">
            {controller.advisorMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm whitespace-pre-wrap"
                    : "rounded-xl border border-black/10 bg-white px-3 py-3 text-sm whitespace-pre-wrap"
                }
              >
                <p className="mb-1 text-[11px] uppercase tracking-wide text-black/45">
                  {message.role === "assistant" ? "AI 建议" : "我的问题"}
                </p>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {controller.advisorError && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{controller.advisorError}</div>
      )}

      <div className="mt-4 grid gap-2">
        <textarea
          className="min-h-28 rounded-xl border border-black/15 px-3 py-3 text-sm"
          placeholder="问它一个具体问题，比如：这章的结尾为什么还不够抓人？"
          value={controller.advisorInput}
          onChange={(e) => controller.setAdvisorInput(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-black/55">建议问得越具体越好，它更适合做方向判断、问题拆解、优先级建议。</p>
          <Button variant="secondary" disabled={controller.advisorLoading} onClick={() => controller.askAuthorAdvisor()}>
            {controller.advisorLoading ? "正在整理建议..." : "获取建议"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
