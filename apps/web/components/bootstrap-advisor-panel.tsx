import { Button } from "@/components/ui/button";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Props = {
  messages: Message[];
  input: string;
  loading: boolean;
  error: string;
  quickPrompts: string[];
  onInputChange: (value: string) => void;
  onAsk: (question?: string) => void;
};

export function BootstrapAdvisorPanel({
  messages,
  input,
  loading,
  error,
  quickPrompts,
  onInputChange,
  onAsk,
}: Props) {
  return (
    <div className="mt-5 rounded-xl border border-black/10 bg-black/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">AI 开局建议</h3>
          <p className="mt-1 text-sm text-black/60">它只帮你判断和拆解开局问题，不会直接替你写正文或整段开篇。</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {quickPrompts.map((prompt) => (
          <Button
            key={prompt}
            variant="ghost"
            className="h-auto whitespace-normal px-3 py-2 text-left text-xs"
            disabled={loading}
            onClick={() => onAsk(prompt)}
          >
            {prompt}
          </Button>
        ))}
      </div>

      <div className="mt-4 rounded-xl border border-black/10 bg-white p-3">
        {messages.length === 0 && (
          <div className="space-y-1 text-sm text-black/60">
            <p>你可以直接问：</p>
            <p>“我的 logline 还不够抓人吗？”</p>
            <p>“主角速写现在最缺哪一块？”</p>
            <p>“这个基调适合怎样的第一章钩子？”</p>
          </div>
        )}
        {messages.length > 0 && (
          <div className="space-y-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm whitespace-pre-wrap"
                    : "rounded-xl border border-black/10 bg-black/[0.02] px-3 py-3 text-sm whitespace-pre-wrap"
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

      {error && <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-4 grid gap-2">
        <textarea
          className="min-h-24 rounded-xl border border-black/15 px-3 py-3 text-sm"
          placeholder="问一个更具体的问题，比如：现在这个 logline 最大的问题是什么？"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-black/55">越具体越有用。它最适合帮你判断 logline、主角、基调和第一章钩子的优先级。</p>
          <Button variant="secondary" disabled={loading} onClick={() => onAsk()}>
            {loading ? "正在整理建议..." : "获取开局建议"}
          </Button>
        </div>
      </div>
    </div>
  );
}
