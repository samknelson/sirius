import { useEffect, useRef, useState } from "react";
import { LETTER_PAGE_GEOMETRY } from "@shared/utils/html/letter-page";

interface LetterPagePreviewProps {
  /** The letter body — the same markup that is sent, unwrapped. */
  bodyHtml: string;
  testId?: string;
}

export function LetterPagePreview({
  bodyHtml,
  testId = "letter-page-preview",
}: LetterPagePreviewProps) {
  const body = bodyHtml.trim();
  const blobUrlRef = useRef<string | null>(null);
  const [result, setResult] = useState<
    | { body: string; status: "loading" }
    | { body: string; status: "ready"; url: string }
    | { body: string; status: "error"; message: string }
    | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setResult(body ? { body, status: "loading" } : null);

    if (!body) {
      return () => controller.abort();
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/comm/postal/preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Preview failed (${response.status})`;
          try {
            const contentType = response.headers.get("content-type") ?? "";
            if (contentType.includes("application/json")) {
              const payload = (await response.json()) as { message?: unknown };
              if (typeof payload.message === "string" && payload.message.trim()) {
                message = payload.message;
              }
            } else {
              const text = await response.text();
              if (text.trim()) message = text;
            }
          } catch {
            // Keep the status-based message when an error response is unreadable.
          }
          throw new Error(message);
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/pdf")) {
          throw new Error("The server returned an invalid preview");
        }

        const blob = await response.blob();
        if (!active) return;
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        setResult({ body, status: "ready", url });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setResult({
          body,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to generate the PDF preview",
        });
      }
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [body]);

  // A result belongs only to the exact body that produced it. This prevents
  // the previous letter remaining visible during the debounce after an edit.
  const current = result?.body === body ? result : null;
  const G = LETTER_PAGE_GEOMETRY;

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="min-h-64 overflow-hidden rounded-sm border bg-muted/30 shadow-sm">
        {!body && (
          <div className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Enter letter content to generate a PDF preview.
          </div>
        )}
        {body && (!current || current.status === "loading") && (
          <div
            className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground"
            role="status"
            data-testid={`${testId}-loading`}
          >
            Generating PDF preview…
          </div>
        )}
        {current?.status === "error" && (
          <div
            className="flex min-h-64 items-center justify-center p-6 text-center text-sm text-destructive"
            role="alert"
            data-testid={`${testId}-error`}
          >
            {current.message}
          </div>
        )}
        {current?.status === "ready" && (
          <iframe
            title="Letter PDF preview"
            src={current.url}
            className="h-[min(70vh,760px)] min-h-[520px] w-full border-0 bg-white"
            data-testid={`${testId}-page`}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid={`${testId}-note`}>
        This is the actual multi-page PDF produced by the mailing renderer.
        Preview-only guides mark the {G.sideMarginIn}" page margins and the
        page-one {G.addressBlock.widthIn}" × {G.addressBlock.heightIn}" area
        reserved for the address. The guides are not printed on mailed letters.
      </p>
    </div>
  );
}
