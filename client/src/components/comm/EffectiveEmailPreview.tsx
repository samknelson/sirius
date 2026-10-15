import { useEffect, useState } from "react";

/** Preview-only output: never copied back into an editor or template. */
export function EffectiveEmailPreview({ bodyHtml, testId }: { bodyHtml: string; testId?: string }) {
  const [result, setResult] = useState<{ source: string; html?: string; text?: string; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!bodyHtml.trim()) return;
      try {
        const response = await fetch("/api/comm/email/preview", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bodyHtml }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to preview email.");
        setResult({ source: bodyHtml, ...data });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ source: bodyHtml, error: error instanceof Error ? error.message : "Unable to preview email." });
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [bodyHtml]);
  if (!bodyHtml.trim()) return <p className="text-sm text-muted-foreground">Enter a message to preview.</p>;
  if (!result || result.source !== bodyHtml) return <p role="status" className="text-sm text-muted-foreground">Preparing email preview…</p>;
  if (result.error) return <p role="alert" className="text-sm text-destructive">{result.error}</p>;
  return <div className="space-y-2">
    <iframe title="Email body preview" sandbox="" referrerPolicy="no-referrer" className="w-full min-h-96 border-0 bg-white"
      data-testid={testId}
      srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font:14px Arial,sans-serif;padding:12px;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}</style></head><body>${result.html ?? ""}</body></html>`} />
    <p className="text-xs text-muted-foreground">Includes the current site-wide Email Letterhead. Settings are selected again when the message is delivered.</p>
    <details className="text-xs"><summary>Plain-text alternative</summary><pre className="whitespace-pre-wrap break-words">{result.text}</pre></details>
  </div>;
}
