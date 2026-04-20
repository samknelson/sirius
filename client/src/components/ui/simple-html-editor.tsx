import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Bold, Italic, List, ListOrdered, Link, Type, Code, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { TokenDefinition } from "@shared/bulk-tokens";

const SPECIAL_CHARACTERS = [
  { name: 'Copyright', symbol: '©' },
  { name: 'Registered', symbol: '®' },
  { name: 'Trademark', symbol: '™' },
  { name: 'Bullet', symbol: '•' },
  { name: 'En dash', symbol: '–' },
  { name: 'Em dash', symbol: '—' },
  { name: 'Left quote', symbol: '\u201C' },
  { name: 'Right quote', symbol: '\u201D' },
  { name: 'Left single quote', symbol: '\u2018' },
  { name: 'Right single quote', symbol: '\u2019' },
  { name: 'Ellipsis', symbol: '…' },
  { name: 'Section', symbol: '§' },
  { name: 'Paragraph', symbol: '¶' },
  { name: 'Degree', symbol: '°' },
];

interface SimpleHtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  enableTokens?: boolean;
  minHeight?: number;
  "data-testid"?: string;
}

const ALLOWED_TAGS = ['strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'p', 'a'];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  'a': ['href', 'target', 'rel']
};

function sanitizeHtml(html: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = html;

  function cleanNode(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      if (!ALLOWED_TAGS.includes(tagName)) {
        while (element.firstChild) {
          element.parentNode?.insertBefore(element.firstChild, element);
        }
        element.remove();
        return;
      }

      const allowedAttrs = ALLOWED_ATTRIBUTES[tagName] || [];
      Array.from(element.attributes).forEach(attr => {
        if (!allowedAttrs.includes(attr.name)) {
          element.removeAttribute(attr.name);
        }
      });
    }

    Array.from(node.childNodes).forEach(child => cleanNode(child));
  }

  Array.from(temp.childNodes).forEach(child => cleanNode(child));
  return temp.innerHTML;
}

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

export function SimpleHtmlEditor({
  value,
  onChange,
  placeholder,
  className,
  enableTokens = false,
  minHeight = 120,
  "data-testid": testId,
}: SimpleHtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [rawHtml, setRawHtml] = useState(value);

  // ───── Token picker state (only used when enableTokens) ─────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [highlight, setHighlight] = useState(0);
  const slashContext = useRef<{
    mode: "rich" | "raw";
    // For rich mode: the text node + offset where '/' sits
    node?: Node;
    slashOffset?: number;
    // For raw mode: index into the raw textarea value where '/' sits
    rawIndex?: number;
  } | null>(null);

  const { data: tokenData } = useQuery<{ tokens: TokenDefinition[] }>({
    queryKey: ["/api/bulk-tokens"],
    enabled: enableTokens,
  });
  const tokens = tokenData?.tokens || [];

  const filteredTokens = useMemo<TokenDefinition[]>(() => {
    if (!slashOpen) return [];
    const q = slashQuery.trim().toLowerCase();
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
  }, [tokens, slashQuery, slashOpen]);

  useEffect(() => {
    setHighlight(0);
  }, [slashQuery, slashOpen]);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    slashContext.current = null;
  }, []);

  useEffect(() => {
    if (editorRef.current && !isFocused && !rawMode) {
      const sanitized = sanitizeHtml(value);
      if (editorRef.current.innerHTML !== sanitized) {
        editorRef.current.innerHTML = sanitized;
      }
    }
  }, [value, isFocused, rawMode]);

  useEffect(() => {
    if (!rawMode) {
      setRawHtml(value);
    }
  }, [value, rawMode]);

  const handleInput = () => {
    if (editorRef.current) {
      const sanitized = sanitizeHtml(editorRef.current.innerHTML);
      onChange(sanitized);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const handleCreateLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  };

  const handleInsertCharacter = (character: string) => {
    document.execCommand('insertHTML', false, character);
    editorRef.current?.focus();
    handleInput();
  };

  const toggleRawMode = () => {
    closeSlash();
    if (rawMode) {
      onChange(rawHtml);
      setRawMode(false);
    } else {
      setRawHtml(value);
      setRawMode(true);
    }
  };

  const handleRawHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setRawHtml(newValue);
    onChange(newValue);
    if (enableTokens) detectSlashRaw(e.target);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if (enableTokens && slashOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlash();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (filteredTokens.length === 0 ? 0 : Math.min(h + 1, filteredTokens.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const t = filteredTokens[highlight];
        if (t) {
          e.preventDefault();
          insertTokenAtSlash(t);
          return;
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertHTML', false, '<br><br>');
      handleInput();
    }
  };

  // Detect "/word" pattern at the caret in the contentEditable.
  const detectSlashRich = useCallback(() => {
    if (!enableTokens || !editorRef.current || !containerRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      closeSlash();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.startContainer)) {
      closeSlash();
      return;
    }
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      closeSlash();
      return;
    }
    const offset = range.startOffset;
    const before = (node.textContent || "").slice(0, offset);
    const m = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!m) {
      closeSlash();
      return;
    }
    const query = m[1];
    const slashOffset = offset - query.length - 1;

    // Position the menu using a zero-width range at the slash.
    const probe = document.createRange();
    probe.setStart(node, slashOffset);
    probe.setEnd(node, slashOffset);
    const rect = probe.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    setSlashPos({
      top: rect.bottom - containerRect.top + 2,
      left: rect.left - containerRect.left,
    });
    slashContext.current = { mode: "rich", node, slashOffset };
    setSlashQuery(query);
    setSlashOpen(true);
  }, [enableTokens, closeSlash]);

  const detectSlashRaw = useCallback((el: HTMLTextAreaElement) => {
    if (!enableTokens || !containerRef.current) return;
    const caret = el.selectionEnd ?? 0;
    const before = el.value.slice(0, caret);
    const m = before.match(/(?:^|\s)\/([^\s/]*)$/);
    if (!m) {
      closeSlash();
      return;
    }
    const query = m[1];
    const rawIndex = caret - query.length - 1;

    // Approximate caret position relative to the textarea.
    const elRect = el.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const lines = before.split("\n");
    const lineIdx = lines.length - 1;
    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight || "16") || 16;
    const paddingTop = parseFloat(computed.paddingTop || "0") || 0;
    const paddingLeft = parseFloat(computed.paddingLeft || "0") || 0;
    setSlashPos({
      top: elRect.top - containerRect.top + paddingTop + (lineIdx + 1) * lineHeight - el.scrollTop + 2,
      left: elRect.left - containerRect.left + paddingLeft,
    });
    slashContext.current = { mode: "raw", rawIndex };
    setSlashQuery(query);
    setSlashOpen(true);
  }, [enableTokens, closeSlash]);

  const insertTokenAtSlash = (t: TokenDefinition) => {
    const ctx = slashContext.current;
    if (!ctx) return;
    const snippet = `{{${t.id}}}`;

    if (ctx.mode === "rich" && ctx.node && typeof ctx.slashOffset === "number") {
      const sel = window.getSelection();
      if (!sel) return;
      const node = ctx.node;
      const startOffset = ctx.slashOffset;
      const endOffset = startOffset + 1 + slashQuery.length;
      const replace = document.createRange();
      try {
        replace.setStart(node, startOffset);
        replace.setEnd(node, Math.min(endOffset, (node.textContent || "").length));
      } catch {
        return;
      }
      replace.deleteContents();
      const textNode = document.createTextNode(snippet);
      replace.insertNode(textNode);
      const after = document.createRange();
      after.setStartAfter(textNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      handleInput();
    } else if (ctx.mode === "raw" && typeof ctx.rawIndex === "number" && rawTextareaRef.current) {
      const el = rawTextareaRef.current;
      const startIdx = ctx.rawIndex;
      const endIdx = startIdx + 1 + slashQuery.length;
      const next = rawHtml.slice(0, startIdx) + snippet + rawHtml.slice(endIdx);
      setRawHtml(next);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        const newCaret = startIdx + snippet.length;
        try { el.setSelectionRange(newCaret, newCaret); } catch { /* noop */ }
      });
    }

    const recent = loadRecent();
    saveRecent([t.id, ...recent.filter((id) => id !== t.id)]);
    closeSlash();
  };

  const handleEditorInput = () => {
    handleInput();
    if (enableTokens) {
      requestAnimationFrame(() => detectSlashRich());
    }
  };

  return (
    <div ref={containerRef} className={cn("relative border border-input rounded-md", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/30">
        {!rawMode && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('bold')}
              title="Bold"
              data-testid={testId ? `${testId}-bold` : undefined}
            >
              <Bold size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('italic')}
              title="Italic"
              data-testid={testId ? `${testId}-italic` : undefined}
            >
              <Italic size={16} />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('insertUnorderedList')}
              title="Bullet List"
              data-testid={testId ? `${testId}-ul` : undefined}
            >
              <List size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('insertOrderedList')}
              title="Numbered List"
              data-testid={testId ? `${testId}-ol` : undefined}
            >
              <ListOrdered size={16} />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleCreateLink}
              title="Insert Link"
              data-testid={testId ? `${testId}-link` : undefined}
            >
              <Link size={16} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="Special Characters"
                  data-testid={testId ? `${testId}-special` : undefined}
                >
                  <Type size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {SPECIAL_CHARACTERS.map((char) => (
                  <DropdownMenuItem
                    key={char.symbol}
                    onClick={() => handleInsertCharacter(char.symbol)}
                    data-testid={testId ? `${testId}-char-${char.name.toLowerCase().replace(/\s/g, '-')}` : undefined}
                  >
                    <span className="font-mono text-lg mr-2">{char.symbol}</span>
                    <span className="text-sm">{char.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="w-px h-6 bg-border mx-1" />
          </>
        )}
        <Button
          type="button"
          variant={rawMode ? "default" : "ghost"}
          size="sm"
          className="h-8 px-2"
          onClick={toggleRawMode}
          title={rawMode ? "Switch to Visual Editor" : "Switch to Raw HTML"}
          data-testid={testId ? `${testId}-raw-mode` : undefined}
        >
          <Code size={16} className="mr-1" />
          <span className="text-xs">{rawMode ? "Visual" : "HTML"}</span>
        </Button>
        {enableTokens && (
          <span className="ml-auto text-xs text-muted-foreground hidden sm:inline">Type <kbd className="rounded border bg-background px-1 py-0.5 font-mono text-[10px]">/</kbd> to insert a token</span>
        )}
      </div>

      {/* Editor */}
      {rawMode ? (
        <Textarea
          ref={rawTextareaRef}
          value={rawHtml}
          onChange={handleRawHtmlChange}
          onKeyDown={handleEditorKeyDown}
          onSelect={(e) => enableTokens && detectSlashRaw(e.currentTarget)}
          onClick={(e) => enableTokens && detectSlashRaw(e.currentTarget)}
          onBlur={() => enableTokens && window.setTimeout(closeSlash, 150)}
          placeholder="Enter raw HTML here..."
          className="p-3 font-mono text-sm border-0 rounded-none focus-visible:ring-0 resize-none"
          style={{ minHeight }}
          data-testid={testId ? `${testId}-raw` : undefined}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          className={cn(
            "p-3 outline-none prose prose-sm max-w-none",
            "focus:ring-2 focus:ring-ring focus:ring-offset-0",
            !value && !isFocused && "text-muted-foreground"
          )}
          style={{ minHeight }}
          onInput={handleEditorInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            if (enableTokens) window.setTimeout(closeSlash, 150);
          }}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={() => enableTokens && detectSlashRich()}
          onClick={() => enableTokens && detectSlashRich()}
          data-placeholder={placeholder}
          data-testid={testId}
          suppressContentEditableWarning
        />
      )}

      {enableTokens && slashOpen && (
        <div
          className="absolute z-50 w-72 rounded-md border bg-popover text-popover-foreground shadow-md max-h-72 overflow-y-auto"
          style={{ top: slashPos.top, left: slashPos.left }}
          data-testid="menu-slash-token"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="p-2 border-b text-xs text-muted-foreground flex items-center justify-between gap-2">
            <span className="truncate">
              {slashQuery ? `Filtering "${slashQuery}"` : (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Recently used &amp; all tokens</span>
              )}
            </span>
            <span className="shrink-0">{filteredTokens.length}</span>
          </div>
          {filteredTokens.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground" data-testid="text-slash-no-match">
              No tokens match.
            </div>
          )}
          {filteredTokens.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertTokenAtSlash(t);
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

      <style>{`
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          position: absolute;
        }
        [contenteditable] {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        [contenteditable] strong,
        [contenteditable] b {
          font-weight: 600;
        }
        [contenteditable] em,
        [contenteditable] i {
          font-style: italic;
        }
        [contenteditable] ul,
        [contenteditable] ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        [contenteditable] li {
          margin: 0.25rem 0;
        }
        [contenteditable] a {
          color: hsl(var(--primary));
          text-decoration: underline;
        }
        [contenteditable] a:hover {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}
