import { Fragment, useMemo, type ReactNode } from "react";
import { TOKEN_PATTERN } from "@shared/tokens";
import { htmlToInlineText, toSingleLine } from "@shared/utils/html";

/**
 * Shared read-only renderer for tokenized template text: literal text
 * stays plain, `{{token.chains}}` are shown verbatim — braces and all —
 * inside a chip so they stay visually distinct from the literal text
 * around them. The author sees the token they actually wrote, not a
 * friendlier stand-in that two different tokens could share.
 */

// HTML flattening and whitespace collapsing live in the shared HTML
// library (`htmlToInlineText`, `toSingleLine`) so this summary line and
// the email plain-text fallback decode entities the same way.

export interface TokenTextProps {
  text: string;
  /** Flatten HTML markup before rendering (for `html` template fields). */
  html?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function TokenText({
  text,
  html,
  className,
  "data-testid": testId,
}: TokenTextProps) {
  const source = useMemo(
    () => toSingleLine(html ? htmlToInlineText(text) : text),
    [text, html],
  );

  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    // matchAll clones the regex, so the shared global TOKEN_PATTERN
    // keeps no lastIndex state between calls.
    for (const m of source.matchAll(TOKEN_PATTERN)) {
      const start = m.index ?? 0;
      if (start > cursor) out.push(<Fragment key={key++}>{source.slice(cursor, start)}</Fragment>);
      out.push(
        <span
          key={key++}
          className="mx-0.5 rounded bg-primary/10 px-1 py-px font-mono text-[10px] font-medium text-primary align-baseline"
        >
          {m[0]}
        </span>,
      );
      cursor = start + m[0].length;
    }
    if (cursor < source.length) out.push(<Fragment key={key++}>{source.slice(cursor)}</Fragment>);
    return out;
  }, [source]);

  return (
    <span
      className={className}
      title={source}
      data-testid={testId}
    >
      {parts}
    </span>
  );
}
