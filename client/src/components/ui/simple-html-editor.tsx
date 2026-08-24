import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Bold, Italic, List, ListOrdered, Link, Type, Code, Clock } from "lucide-react";
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
import { type TokenCatalogEntry as TokenDefinition } from "@shared/tokens";
import { escapeHtml, sanitizeHtml } from "@shared/utils/html";

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

/**
 * Imperative surface for hosts (e.g. the Template Studio token browser)
 * that need to insert a snippet at the editor's caret from outside.
 */
export interface SimpleHtmlEditorApi {
  insertText: (snippet: string) => void;
}

interface SimpleHtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Turn on token support: the `/` menu, and keeping `{{...}}` runs
   * parseable as the author formats and pastes around them.
   *
   * Only the Template Studio should pass this: the studio is the one place
   * a tokenized string is edited. Nothing enforces that — it is a
   * convention. Everywhere else this is a plain rich-text editor.
   */
  enableTokens?: boolean;
  /** The catalog for the slash menu; the host owns it. */
  tokens?: TokenDefinition[];
  minHeight?: number;
  disabled?: boolean;
  /** Receives the imperative insert API (insert snippet at last caret). */
  editorApiRef?: React.MutableRefObject<SimpleHtmlEditorApi | null>;
  "data-testid"?: string;
}

/**
 * What this editor lets an author write and what a reader is later shown
 * are two halves of one contract, so both are the SAME named policy:
 * `authored-document` in `shared/utils/html/policies.ts`. Change the
 * toolbar and that policy together, or an author gets a formatting
 * button whose output is stripped back out on render.
 *
 * (This used to be a hand-rolled DOM-walking sanitizer with its own
 * allowlist and href checks. It is DOMPurify now, under that policy.)
 */
const EDITOR_POLICY = "authored-document" as const;

function sanitizeEditorHtml(html: string): string {
  return sanitizeHtml(html, EDITOR_POLICY);
}

/**
 * A token is plain `{{...}}` text here, exactly as it is in raw-HTML
 * mode, so the author can edit one in place and copy one out. It used
 * to be an uneditable "chip", which is why old values may still carry
 * chip markup: read those back as their token text.
 */
function replaceLegacyChips(root: HTMLElement): void {
  root.querySelectorAll('span[data-token]').forEach((el) => {
    const id = el.getAttribute('data-token') || '';
    el.replaceWith(document.createTextNode(`{{${id}}}`));
  });
}

function legacyChipsToText(html: string): string {
  if (!html.includes('data-token')) return html;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  replaceLegacyChips(temp);
  return temp.innerHTML;
}

/**
 * The price of tokens being ordinary text is that ordinary text can be
 * formatted, pasted over, and autocorrected. Bolding a paragraph turns
 * `{{worker.field(name="id")}}` into `{{worker.<b>field</b>(...)}}`, and
 * a word processor turns its quotes curly — neither of which the token
 * grammar accepts, so the token would quietly deliver as literal text
 * rather than as anything the studio could flag. Flatten every token
 * run back to plain, straight-quoted text on the way out.
 *
 * A run never crosses a block boundary: `{{` on one line and `}}` on
 * the next is two pieces of the author's prose, not a token.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT',
  'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI',
  'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT',
  'TH', 'THEAD', 'TR', 'UL',
]);

/** A `{{...}}` run in the text, stopping at block boundaries (\u0000). */
const LOOSE_TOKEN_RUN = /\{\{([^{}\u0000]*)\}\}/g;

interface TextPiece {
  node: Text | null;
  text: string;
  start: number;
}

/** Text of the subtree in document order, block boundaries marked. */
function collectTextPieces(root: HTMLElement): TextPiece[] {
  const pieces: TextPiece[] = [];
  let offset = 0;
  const push = (node: Text | null, text: string) => {
    if (!text) return;
    pieces.push({ node, text, start: offset });
    offset += text.length;
  };
  const walk = (parent: Node) => {
    parent.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        push(child as Text, child.textContent || '');
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const isBlock = BLOCK_TAGS.has((child as Element).tagName);
      if (isBlock) push(null, '\u0000');
      walk(child);
      if (isBlock) push(null, '\u0000');
    });
  };
  walk(root);
  return pieces;
}

function normalizeTokenText(inner: string): string {
  return inner
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u00A0\u2007\u202F]/g, ' ');
}

/** The piece holding a global text index, found by binary search. */
function locate(pieces: TextPiece[], index: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const piece = pieces[mid];
    if (index < piece.start) {
      hi = mid - 1;
    } else if (index >= piece.start + piece.text.length) {
      lo = mid + 1;
    } else {
      return piece.node ? { node: piece.node, offset: index - piece.start } : null;
    }
  }
  return null;
}

function ancestorsWithin(node: Node, root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let el = node.parentNode;
  while (el && el !== root && el.nodeType === Node.ELEMENT_NODE) {
    out.push(el as HTMLElement);
    el = el.parentNode;
  }
  return out;
}

/** Markup the run was split across, left behind empty. */
function pruneEmptyInline(elements: HTMLElement[], root: HTMLElement): void {
  // An emptied text node still counts as a child, so test the text.
  const isEmptyInline = (el: HTMLElement) =>
    !BLOCK_TAGS.has(el.tagName) &&
    el.textContent === '' &&
    el.querySelector('br, img, hr, input, svg') === null;
  for (const el of elements) {
    let current: HTMLElement | null = el;
    while (current && current !== root && isEmptyInline(current)) {
      const parent = current.parentNode as HTMLElement | null;
      current.remove();
      current = parent;
    }
  }
}

/** Rewrite one run as plain, straight-quoted text. */
function flattenRun(root: HTMLElement, pieces: TextPiece[], run: RegExpExecArray): void {
  const start = locate(pieces, run.index);
  const end = locate(pieces, run.index + run[0].length - 1);
  if (!start || !end) return;
  const replacement = `{{${normalizeTokenText(run[1])}}}`;
  // Already one clean piece of text: leave the author's node alone.
  if (start.node === end.node && replacement === run[0]) return;
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
  } catch {
    return;
  }
  const touched = [
    ...ancestorsWithin(start.node, root),
    ...ancestorsWithin(end.node, root),
  ];
  range.deleteContents();
  range.insertNode(document.createTextNode(replacement));
  pruneEmptyInline(touched, root);
}

function flattenTokenRuns(root: HTMLElement): void {
  const pieces = collectTextPieces(root);
  const text = pieces.map((p) => p.text).join('');
  if (!text.includes('{{')) return;
  LOOSE_TOKEN_RUN.lastIndex = 0;
  const runs: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = LOOSE_TOKEN_RUN.exec(text)) !== null) runs.push(m);
  // Repair back to front: rewriting a run only touches nodes at or after
  // its own start, so every earlier run's node and offset stay valid and
  // one pass fixes the whole document, however many runs it holds.
  for (let i = runs.length - 1; i >= 0; i--) flattenRun(root, pieces, runs[i]);
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
  tokens: tokensProp,
  minHeight = 120,
  disabled = false,
  editorApiRef,
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

  // The catalog is the host's to supply. This editor never fetches one:
  // a token catalog is scoped to the thing being templated, and a
  // general-purpose editor has no way to know which scope it is in.
  const tokens = tokensProp ?? [];

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
      // Tokens are shown as the text they are; only stale chip markup
      // from the old editor needs converting on the way in.
      const rendered = sanitizeEditorHtml(
        enableTokens ? legacyChipsToText(value) : value,
      );
      if (editorRef.current.innerHTML !== rendered) {
        editorRef.current.innerHTML = rendered;
      }
    }
  }, [value, isFocused, rawMode, enableTokens]);

  useEffect(() => {
    if (!rawMode) {
      setRawHtml(value);
    }
  }, [value, rawMode]);

  // ── Imperative insert-at-cursor API (Template Studio token browser) ──
  // Track the last caret position in the rich editor so an external
  // insert (which happens after the editor loses focus to the browser
  // panel) still lands where the author was typing.
  const lastRichRangeRef = useRef<Range | null>(null);
  const saveRichSelection = useCallback(() => {
    const sel = window.getSelection();
    if (
      sel &&
      sel.rangeCount > 0 &&
      editorRef.current &&
      editorRef.current.contains(sel.getRangeAt(0).startContainer)
    ) {
      lastRichRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  useEffect(() => {
    if (!editorApiRef) return;
    editorApiRef.current = {
      insertText: (snippet: string) => {
        if (disabled) return;
        if (rawMode) {
          const el = rawTextareaRef.current;
          const start = el?.selectionStart ?? rawHtml.length;
          const end = el?.selectionEnd ?? rawHtml.length;
          const next = rawHtml.slice(0, start) + snippet + rawHtml.slice(end);
          setRawHtml(next);
          onChange(next);
          requestAnimationFrame(() => {
            if (!el) return;
            el.focus();
            const caret = start + snippet.length;
            try { el.setSelectionRange(caret, caret); } catch { /* noop */ }
          });
          return;
        }
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus();
        const sel = window.getSelection();
        const saved = lastRichRangeRef.current;
        if (sel && saved && editor.contains(saved.startContainer)) {
          sel.removeAllRanges();
          sel.addRange(saved);
        }
        // A token is text like any other snippet.
        document.execCommand("insertHTML", false, escapeHtml(snippet));
        saveRichSelection();
        handleInput();
      },
    };
    return () => {
      editorApiRef.current = null;
    };
  });

  const handleInput = () => {
    if (!editorRef.current) return;
    let serialized: string;
    if (enableTokens) {
      const clone = editorRef.current.cloneNode(true) as HTMLElement;
      replaceLegacyChips(clone);
      flattenTokenRuns(clone);
      clone.normalize();
      serialized = clone.innerHTML;
    } else {
      serialized = editorRef.current.innerHTML;
    }
    onChange(sanitizeEditorHtml(serialized));
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
    const snippet = t.insertText || `{{${t.id}}}`;

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
      const inserted = document.createTextNode(snippet);
      replace.insertNode(inserted);
      const after = document.createRange();
      after.setStartAfter(inserted);
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

  const handleEditorClick = () => {
    if (enableTokens) detectSlashRich();
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
          className="p-3 font-mono text-sm border-0 rounded-none focus-visible:ring-0 resize-y"
          style={{ minHeight }}
          disabled={disabled}
          data-testid={testId ? `${testId}-raw` : undefined}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable={!disabled}
          className={cn(
            "p-3 outline-none prose prose-sm max-w-none",
            "focus:ring-2 focus:ring-ring focus:ring-offset-0",
            !value && !isFocused && "text-muted-foreground"
          )}
          // resize: vertical makes the visual editor grow with the author's
          // content preference — same affordance as the raw-HTML textarea.
          style={{ minHeight, resize: "vertical", overflow: "auto" }}
          onInput={handleEditorInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            saveRichSelection();
            setIsFocused(false);
            if (enableTokens) window.setTimeout(closeSlash, 150);
          }}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={() => {
            saveRichSelection();
            if (enableTokens) detectSlashRich();
          }}
          onClick={(e) => {
            saveRichSelection();
            handleEditorClick();
          }}
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
