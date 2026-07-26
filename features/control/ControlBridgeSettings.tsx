import { useState, type FormEvent } from "react";
import { Loader2, Network } from "lucide-react";
import { useStudioControlBridge } from "./StudioControlBridgeProvider";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:43119";

export function ControlBridgeSettings() {
  const { snapshot, connect, disconnect } = useStudioControlBridge();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BRIDGE_URL);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const connected = snapshot.status === "connected";

  const handleConnect = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || token.length < 32) return;
    setSubmitting(true);
    try {
      await connect(baseUrl.trim(), token);
      setToken("");
    } catch {
      // The provider exposes a safe status message.
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await disconnect();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="pt-6 border-t border-border/20">
      <h3 className="text-xs text-textMuted font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
        <Network size={14} /> Local control
      </h3>
      <form
        className="space-y-3 rounded-lg border border-border/50 bg-surface/30 p-4"
        onSubmit={handleConnect}
      >
        <p className="text-xs leading-relaxed text-textMuted">
          Connect this browser tab to the loopback bridge used by MCP and local agents.
          The token stays in memory for this tab.
        </p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-textMain">Bridge URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            disabled={connected || submitting}
            spellCheck={false}
            className="w-full rounded border border-border bg-input px-2.5 py-2 font-mono text-xs text-textMain outline-none focus:border-accent disabled:opacity-60"
          />
        </label>
        {!connected && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-textMain">Session token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded border border-border bg-input px-2.5 py-2 font-mono text-xs text-textMain outline-none focus:border-accent"
            />
          </label>
        )}
        <div
          role="status"
          aria-live="polite"
          className={`rounded border px-3 py-2 text-xs ${
            snapshot.status === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-300"
              : connected
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-border bg-panel text-textMuted"
          }`}
        >
          {snapshot.message}
          {connected && snapshot.activeOperations > 0
            ? ` ${snapshot.activeOperations} active.`
            : ""}
        </div>
        {connected ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            disabled={submitting}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded border border-border bg-panel px-3 text-xs font-semibold text-textMain hover:border-red-400/60 disabled:opacity-50"
          >
            {submitting && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            Disconnect
          </button>
        ) : (
          <button
            type="submit"
            disabled={submitting || token.length < 32 || baseUrl.trim().length === 0}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded bg-accent px-3 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {submitting && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            Connect bridge
          </button>
        )}
      </form>
    </section>
  );
}
