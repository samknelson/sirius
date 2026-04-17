import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TokenDefinition } from "@shared/bulk-tokens";

const RECENT_KEY = "token-picker-recent";
const RECENT_MAX = 5;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

const MIRROR_PROPS = [
  "direction", "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderStyle",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontSizeAdjust",
  "lineHeight", "fontFamily",
  "textAlign", "textTransform", "textIndent", "textDecoration",
  "letterSpacing", "wordSpacing", "tabSize",
] as const;

function getCaretCoordinates(
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number,
): { top: number; left: number; height: number } {
  const isInput = element.nodeName === "INPUT";
  const div = document.createElement("div");
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(element);
  style.whiteSpace = "pre-wrap";
  if (!isInput) (style as unknown as { wordWrap: string }).wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  style.top = "0";
  style.left = "0";
  for (const prop of MIRROR_PROPS) {
    (style as unknown as Record<string, string>)[prop] = computed.getPropertyValue(
      prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()),
    );
  }
  if (isInput) {
    style.lineHeight = computed.height;
    style.overflow = "hidden";
  }
  const before = element.value.substring(0, position);
  div.textContent = isInput ? before.replace(/\s/g, "\u00a0") : before;
  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);
  const result = {
    top: span.offsetTop + parseInt(computed.borderTopWidth || "0", 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth || "0", 10),
    height: parseInt(computed.lineHeight || "16", 10) || 16,
  };
  document.body.removeChild(div);
  return result;
}

type CommonProps = {
  value: string;
  onChange: (next: string) => void;
  messageId?: string;
  className?: string;
  containerClassName?: string;
};

type InputModeProps = CommonProps & {
  as: "input";
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">;

type TextareaModeProps = CommonProps & {
  as: "textarea";
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">;

export type SlashTokenFieldProps = InputModeProps | TextareaModeProps;

export function SlashTokenField(props: SlashTokenFieldProps) {
  const { as, value, onChange, messageId, containerClassName, ...rest } = props as CommonProps & {
    as: "input" | "textarea";
  } & Record<string, unknown>;

  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [trigger, setTrigger] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState("");

  const isOpen = trigger !== null;

  const queryKey = messageId
    ? ["/api/bulk-messages", messageId, "tokens"]
    : ["/api/bulk-tokens"];
  const { data } = useQuery<{ tokens: TokenDefinition[] }>({ queryKey });
  const tokens = data?.tokens || [];

  const filtered = useMemo<TokenDefinition[]>(() => {
    if (!isOpen) return [];
    const q = query.trim().toLowerCase();
    if (q) {
      return tokens.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q),
      );
    }
    const recent = loadRecent();
    const recentSet = new Set(recent);
    const recentTokens = recent
      .map((id) => tokens.find((t) => t.id === id))
      .filter((t): t is TokenDefinition => Boolean(t));
    const others = tokens.filter((t) => !recentSet.has(t.id));
    return [...recentTokens, ...others];
  }, [tokens, query, isOpen]);

  useEffect(() => {
    setHighlight(0);
  }, [query, isOpen]);

  const close = () => {
    setTrigger(null);
    setQuery("");
  };

  const recomputePosition = (triggerIdx: number) => {
    if (!ref.current) return;
    const coords = getCaretCoordinates(ref.current, triggerIdx);
    setPos({
      top: coords.top - ref.current.scrollTop + coords.height + 2,
      left: coords.left - ref.current.scrollLeft,
    });
  };

  const updateFromCaret = (el: HTMLTextAreaElement | HTMLInputElement) => {
    if (trigger === null) return;
    const caret = el.selectionEnd ?? 0;
    if (caret <= trigger || el.value[trigger] !== "/") {
      close();
      return;
    }
    const between = el.value.slice(trigger + 1, caret);
    if (/\s/.test(between)) {
      close();
      return;
    }
    setQuery(between);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const el = e.target;
    const newVal = el.value;
    onChange(newVal);
    const caret = el.selectionEnd ?? newVal.length;
    if (trigger === null) {
      if (caret > 0 && newVal[caret - 1] === "/") {
        const prev = caret >= 2 ? newVal[caret - 2] : "";
        if (caret === 1 || /\s/.test(prev)) {
          const idx = caret - 1;
          setTrigger(idx);
          setQuery("");
          requestAnimationFrame(() => recomputePosition(idx));
        }
      }
    } else {
      if (newVal[trigger] !== "/") {
        close();
        return;
      }
      if (caret <= trigger) {
        close();
        return;
      }
      const between = newVal.slice(trigger + 1, caret);
      if (/\s/.test(between)) {
        close();
        return;
      }
      setQuery(between);
    }
  };

  const insertToken = (t: TokenDefinition) => {
    if (trigger === null || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionEnd ?? value.length;
    const before = value.slice(0, trigger);
    const after = value.slice(caret);
    const snippet = `{{${t.id}}}`;
    const next = `${before}${snippet}${after}`;
    onChange(next);
    const recent = loadRecent();
    saveRecent([t.id, ...recent.filter((id) => id !== t.id)]);
    close();
    requestAnimationFrame(() => {
      el.focus();
      const newCaret = before.length + snippet.length;
      try {
        el.setSelectionRange(newCaret, newCaret);
      } catch {
        /* noop */
      }
    });
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h + 1, filtered.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      const t = filtered[highlight];
      if (t) {
        e.preventDefault();
        insertToken(t);
      }
    }
  };

  const handleSelect: React.ReactEventHandler<HTMLTextAreaElement | HTMLInputElement> = (e) => {
    updateFromCaret(e.currentTarget);
  };

  const handleClick: React.MouseEventHandler<HTMLTextAreaElement | HTMLInputElement> = (e) => {
    updateFromCaret(e.currentTarget);
    const orig = (rest as { onClick?: React.MouseEventHandler }).onClick;
    orig?.(e);
  };

  const handleBlur: React.FocusEventHandler<HTMLTextAreaElement | HTMLInputElement> = (e) => {
    window.setTimeout(close, 150);
    const orig = (rest as { onBlur?: React.FocusEventHandler }).onBlur;
    orig?.(e);
  };

  const sharedProps = {
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onSelect: handleSelect,
    onClick: handleClick,
    onBlur: handleBlur,
  };

  return (
    <div className={cn("relative", containerClassName)}>
      {as === "input" ? (
        <Input
          ref={ref as React.RefObject<HTMLInputElement>}
          {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
          {...sharedProps}
        />
      ) : (
        <Textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          {...sharedProps}
        />
      )}
      {isOpen && (
        <div
          className="absolute z-50 w-72 rounded-md border bg-popover text-popover-foreground shadow-md max-h-72 overflow-y-auto"
          style={{ top: pos.top, left: pos.left }}
          data-testid="menu-slash-token"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="p-2 border-b text-xs text-muted-foreground flex items-center justify-between gap-2">
            <span className="truncate">
              {query ? `Filtering "${query}"` : (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Recently used &amp; all tokens</span>
              )}
            </span>
            <span className="shrink-0">{filtered.length}</span>
          </div>
          {filtered.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground" data-testid="text-slash-no-match">
              No tokens match.
            </div>
          )}
          {filtered.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertToken(t);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                "w-full text-left px-2 py-1.5 text-sm",
                i === highlight ? "bg-accent text-accent-foreground" : "",
              )}
              data-testid={`button-slash-token-${t.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{t.label}</span>
                <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                  {`{{${t.id}}}`}
                </Badge>
              </div>
              {t.description && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {t.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
