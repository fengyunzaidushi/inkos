import { useMemo, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { postApi } from "../hooks/use-api";

interface PlayStepResponse {
  readonly worldId: string;
  readonly runId: string;
  readonly sceneText: string;
  readonly suggestedActions: ReadonlyArray<string>;
}

interface PlayTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly suggestions?: ReadonlyArray<string>;
}

export function PlayPage() {
  const [worldId, setWorldId] = useState("demo-world");
  const [runId, setRunId] = useState("main");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<PlayTurn[]>([
    {
      role: "assistant",
      content: "这是一个独立互动入口。输入你要做的动作，系统会按世界状态推进，并给出可选动作；你也可以完全自由输入。",
      suggestions: ["观察周围", "和面前的人说话", "检查身上的物品"],
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(
    () => Boolean(worldId.trim() && runId.trim() && input.trim()) && !loading,
    [input, loading, runId, worldId],
  );

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setError(null);
    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const result = await postApi<PlayStepResponse>("/play/step", {
        worldId: worldId.trim(),
        runId: runId.trim(),
        input: trimmed,
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.sceneText,
          suggestions: result.suggestedActions,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.12),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent)]">
      <div className="mx-auto flex h-full max-w-5xl flex-col px-6 py-6">
        <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles size={13} />
              InkOS Play
            </div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight">互动世界运行台</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              独立于建书和普通聊天。这里是玩家动作驱动：自由输入动作，系统解释动作、更新世界状态、返回下一段场景。
            </p>
          </div>
          <div className="grid w-full gap-2 md:w-[360px] md:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              世界 ID
              <input
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Run ID
              <input
                value={runId}
                onChange={(event) => setRunId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/50 bg-background/75 p-5">
          <div className="space-y-4">
            {turns.map((turn, index) => (
              <div key={`${turn.role}-${index}`} className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${
                  turn.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/50 bg-card text-foreground"
                }`}
                >
                  <div className="whitespace-pre-wrap">{turn.content}</div>
                  {turn.suggestions && turn.suggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {turn.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => void send(suggestion)}
                          disabled={loading}
                          className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                世界正在响应...
              </div>
            )}
          </div>
        </section>

        {error && (
          <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form
          className="mt-4 flex items-end gap-3 rounded-2xl border border-border/60 bg-card/80 p-3 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="自由输入动作，例如：我假装看天气，顺手点开车机导航记录"
            className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/50"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:scale-100 disabled:opacity-30"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}
