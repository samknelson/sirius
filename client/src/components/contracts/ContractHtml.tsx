import { sanitizeHtml } from "@shared/utils/html";
import { cn } from "@/lib/utils";

interface ContractHtmlProps {
  html: string | null | undefined;
  className?: string;
  "data-testid"?: string;
}

/**
 * Shared read-only renderer for contract section bodies. Sanitizes the stored
 * HTML under `authored-document` — the same policy that defines what the
 * rich-text editor lets an author write — before rendering it.
 */
export function ContractHtml({ html, className, "data-testid": testId }: ContractHtmlProps) {
  const clean = html ? sanitizeHtml(html, "authored-document") : "";
  if (!clean.trim()) {
    return (
      <p className="text-muted-foreground text-sm italic" data-testid={testId}>
        No content.
      </p>
    );
  }
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert",
        "[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_td]:border [&_th]:border-border [&_td]:border-border [&_th]:p-2 [&_td]:p-2 [&_th]:text-left",
        className,
      )}
      data-testid={testId}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
