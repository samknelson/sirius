import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, List, ListOrdered, Link, Link2, Type, Code, Clock, Highlighter, Eraser, X } from "lucide-react";
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
import { type TokenPickerEntry as TokenDefinition } from "@shared/tokens";
import { escapeHtml, sanitizeHtml, normalizeTemplateHtml } from "@shared/utils/html";
import { TemplateDesignTools } from "./template-design-tools";
import { captureBookmark, restoreBookmark, TemplateEditorHistory } from "./template-editor-history";
import { imageFlowNode, moveImageInFlow, moveImageToRange, resizeImageBy, safeDesignUrl, setImageAlignment } from "./template-image-tools";
import { TemplateImageOverlay } from "./template-image-overlay";
import { insertAtSelection } from "./template-table-tools";

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
  /** Layout-preserving editing is only for email and postal message bodies. */
  templateMode?: "email" | "postal";
  /** Receives the imperative insert API (insert snippet at last caret). */
  editorApiRef?: React.MutableRefObject<SimpleHtmlEditorApi | null>;
  "data-testid"?: string;
  /** Host API adapter for uploads; should return the stored HTTPS image URL. */
  uploadImage?: (file: File) => Promise<string>;
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

/*
 * Editor-engine compatibility boundary (reviewed for task 700): neither a
 * default Tiptap/ProseMirror schema nor Lexical's registered-node HTML
 * converters promises round-trip preservation of arbitrary imported email
 * markup. Both need explicit schema/node work to retain nested table
 * structures and arbitrary inline/table CSS; custom tokenized attributes and
 * the postal page-break marker need explicit attribute serializers/nodes.
 * Switching from either engine to source would serialize its normalized
 * document, not recover the original source. Retain contentEditable + the
 * existing sanitized raw-HTML switch rather than imply lossless parity: raw
 * edits remain source text until visual mode applies the existing policy.
 */

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
  templateMode,
  editorApiRef,
  uploadImage,
  "data-testid": testId,
}: SimpleHtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [rawHtml, setRawHtml] = useState(value);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const contextRange = useRef<Range | null>(null);
  const [dropError, setDropError] = useState("");
  const [dropping, setDropping] = useState(false);
  const dropPending = useRef(false);
  const documentGeneration = useRef(0);
  useEffect(() => () => { documentGeneration.current++; }, []);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [menuImage, setMenuImage] = useState<HTMLImageElement | null>(null);
  const movingImage = useRef<HTMLImageElement | null>(null);
  const pointerMovingImage = useRef(false);
  const [imagePanelRequest, setImagePanelRequest] = useState(0);
  useEffect(() => {
    if (!templateMode || disabled) return;
    const refuseOutsideDrop = (event: DragEvent) => {
      if (movingImage.current && !editorRef.current?.contains(event.target as Node)) event.preventDefault();
    };
    document.addEventListener("dragover", refuseOutsideDrop, true);
    document.addEventListener("drop", refuseOutsideDrop, true);
    return () => {
      document.removeEventListener("dragover", refuseOutsideDrop, true);
      document.removeEventListener("drop", refuseOutsideDrop, true);
    };
  }, [templateMode, disabled]);
  const toolSelectionLocked = useRef(false);
  const history = useRef(new TemplateEditorHistory());
  useEffect(() => {
    if (!contextMenu) return;
    const frame = requestAnimationFrame(() => contextMenuRef.current?.querySelector("button")?.focus());
    const dismiss = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", dismiss); };
  }, [contextMenu]);
  const lastEmitted = useRef<string | null>(null);
  const representedDom = useRef<{ node: HTMLDivElement; value: string } | null>(null);
  const composing = useRef(false);
  const mutationDepth = useRef(0);
  const emit = (html: string) => {
    lastEmitted.current = html;
    if (editorRef.current && !rawMode) representedDom.current = { node: editorRef.current, value: html };
    onChange(html);
  };
  const cleanHtml = useCallback((html: string) => templateMode
    ? normalizeTemplateHtml(html, { preserveTokens: enableTokens })
    : sanitizeEditorHtml(html), [templateMode, enableTokens]);

  // HTML's attribute quoting cannot represent the quotes inside a token
  // verbatim. Protect attribute tokens only while the browser owns the DOM;
  // text tokens stay ordinary editable text.
  const attributeTokens = useRef(new Map<string, string>());
  const tokenMarkerPrefix = useRef(`sirius${crypto.randomUUID().replace(/-/g, "")}token`);
  const protectAttributeTokens = (html: string) => {
    const pending = new Map<string, string>();
    // Hide complete expressions before scanning tags: arguments may contain >.
    html = html.replace(/\{\{[^{}]*\}\}/g, (token) => {
      const marker = `${tokenMarkerPrefix.current}pending${pending.size}slot`;
      pending.set(marker, token);
      return marker;
    });
    html = html.replace(/<[^>]*>/g, (tag) => {
      for (const [temporary, token] of pending) {
        if (!tag.includes(temporary)) continue;
        const marker = Array.from(attributeTokens.current).find(([, original]) => original === token)?.[0]
          ?? `${tokenMarkerPrefix.current}${attributeTokens.current.size}slot`;
        attributeTokens.current.set(marker, token);
        tag = tag.split(temporary).join(marker);
      }
      return tag;
    });
    for (const [temporary, token] of pending) html = html.split(temporary).join(token);
    return html;
  };
  const restoreAttributeTokens = (html: string) => {
    for (const [marker, token] of attributeTokens.current) html = html.split(marker).join(token);
    return html;
  };

  // ───── Token picker state (only used when enableTokens) ─────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashPos, setSlashPos] = useState({ top: 0, left: 0 });
  const [highlight, setHighlight] = useState(0);
  const slashContext = useRef<{
    mode: "rich" | "raw" | "picker";
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
  useEffect(() => {
    if (!slashOpen || slashContext.current?.mode !== "picker") return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid^="button-slash-token-"]')?.focus());
  }, [slashOpen, filteredTokens]);

  const closeSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    slashContext.current = null;
  }, []);

  useEffect(() => {
    if (editorRef.current && !isFocused && !rawMode) {
      const editor = editorRef.current;
      if (templateMode && representedDom.current?.node === editor && representedDom.current.value === value) return;
      const ownEcho = lastEmitted.current === value;
      // An emitted value is only an echo until a host replacement arrives.
      // A later load of the same string must not be mistaken for that old echo.
      if (!ownEcho) lastEmitted.current = null;
      // Tokens are shown as the text they are; only stale chip markup
      // from the old editor needs converting on the way in.
      const cleaned = cleanHtml(
        enableTokens ? legacyChipsToText(value) : value,
      );
      const rendered = templateMode && enableTokens ? protectAttributeTokens(cleaned) : cleaned;
      if (editorRef.current.innerHTML !== rendered) {
        editorRef.current.innerHTML = rendered;
        lastRichRangeRef.current = null;
        setSelectedImage(null);
      }
      representedDom.current = { node: editor, value };
      if (templateMode) {
        if (!ownEcho) {
          documentGeneration.current++;
          dropPending.current = false;
          setDropping(false);
          setDropError("");
          history.current.reset({ html: rendered });
        }
        else if (history.current.entries[history.current.index]?.html !== rendered) history.current.push({ html: rendered });
        setSelectionVersion((version) => version + 1);
      }
      if (templateMode && history.current.index < 0) history.current.reset({ html: rendered });
    }
  }, [value, isFocused, rawMode, enableTokens, cleanHtml]);

  useEffect(() => {
    if (!rawMode) {
      setRawHtml(value);
    }
  }, [value, rawMode]);

  useEffect(() => {
    if (templateMode) setSelectionVersion((version) => version + 1);
  }, [rawMode, templateMode]);

  // ── Imperative insert-at-cursor API (Template Studio token browser) ──
  // Track the last caret position in the rich editor so an external
  // insert (which happens after the editor loses focus to the browser
  // panel) still lands where the author was typing.
  const lastRichRangeRef = useRef<Range | null>(null);
  const saveRichSelection = useCallback(() => {
    const sel = window.getSelection();
    // Moving focus into the sticky tool controls can collapse/clear the
    // browser's live selection. Keep the last editor bookmark in that case;
    // it is the range those controls are meant to act on.
    if (
      sel &&
      sel.rangeCount > 0 &&
      editorRef.current &&
      editorRef.current.contains(sel.getRangeAt(0).startContainer) &&
      editorRef.current.contains(sel.getRangeAt(0).endContainer)
    ) {
      // Synthetic/editor-scripted text selections can arrive while this
      // editor is still marked as blurred. They are authoritative; ignore
      // only the collapsed selection browsers report after toolbar focus.
      if (toolSelectionLocked.current && sel.getRangeAt(0).collapsed) return;
      lastRichRangeRef.current = sel.getRangeAt(0).cloneRange();
      if (templateMode) {
        const entry = history.current.entries[history.current.index];
        if (entry && entry.html === editorRef.current.innerHTML) entry.bookmark = captureBookmark(editorRef.current);
        setSelectionVersion((version) => version + 1);
      }
    }
  }, [templateMode]);

  useEffect(() => {
    if (!templateMode) return;
    document.addEventListener("selectionchange", saveRichSelection);
    return () => document.removeEventListener("selectionchange", saveRichSelection);
  }, [templateMode, saveRichSelection]);

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
          if (templateMode) history.current.push({
            html: enableTokens ? protectAttributeTokens(cleanHtml(next)) : cleanHtml(next), source: next,
          });
          emit(next);
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
        execCommand("insertHTML", escapeHtml(snippet));
      },
    };
    return () => {
      editorApiRef.current = null;
    };
  });

  const handleInput = (recordHistory = true) => {
    if (disabled || !editorRef.current || composing.current || mutationDepth.current > 0) return;
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
    if (templateMode && recordHistory) history.current.push({
      html: editorRef.current.innerHTML, bookmark: captureBookmark(editorRef.current),
    });
    emit(cleanHtml(restoreAttributeTokens(serialized)));
    saveRichSelection();
  };

  const execute = (mutation: () => void) => {
    if (disabled || rawMode || !editorRef.current) return;
    // Capture before focus(): some browsers move the selection on focus.
    const saved = lastRichRangeRef.current?.cloneRange();
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (saved && selection && editorRef.current?.contains(saved.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(saved);
    } else if (templateMode) {
      restoreBookmark(editorRef.current);
    }
    saveRichSelection();
    // execCommand dispatches input synchronously. Structural commands can
    // perform additional DOM changes after it returns; none of those
    // intermediate states may become an undo step or an emitted host value.
    mutationDepth.current++;
    try {
      mutation();
    } finally {
      mutationDepth.current--;
      if (mutationDepth.current === 0) {
        editorRef.current?.focus();
        saveRichSelection();
        handleInput();
      }
    }
  };

  const moveHistory = (delta: number) => {
    if (disabled) return;
    const snapshot = history.current.move(delta);
    if (!snapshot) return;
    if (rawMode) {
      const source = snapshot.source ?? cleanHtml(restoreAttributeTokens(snapshot.html));
      setRawHtml(source);
      emit(source);
      return;
    }
    if (!editorRef.current) return;
    editorRef.current.innerHTML = snapshot.html;
    setSelectedImage(null);
    editorRef.current.focus();
    restoreBookmark(editorRef.current, snapshot.bookmark);
    handleInput(false);
  };

  const execCommand = (command: string, value?: string) => {
    if (templateMode && (command === "undo" || command === "redo")) {
      moveHistory(command === "undo" ? -1 : 1);
      return;
    }
    execute(() => {
      if (templateMode) document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, value);
      if (templateMode) document.execCommand("styleWithCSS", false, "false");
    });
  };

  const handleCreateLink = () => {
    if (disabled) return;
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  };

  const openSelectionMenu = (left: number, top: number, image: HTMLImageElement | null = null) => {
    saveRichSelection();
    const range = lastRichRangeRef.current;
    if (!range || range.collapsed || !editorRef.current?.contains(range.startContainer) || !editorRef.current.contains(range.endContainer)) return;
    contextRange.current = range.cloneRange();
    toolSelectionLocked.current = true;
    setMenuImage(image);
    if (image) setSelectedImage(image);
    setContextMenu({ left: Math.max(8, Math.min(left, window.innerWidth - 210)), top: Math.max(8, Math.min(top, window.innerHeight - 340)) });
  };
  const restoreContextRange = () => {
    const range = contextRange.current;
    if (!range || !editorRef.current?.contains(range.startContainer) || !editorRef.current.contains(range.endContainer)) return;
    lastRichRangeRef.current = range.cloneRange();
  };
  const dismissSelectionMenu = () => {
    restoreContextRange();
    setContextMenu(null);
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && contextRange.current) {
      selection.removeAllRanges();
      selection.addRange(contextRange.current);
    }
    contextRange.current = null;
  };

  const handleInsertCharacter = (character: string) => {
    execCommand('insertHTML', character);
  };

  const toggleRawMode = () => {
    if (disabled) return;
    closeSlash();
    setSelectedImage(null);
    setContextMenu(null);
    if (rawMode) {
      const next = templateMode ? cleanHtml(rawHtml) : rawHtml;
      emit(next);
      setIsFocused(false);
      setRawMode(false);
    } else {
      setRawHtml(value);
      setRawMode(true);
    }
  };

  const handleRawHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const newValue = e.target.value;
    setRawHtml(newValue);
    if (templateMode) history.current.push({
      html: enableTokens ? protectAttributeTokens(cleanHtml(newValue)) : cleanHtml(newValue),
      source: newValue,
    });
    emit(newValue);
    if (enableTokens) detectSlashRaw(e.target);
  };

  const handleTemplatePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!templateMode || disabled) return;
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const source = html || (/<(?:!doctype|html|body|p|div|table|span|h[1-6]|img)\b/i.test(text)
      ? text : escapeHtml(text).replace(/\r?\n/g, "<br>"));
    const cleaned = cleanHtml(source);
    saveRichSelection();
    execCommand("insertHTML", enableTokens ? protectAttributeTokens(cleaned) : cleaned);
  };

  const dropLocalImage = async (event: React.DragEvent<HTMLDivElement>) => {
    const transfer = event.dataTransfer;
    // Existing-image moves are handled separately; never treat them as files.
    if (!templateMode || transfer.types.includes("text/template-image") || movingImage.current) return;
    if (!transfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled || rawMode) { setDropError("Switch to the enabled visual editor to drop an image."); return; }
    if (dropPending.current) { setDropError("Wait for the current image upload to finish."); return; }
    if (transfer.files.length !== 1 || !["image/png", "image/jpeg"].includes(transfer.files[0].type)) {
      setDropError("Drop one PNG or JPEG image."); return;
    }
    const file = transfer.files[0];
    if (!uploadImage) { setDropError("Image upload is not configured."); return; }
    const editor = editorRef.current;
    if (!editor) return;
    const point = (document as Document & { caretPositionFromPoint?: (x: number, y: number) =>
      { offsetNode: Node; offset: number } | null }).caretPositionFromPoint?.(event.clientX, event.clientY);
    const range = point ? document.createRange() : document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (point) range!.setStart(point.offsetNode, point.offset);
    if (!range || !editor.contains(range.startContainer)) {
      setDropError("Drop the image inside the template body."); return;
    }
    range.collapse(true);
    const generation = documentGeneration.current;
    dropPending.current = true;
    setDropping(true);
    setDropError("");
    try {
      const url = await uploadImage(file);
      if (!safeDesignUrl(url, true)) throw new Error("Image upload did not return a reusable HTTPS URL.");
      if (documentGeneration.current !== generation || editorRef.current !== editor ||
          !editor.isConnected || !editor.contains(range.startContainer)) return;
      lastRichRangeRef.current = range.cloneRange();
      execute(() => {
        const image = document.createElement("img");
        image.src = url;
        image.alt = file.name;
        image.style.maxWidth = "100%";
        insertAtSelection(editor, image);
      });
    } catch (error) {
      if (documentGeneration.current === generation && editor.isConnected)
        setDropError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      if (documentGeneration.current === generation) {
        dropPending.current = false;
        if (editor.isConnected) setDropping(false);
      }
    }
  };

  const placeImageAt = (image: HTMLImageElement, x: number, y: number, hit: Element | null) => {
    const editor = editorRef.current;
    if (!editor || !editor.contains(image) || !hit || !editor.contains(hit) ||
        hit.closest("img") === image || hit.closest("a") === imageFlowNode(image)) return;
    let range = document.caretRangeFromPoint?.(x, y);
    const table = hit.closest("table");
    if (table && editor.contains(table) && !hit.closest("td,th")) {
      range = document.createRange();
      if (y < table.getBoundingClientRect().top + table.getBoundingClientRect().height / 2) range.setStartBefore(table);
      else range.setStartAfter(table);
    }
    const otherImage = hit.closest("img");
    if (otherImage && otherImage !== image && editor.contains(otherImage)) {
      range = document.createRange();
      range.setStartBefore(imageFlowNode(otherImage));
    }
    if (!range || !editor.contains(range.startContainer) || imageFlowNode(image).contains(range.startContainer)) return;
    execute(() => moveImageToRange(editor, image, range));
    setSelectedImage(image);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (templateMode && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        e.preventDefault();
        moveHistory(key === "y" || e.shiftKey ? 1 : -1);
        return;
      }
    }
    if (composing.current || e.nativeEvent.isComposing) return;
    if (templateMode && !rawMode && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
      e.preventDefault();
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      const rect = range?.getBoundingClientRect() ?? editorRef.current?.getBoundingClientRect();
      if (rect) openSelectionMenu(rect.left + 12, rect.bottom + 4, selectedImage && editorRef.current?.contains(selectedImage) ? selectedImage : null);
      return;
    }
    if (templateMode && !rawMode) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const start = range?.startContainer;
      const node = start?.nodeType === Node.ELEMENT_NODE ? start as Element : start?.parentElement;
      const selectedChild = range && !range.collapsed && range.startContainer === range.endContainer &&
        range.endOffset === range.startOffset + 1 ? range.startContainer.childNodes[range.startOffset] : null;
      const image = selectedChild instanceof HTMLImageElement ? selectedChild : node?.closest("img") as HTMLImageElement | null;
      if (image && editorRef.current?.contains(image)) {
        if (e.key === "Enter" || e.key.toLowerCase() === "e") {
          e.preventDefault();
          image.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          execute(() => {
            const parent = image.parentElement;
            image.remove();
            if (parent?.tagName === "A" && !parent.childNodes.length) parent.remove();
          });
          return;
        }
        if (e.shiftKey && !e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          const deltaX = e.key === "ArrowRight" ? 10 : e.key === "ArrowLeft" ? -10 : 0;
          const deltaY = e.key === "ArrowDown" ? 10 : e.key === "ArrowUp" ? -10 : 0;
          execute(() => resizeImageBy(image, deltaX, deltaY));
          return;
        }
        if (e.altKey && !e.shiftKey && ["ArrowLeft", "ArrowUp", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          execute(() => {
            const align = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : "center";
            setImageAlignment(image, align);
          });
          return;
        }
        if (e.altKey && e.shiftKey && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          execute(() => {
            const backward = e.key === "ArrowUp" || e.key === "ArrowLeft";
            const flow = imageFlowNode(image);
            const sibling = backward ? flow.previousSibling : flow.nextSibling;
            if (sibling) moveImageInFlow(image, sibling, backward);
          });
          return;
        }
      }
    }
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
    if (templateMode && !rawMode) {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const node = range?.startContainer;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement;
      const cell = element?.closest("td,th");
      if (e.key === "Tab" && cell && editorRef.current?.contains(cell)) {
        const table = cell.closest("table");
        const cells = Array.from(table?.querySelectorAll("td,th") ?? [])
          .filter((item) => item.closest("table") === table);
        const target = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        if (target) {
          e.preventDefault();
          const next = document.createRange();
          next.selectNodeContents(target);
          next.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(next);
          saveRichSelection();
        }
        return;
      }
      // A selected break is a real, empty block, not persisted UI text.
      if (templateMode === "postal" && range && !range.collapsed &&
          (e.key === "Backspace" || e.key === "Delete") &&
          range.startContainer === range.endContainer &&
          range.endOffset === range.startOffset + 1) {
        const selected = range.startContainer.childNodes[range.startOffset];
        if (selected instanceof HTMLElement && selected.matches("[data-template-page-break]")) {
          e.preventDefault();
          execute(() => {
            selected.remove();
            range.collapse(true);
          });
          return;
        }
      }
      // Let the browser implement paragraphs, list splitting and Shift+Enter.
      return;
    }
    if (!rawMode && e.key === 'Enter' && !e.shiftKey) {
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
    setSlashPos({
      top: Math.max(8, Math.min(rect.bottom + 2, window.innerHeight - 300)),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 304)),
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
    const lines = before.split("\n");
    const lineIdx = lines.length - 1;
    const computed = window.getComputedStyle(el);
    const lineHeight = parseFloat(computed.lineHeight || "16") || 16;
    const paddingTop = parseFloat(computed.paddingTop || "0") || 0;
    const paddingLeft = parseFloat(computed.paddingLeft || "0") || 0;
    setSlashPos({
      top: Math.max(8, Math.min(elRect.top + paddingTop + (lineIdx + 1) * lineHeight - el.scrollTop + 2, window.innerHeight - 300)),
      left: Math.max(8, Math.min(elRect.left + paddingLeft, window.innerWidth - 304)),
    });
    slashContext.current = { mode: "raw", rawIndex };
    setSlashQuery(query);
    setSlashOpen(true);
  }, [enableTokens, closeSlash]);

  const insertTokenAtSlash = (t: TokenDefinition) => {
    if (disabled) return;
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
      if (templateMode) history.current.push({
        html: protectAttributeTokens(cleanHtml(next)), source: next,
      });
      emit(next);
      requestAnimationFrame(() => {
        el.focus();
        const newCaret = startIdx + snippet.length;
        try { el.setSelectionRange(newCaret, newCaret); } catch { /* noop */ }
      });
    } else if (ctx.mode === "picker" && editorRef.current) {
      const editor = editorRef.current;
      editor.focus();
      const selection = window.getSelection();
      const saved = lastRichRangeRef.current;
      if (selection && saved && editor.contains(saved.startContainer) && editor.contains(saved.endContainer)) {
        selection.removeAllRanges();
        selection.addRange(saved);
      }
      execCommand("insertHTML", escapeHtml(snippet));
    }

    const recent = loadRecent();
    saveRecent([t.id, ...recent.filter((id) => id !== t.id)]);
    closeSlash();
  };

  const handleEditorClick = () => {
    if (enableTokens) detectSlashRich();
  };

  const openToolbarAction = (action: string) => {
    const toolbar = containerRef.current?.querySelector<HTMLElement>("[data-template-design-toolbar]");
    if (!toolbar) return;
    if (action === "Font") {
      if (!toolbar.querySelector<HTMLSelectElement>('[aria-label="Font"]')) {
        toolbar.querySelector<HTMLButtonElement>('[aria-label="More formatting"]')?.click();
        requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('[aria-label="Font"]')?.focus());
      } else toolbar.querySelector<HTMLSelectElement>('[aria-label="Font"]')?.focus();
      return;
    }
    const trigger = toolbar.querySelector<HTMLButtonElement>(`[aria-label="${action === "Highlight hex" ? "Highlight color" : "Text color"}"]`);
    trigger?.click();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[aria-label="${action}"]`)?.focus());
  };

  const openTokenPicker = () => {
    if (!enableTokens || !editorRef.current) return;
    saveRichSelection();
    const range = lastRichRangeRef.current;
    if (!range || !editorRef.current.contains(range.startContainer) || !editorRef.current.contains(range.endContainer)) return;
    slashContext.current = { mode: "picker" };
    setSlashQuery("");
    setSlashPos({
      top: Math.max(8, Math.min(range.getBoundingClientRect().bottom + 2, window.innerHeight - 300)),
      left: Math.max(8, Math.min(range.getBoundingClientRect().left, window.innerWidth - 304)),
    });
    setSlashOpen(true);
  };

  const handleEditorInput = () => {
    handleInput();
    if (enableTokens) {
      requestAnimationFrame(() => detectSlashRich());
    }
  };

  return (
    <div ref={containerRef} className={cn("relative border border-input rounded-md", className)}
      onMouseDownCapture={event => {
        const target = event.target as Node;
        if (editorRef.current?.contains(target)) return;
        saveRichSelection();
        toolSelectionLocked.current = true;
      }}
      onFocusCapture={event => {
        const target = event.target as Node;
        if (editorRef.current?.contains(target)) toolSelectionLocked.current = false;
        else if (containerRef.current?.contains(target)) toolSelectionLocked.current = true;
      }}>
      {/* Toolbar */}
      {templateMode && !rawMode && (
        <TemplateDesignTools editor={editorRef.current} disabled={disabled}
          mode={templateMode} execute={execute} command={execCommand}
          selectionVersion={selectionVersion} uploadImage={uploadImage}
          imagePanelRequest={imagePanelRequest}
          undo={() => moveHistory(-1)} redo={() => moveHistory(1)}
          canUndo={history.current.index > 0} canRedo={history.current.index < history.current.entries.length - 1}
          toggleRaw={toggleRawMode}
          insertPageBreak={() => execCommand("insertHTML", '<div data-template-page-break="true" style="break-before: page;"></div><p><br></p>')}
          openTokenPicker={enableTokens ? openTokenPicker : undefined}
          testId={testId} />
      )}
      {(!templateMode || rawMode) && <fieldset disabled={disabled} className={cn("flex flex-wrap items-center gap-1 p-2 border-b border-border bg-muted/30 min-w-0", templateMode && "sticky top-0 z-20 h-[46px] flex-nowrap px-1.5 py-0")}
        onMouseDown={(event) => { if (!rawMode) event.preventDefault(); }}>
        {templateMode && (
          <>
            <Button type="button" variant="ghost" size="sm"
              aria-label="Undo" title="Undo (Ctrl/⌘ Z)"
              disabled={disabled || history.current.index <= 0}
              onClick={() => moveHistory(-1)}
              data-testid={testId ? `${testId}-undo` : undefined}>
              Undo
            </Button>
            <Button type="button" variant="ghost" size="sm"
              aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)"
              disabled={disabled || history.current.index >= history.current.entries.length - 1}
              onClick={() => moveHistory(1)}
              data-testid={testId ? `${testId}-redo` : undefined}>
              Redo
            </Button>
          </>
        )}
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
            {templateMode === "postal" && (
              <Button type="button" variant="ghost" size="sm" disabled={disabled}
                onClick={() => execCommand("insertHTML", '<div data-template-page-break="true" style="break-before: page;"></div><p><br></p>')}
                data-testid={testId ? `${testId}-page-break` : undefined}>
                Insert page break
              </Button>
            )}
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
      </fieldset>}

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
          style={{
            minHeight, resize: "vertical", overflow: "auto",
            // A neutral email-safe writing baseline, not serialized into the
            // template's HTML. Explicit formatting inside a template still wins.
            ...(templateMode ? { fontFamily: "Arial, sans-serif", fontSize: "14px" } : {}),
          }}
          onInput={handleEditorInput}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; handleEditorInput(); }}
          onBeforeInput={(event) => {
            if (!templateMode) return;
            const inputType = (event.nativeEvent as InputEvent).inputType;
            if (inputType === "historyUndo" || inputType === "historyRedo") {
              event.preventDefault();
              moveHistory(inputType === "historyUndo" ? -1 : 1);
            } else {
              saveRichSelection();
            }
          }}
          onPaste={handleTemplatePaste}
          onPointerDown={event => {
            if (!templateMode || disabled || event.button !== 0 || !(event.target instanceof HTMLImageElement)) return;
            const image = event.target;
            event.preventDefault(); // Avoid contentEditable's native move of only the img inside an <a>.
            pointerMovingImage.current = true;
            const startX = event.clientX;
            const startY = event.clientY;
            let moved = false;
            const move = (next: PointerEvent) => {
              if (next.pointerId === event.pointerId && Math.hypot(next.clientX - startX, next.clientY - startY) > 6) moved = true;
            };
            const finish = (next: PointerEvent) => {
              if (next.pointerId !== event.pointerId) return;
              cleanup();
              if (next.type === "pointerup" && moved) placeImageAt(image, next.clientX, next.clientY, document.elementFromPoint(next.clientX, next.clientY));
            };
            const cancel = (next: KeyboardEvent) => {
              if (next.key === "Escape") { next.preventDefault(); cleanup(); }
            };
            const cleanup = () => {
              pointerMovingImage.current = false;
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", finish);
              window.removeEventListener("pointercancel", finish);
              window.removeEventListener("keydown", cancel, true);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", finish);
            window.addEventListener("pointercancel", finish);
            window.addEventListener("keydown", cancel, true);
          }}
          onDragStart={event => {
            if (!templateMode || disabled) return;
            if (pointerMovingImage.current) { event.preventDefault(); return; }
            const target = event.target as HTMLElement;
            const image = target instanceof HTMLImageElement ? target
              : target.closest("a")?.querySelector("img");
            if (!image || !editorRef.current?.contains(image)) return;
            movingImage.current = image;
            setSelectedImage(image);
            event.dataTransfer.setData("text/template-image", "move");
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={event => {
            if (templateMode && event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = disabled || rawMode ? "none" : "copy";
              return;
            }
            if (movingImage.current && !event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={event => {
            if (event.dataTransfer.types.includes("Files")) {
              void dropLocalImage(event);
              return;
            }
            const image = movingImage.current;
            if (!image || event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            movingImage.current = null;
            placeImageAt(image, event.clientX, event.clientY, event.target as Element);
          }}
          onDragEnd={() => { movingImage.current = null; }}
          onContextMenu={event => {
            if (!templateMode || disabled) return;
            event.preventDefault();
            const image = event.target instanceof HTMLImageElement ? event.target : null;
            if (image) {
              const range = document.createRange();
              range.selectNode(image);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
            }
            openSelectionMenu(event.clientX, event.clientY, image);
          }}
          data-template-editor={templateMode}
          onFocus={() => { toolSelectionLocked.current = false; setIsFocused(true); }}
          onBlur={() => {
            saveRichSelection();
            toolSelectionLocked.current = true;
            setIsFocused(false);
            if (enableTokens) window.setTimeout(closeSlash, 150);
          }}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={() => {
            saveRichSelection();
            if (enableTokens) detectSlashRich();
          }}
          onMouseUp={saveRichSelection}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (templateMode && target instanceof HTMLImageElement) e.preventDefault();
            const pageBreak = target.closest("[data-template-page-break]");
            const selectedObject = templateMode && target.tagName === "IMG"
              ? target
              : templateMode === "postal" ? pageBreak : null;
            if (!disabled && selectedObject && editorRef.current?.contains(selectedObject)) {
              const range = document.createRange();
              range.selectNode(selectedObject);
              window.getSelection()?.removeAllRanges();
              window.getSelection()?.addRange(range);
            }
            if (templateMode) setSelectedImage(!disabled && selectedObject instanceof HTMLImageElement ? selectedObject : null);
            saveRichSelection();
            handleEditorClick();
          }}
          data-placeholder={placeholder}
          data-testid={testId}
          suppressContentEditableWarning
        />
      )}
      {templateMode && !rawMode && !disabled && selectedImage && editorRef.current?.contains(selectedImage) && containerRef.current &&
        <TemplateImageOverlay image={selectedImage} editor={editorRef.current} container={containerRef.current} execute={execute} />}
      {templateMode && !rawMode && (dropError || dropping) && (
        <p role={dropError ? "alert" : "status"} className={cn("px-3 py-1 text-xs", dropError && "text-destructive")}>
          {dropError || "Uploading image…"}
        </p>
      )}

      {contextMenu && templateMode && !rawMode && !disabled && (() => {
        // Radix Dialog disables pointer interaction outside its content.
        // Place both editor menus inside it, without opening the rest of the page.
        const dialog = containerRef.current?.closest<HTMLElement>('[data-testid="dialog-template-studio"]');
        const bounds = dialog?.getBoundingClientRect();
        const row = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none";
        const item = (label: string, icon: React.ReactNode, action: () => void) =>
          <button key={label} type="button" role="menuitem" className={row}
            onClick={() => { restoreContextRange(); setContextMenu(null); action(); }}>{icon}<span>{label}</span></button>;
        return createPortal(<div ref={contextMenuRef} role="menu" aria-label={menuImage ? "Image actions" : "Editor selection actions"}
          className={`${dialog ? "absolute" : "fixed"} z-[120] max-h-[70vh] min-w-48 overflow-auto rounded-md border bg-popover p-1 shadow-md`}
          style={{ left: contextMenu.left - (bounds?.left ?? 0), top: contextMenu.top - (bounds?.top ?? 0), maxWidth: "calc(100vw - 16px)" }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              dismissSelectionMenu();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const items = Array.from(contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }} onMouseDown={event => event.preventDefault()}>
          {menuImage && editorRef.current?.contains(menuImage) ? <>
            {(["left", "center", "right"] as const).map(align =>
              <button key={align} type="button" role="menuitem"
                aria-label={`Align ${align}`}
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  execute(() => setImageAlignment(menuImage, align));
                  setContextMenu(null);
                }}>Align {align}</button>)}
            {(["Edit image", "Replace image"] as const).map(label =>
              <button key={label} type="button" role="menuitem"
                aria-label={label}
                className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  const range = document.createRange();
                  range.selectNode(menuImage);
                  const selection = window.getSelection();
                  selection?.removeAllRanges();
                  selection?.addRange(range);
                  setSelectedImage(menuImage);
                  setImagePanelRequest(value => value + 1);
                  setContextMenu(null);
                }}>{label}</button>)}
            <button type="button" role="menuitem" aria-label="Delete image" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                execute(() => {
                  const parent = menuImage.parentElement;
                  menuImage.remove();
                  if (parent?.tagName === "A" && !parent.childNodes.length) parent.remove();
                });
                setSelectedImage(null);
                setContextMenu(null);
              }}>Delete image</button>
          </> : <>
          {item("Bold", <Bold className="h-4 w-4 shrink-0" />, () => execCommand("bold"))}
          {item("Italic", <Italic className="h-4 w-4 shrink-0" />, () => execCommand("italic"))}
          {item("Bulleted list", <List className="h-4 w-4 shrink-0" />, () => execCommand("insertUnorderedList"))}
          {item("Numbered list", <ListOrdered className="h-4 w-4 shrink-0" />, () => execCommand("insertOrderedList"))}
          {item("Insert link", <Link2 className="h-4 w-4 shrink-0" />, handleCreateLink)}
          {item("Font…", <Type className="h-4 w-4 shrink-0" />, () => openToolbarAction("Font"))}
          {item("Text color…", <span aria-hidden="true" className="relative w-4 text-center font-semibold leading-none">A<span className="absolute -bottom-1 left-0 h-0.5 w-full bg-blue-600" /></span>, () => openToolbarAction("Text color hex"))}
          {item("Highlight color…", <Highlighter className="h-4 w-4 shrink-0" />, () => openToolbarAction("Highlight hex"))}
          {item("Clear formatting", <Eraser className="h-4 w-4 shrink-0" />, () => execCommand("removeFormat"))}
          </>}
          <button type="button" role="menuitem" className={row} onClick={dismissSelectionMenu}><X className="h-4 w-4 shrink-0" /><span>Close</span></button>
        </div>, dialog ?? document.body);
      })()}

      {enableTokens && slashOpen && (
        createPortal(<div
          className="fixed z-[120] w-[min(18rem,calc(100vw-1rem))] rounded-md border bg-popover text-popover-foreground shadow-md max-h-[min(70vh,18rem)] overflow-y-auto"
          style={{ top: slashPos.top, left: slashPos.left }}
          data-testid="menu-slash-token"
          tabIndex={-1}
          onKeyDown={event => {
            if (slashContext.current?.mode !== "picker") return;
            if (event.key === "Escape") {
              event.preventDefault();
              closeSlash();
              containerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Insert"]')?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight(h => filteredTokens.length ? Math.min(h + 1, filteredTokens.length - 1) : 0);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight(h => Math.max(h - 1, 0));
            } else if (event.key === "Enter" || event.key === "Tab") {
              const token = filteredTokens[highlight];
              if (token) {
                event.preventDefault();
                insertTokenAtSlash(token);
              }
            }
          }}
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
        </div>, document.body)
      )}

      <style>{`
        [data-template-editor] table { border-collapse: collapse; }
        [data-template-editor] td, [data-template-editor] th { min-width: 2em; }
        [data-template-editor] img { max-width: 100%; }
        [data-template-editor="postal"] [data-template-page-break]::before {
          content: "Page break";
          display: block;
          border-top: 1px dashed #888;
          color: #666;
          font: 11px sans-serif;
          margin: 12px 0;
        }
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: var(--muted-foreground);
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
          color: var(--primary);
          text-decoration: underline;
        }
        [contenteditable] a:hover {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}
