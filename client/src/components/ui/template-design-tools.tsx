import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Braces, ChevronDown, Columns2, Highlighter, ImageIcon, Italic, Link2, List, ListOrdered, MoreHorizontal, MousePointer2, Redo2, Table2, Type, Underline, Undo2 } from "lucide-react";
import { TemplateImageTools, safeDesignUrl } from "./template-image-tools";
import { clearTemplateFormatting, removeTemplateLink } from "./template-text-tools";
import { editTable, insertAtSelection, makeTable, tableRows, TEMPLATE_FONTS, TEMPLATE_SIZES, TEMPLATE_TEXT_COLORS, TEMPLATE_CELL_COLORS, type TableOperation } from "./template-table-tools";

export interface TemplateDesignToolsProps {
  editor: HTMLDivElement | null;
  disabled: boolean;
  mode: "email" | "postal";
  execute: (mutation: () => void) => void;
  command: (name: string, value?: string) => void;
  selectionVersion: number;
  uploadImage?: (file: File) => Promise<string>;
  imagePanelRequest?: number;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  toggleRaw?: () => void;
  insertPageBreak?: () => void;
  openTokenPicker?: () => void;
  testId?: string;
}

const control = "h-8 rounded border bg-background px-2 text-xs";
const blockSelector = "p,div,h1,h2,h3,h4,h5,h6,li,td,th,blockquote";

/** Inline formatting intentionally requires a non-collapsed selection. */
export function selectedInlineTextNodes(editor: HTMLElement, range: Range): Text[] | null {
  if (range.collapsed || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

/** Selection is observed only inside this editor; focusing a control keeps its target. */
export function TemplateDesignTools({ editor, disabled, mode, execute, command, selectionVersion, uploadImage,
  imagePanelRequest, undo, redo, canUndo = true, canRedo = true, toggleRaw, insertPageBreak, openTokenPicker, testId }: TemplateDesignToolsProps) {
  const toolbarRef = useRef<HTMLFieldSetElement>(null);
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imagePanel = useRef<HTMLDetailsElement>(null);
  const [format, setFormat] = useState<Record<string, string>>({
    block: "p", fontFamily: "Arial, sans-serif", fontSize: "14px",
  });
  const [active, setActive] = useState<Record<string, boolean | "mixed">>({});
  const [error, setError] = useState("");
  const [rows, setRows] = useState("2");
  const [columns, setColumns] = useState("2");
  const [tableWidth, setTableWidth] = useState("100");
  const [padding, setPadding] = useState("12");
  const [border, setBorder] = useState("1");
  const [background, setBackground] = useState("#ffffff");
  const [vertical, setVertical] = useState("top");
  const [buttonText, setButtonText] = useState("");
  const [buttonLink, setButtonLink] = useState("");
  const [buttonColor, setButtonColor] = useState("#2563eb");
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [draftColor, setDraftColor] = useState("#000000");
  const [draftHighlight, setDraftHighlight] = useState("#ffffff");
  const [colorDraftEdited, setColorDraftEdited] = useState(false);
  const [highlightDraftEdited, setHighlightDraftEdited] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertExpanded, setInsertExpanded] = useState(false);
  const [compact, setCompact] = useState(true);
  const [ultraCompact, setUltraCompact] = useState(false);
  const [promotedCount, setPromotedCount] = useState(0);
  const lastSelection = useRef<Range | null>(null);
  useEffect(() => {
    // The editor can be much narrower than the viewport in the Studio's
    // two-column layout. Collapse against its actual available width.
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const update = () => {
      setCompact(toolbar.clientWidth < 730);
      setUltraCompact(toolbar.clientWidth < 375);
    };
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, []);
  // Count only the *other* visible controls. Measuring scrollWidth after
  // promotion would oscillate when a control crosses the fit boundary.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const update = () => {
      const core = Array.from(toolbar.children).filter(child =>
        child !== toolbar.querySelector("[data-promoted-tools]") &&
        getComputedStyle(child).position !== "absolute" &&
        child.getBoundingClientRect().width > 0);
      const css = getComputedStyle(toolbar);
      const available = toolbar.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
        - core.reduce((sum, child) => sum + child.getBoundingClientRect().width +
          (child.classList.contains("ml-auto") ? 0 : (parseFloat(getComputedStyle(child).marginLeft) || 0)) +
          (parseFloat(getComputedStyle(child).marginRight) || 0), 0)
        - (core.length + 4) * 1 - 4;
      const widths = toggleRaw ? [126, 132, 116, 100] : [126, 132, 116];
      let count = 0;
      let used = 0;
      for (const width of widths) {
        if (used + width > available) break;
        used += width;
        count++;
      }
      setPromotedCount(count);
    };
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, [compact, ultraCompact, toggleRaw]);
  const rememberToolSelection = () => {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!range.collapsed && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
      lastSelection.current = range.cloneRange();
    }
  };
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "IMG") {
        setImage(target as HTMLImageElement);
        setInsertOpen(true);
        if (imagePanel.current) imagePanel.current.open = true;
      }
      else setImage(null);
    };
    editor?.addEventListener("click", click);
    return () => editor?.removeEventListener("click", click);
  }, [editor]);
  useEffect(() => {
    if (image && insertOpen && imagePanel.current) imagePanel.current.open = true;
  }, [image, insertOpen]);
  useEffect(() => {
    if (image && !editor?.contains(image)) setImage(null);
  }, [editor, image, selectionVersion]);
  useEffect(() => {
    if (!imagePanelRequest || !editor) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const selected = range && !range.collapsed && range.startContainer === range.endContainer &&
      range.endOffset === range.startOffset + 1 ? range.startContainer.childNodes[range.startOffset] : null;
    if (selected instanceof HTMLImageElement && editor.contains(selected)) setImage(selected);
    // A pointer click in the context menu also dismisses Radix popovers.
    // Open after that dismissal, not in the same event turn.
    const timer = window.setTimeout(() => {
      setInsertOpen(true);
      requestAnimationFrame(() => {
        if (imagePanel.current) imagePanel.current.open = true;
        requestAnimationFrame(() => imagePanel.current?.querySelector<HTMLInputElement>('[aria-label="Image URL"]')?.focus());
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [imagePanelRequest, editor]);
  useEffect(() => {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount ||
        (document.activeElement !== editor && !editor.contains(document.activeElement))) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    lastSelection.current = range.cloneRange();
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    if (!node) return;
    const selectedCell = node.closest("td,th") as HTMLTableCellElement | null;
    const selectedAnchor = node.closest("a");
    setAnchor(selectedAnchor && editor.contains(selectedAnchor) ? selectedAnchor : null);
    setLinkUrl(selectedAnchor?.getAttribute("href") ?? "");
    setLinkText(selectedAnchor?.textContent ?? selection.toString());
    setCell(selectedCell && editor.contains(selectedCell) ? selectedCell : null);
    const child = range.startContainer.childNodes[range.startOffset];
    const selectedImage = child instanceof HTMLImageElement && range.endOffset === range.startOffset + 1 ? child : node.closest("img");
    // Browser selectionchange can trail an image click with a caret beside the
    // image. Do not replace the explicit click target with that adjacent caret.
    if (selectedImage) setImage(selectedImage);
    const css = getComputedStyle(node);
    const block = node.closest(blockSelector);
    const selectedNodes: HTMLElement[] = [];
    if (range.collapsed) selectedNodes.push(node);
    else {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (range.intersectsNode(text) && text.parentElement) selectedNodes.push(text.parentElement);
      }
    }
    const selectedBlocks = Array.from(editor.querySelectorAll<HTMLElement>(blockSelector))
      .filter(el => range.collapsed ? el === block : range.intersectsNode(el) && !el.querySelector(blockSelector));
    const unique = (values: string[]) => {
      const distinct = Array.from(new Set(values));
      return distinct.length > 1 ? "mixed" : distinct[0];
    };
    const inlineCss = selectedNodes.length ? selectedNodes.map(el => getComputedStyle(el)) : [css];
    const blockCss = selectedBlocks.length ? selectedBlocks.map(el => getComputedStyle(el)) : [block ? getComputedStyle(block) : css];
    const value = (property: string, blocks = false) => unique((blocks ? blockCss : inlineCss).map(style => style.getPropertyValue(property).trim()));
    const blocks = selectedBlocks.map(el => el.tagName.toLowerCase());
    setFormat({ fontFamily: value("font-family"), fontSize: value("font-size"), color: value("color"), backgroundColor: value("background-color"),
      textAlign: value("text-align", true),
      lineHeight: unique(selectedBlocks.length ? selectedBlocks.map(el => el.style.lineHeight || getComputedStyle(el).lineHeight) : [(block as HTMLElement | null)?.style.lineHeight || blockCss[0].lineHeight]),
      marginBottom: value("margin-bottom", true),
      block: unique(blocks.length ? blocks : [block && editor.contains(block) ? block.tagName.toLowerCase() : "p"]) });
    if (value("color") !== "mixed") setDraftColor(toHex(value("color")));
    if (value("background-color") !== "mixed") setDraftHighlight(toHex(value("background-color")));
    setColorDraftEdited(false);
    setHighlightDraftEdited(false);
    const inlineNodes = selectedNodes.length ? selectedNodes : [node];
    const activeValue = (name: "bold" | "italic" | "underline") => {
      const values = inlineNodes.map(el => {
        const style = getComputedStyle(el);
        if (name === "bold") return style.fontWeight === "bold" || Number(style.fontWeight) >= 600;
        if (name === "italic") return style.fontStyle === "italic" || style.fontStyle === "oblique";
        return style.textDecorationLine.split(" ").includes("underline");
      });
      const mixed = new Set(values).size > 1;
      return mixed ? "mixed" : values[0] ?? document.queryCommandState(name);
    };
    const listValue = (tag: "ul" | "ol") => {
      const values = (selectedBlocks.length ? selectedBlocks : [node]).map(el => Boolean(el.closest(tag)));
      return new Set(values).size > 1 ? "mixed" : values[0] ?? false;
    };
    setActive({ bold: activeValue("bold"), italic: activeValue("italic"), underline: activeValue("underline"),
      insertUnorderedList: listValue("ul"), insertOrderedList: listValue("ol") });
    if (selectedCell) {
      const table = selectedCell.closest("table")!;
      setTableWidth(table.style.width.endsWith("%") ? table.style.width.slice(0, -1) : "100");
      setPadding(String(parseFloat(selectedCell.style.padding) || 0));
      setBorder(String(parseFloat(selectedCell.style.borderWidth) || 0));
      setBackground(toHex(selectedCell.style.backgroundColor || "#ffffff"));
      setVertical(selectedCell.style.verticalAlign || "top");
    }
  }, [editor, selectionVersion]);

  const restoreToolSelection = () => {
    const range = lastSelection.current;
    if (!editor || !range || !editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  const run = (mutation: () => void) => {
    setError("");
    execute(() => {
      try { mutation(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to apply this change."); }
    });
  };
  const style = (property: string, value: string, block = false) => run(() => {
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (block) {
      const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement!;
      const nearest = start.closest(blockSelector);
      const targets = Array.from(editor.querySelectorAll<HTMLElement>(blockSelector)).filter(el =>
        range.intersectsNode(el) && !el.querySelector(blockSelector));
      if (range.collapsed && nearest && nearest !== editor && editor.contains(nearest)) {
        (nearest as HTMLElement).style.setProperty(property, value);
      } else if (targets.length) targets.forEach(el => el.style.setProperty(property, value));
      else {
        document.execCommand("formatBlock", false, "p");
        const current = window.getSelection()?.anchorNode;
        const el = (current?.nodeType === Node.ELEMENT_NODE ? current as Element : current?.parentElement)?.closest("p");
        if (el && editor.contains(el)) (el as HTMLElement).style.setProperty(property, value);
      }
    } else {
      if (range.collapsed) {
        setError("Select text before applying inline formatting.");
        return;
      }
      // Format selected text only; collapsed carets never alter paragraph styles.
      const nodes = selectedInlineTextNodes(editor, range);
      if (!nodes) { setError("Select text before applying inline formatting."); return; }
      for (const text of nodes.reverse()) {
        const end = text === range.endContainer ? range.endOffset : text.length;
        const start = text === range.startContainer ? range.startOffset : 0;
        if (end <= start) continue;
        const part = document.createRange();
        part.setStart(text, start); part.setEnd(text, end);
        const span = document.createElement("span");
        span.style.setProperty(property, value);
        part.surroundContents(span);
      }
    }
  });
  const select = (label: string, value: string, options: [string, string][], change: (value: string) => void, compact = false, visibleLabel = false) =>
    <label className={`flex min-w-0 items-center gap-1 text-xs ${label === "Font" && !compact ? "hidden md:flex" : ""} ${label === "Size" && !compact ? "hidden sm:flex" : ""}`}>
      <span className={visibleLabel ? "shrink-0" : "sr-only"}>{visibleLabel ? (label === "Line spacing" ? "Line" : "After") : label}</span><select className={`${control} ${label === "Paragraph" ? "w-[70px] px-1 sm:w-[100px]" : label === "Font" ? "w-full md:w-[118px]" : label === "Size" ? "w-[58px] px-1 sm:w-[68px]" : "w-full"}`} aria-label={label} value={options.some(([v]) => v === value) ? value : ""} onChange={e => change(e.target.value)}>
      <option value="" disabled>{value === "mixed" ? "Mixed" : value || "Current"}</option>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select></label>;
  const tableAction = (operation: TableOperation) => run(() => {
    if (!cell || !editor?.contains(cell)) throw new Error("Place the caret in a table cell first.");
    editTable(cell, operation);
  });
  const colorEditor = (highlight = false) => {
    const property = highlight ? "background-color" : "color";
    const draft = highlight ? draftHighlight : draftColor;
    const setDraft = highlight ? setDraftHighlight : setDraftColor;
    const edited = highlight ? highlightDraftEdited : colorDraftEdited;
    const setEdited = highlight ? setHighlightDraftEdited : setColorDraftEdited;
    const presets = highlight ? TEMPLATE_CELL_COLORS : TEMPLATE_TEXT_COLORS;
    const apply = (color: string) => {
      setDraft(color);
      setEdited(false);
      if (/^#[\da-f]{6}$/i.test(color)) style(property, color);
    };
    return <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={highlight ? "Highlight presets" : "Text color presets"}>
        {presets.map(color => <button key={color} type="button" aria-label={`Apply ${highlight ? "highlight" : "text color"} ${color}`} title={color}
          className="h-7 w-7 rounded border" style={{ backgroundColor: color }} onClick={() => apply(color)} />)}
      </div>
      <label className="flex items-center gap-2 text-xs">{highlight ? "Custom highlight" : "Custom text color"}
        <input aria-label={highlight ? "Text background color" : "Text color"} type="color" value={toHex(draft)} onChange={e => apply(e.target.value)} className="h-7 w-10" />
        <Input aria-label={highlight ? "Highlight hex" : "Text color hex"} className="h-8 w-28 text-xs"
          value={highlight ? (format.backgroundColor === "mixed" && !edited ? "" : draft) : (format.color === "mixed" && !edited ? "" : draft)}
          placeholder={highlight ? (format.backgroundColor === "mixed" ? "Mixed" : "#ffffff") : (format.color === "mixed" ? "Mixed" : "#000000")}
          onChange={e => { const next = e.target.value; setDraft(next); setEdited(true); if (/^#[\da-f]{6}$/i.test(next)) { setEdited(false); style(property, next); } }}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (/^#[\da-f]{6}$/i.test(draft)) style(property, draft);
              else setError("Enter a complete six-digit hex color.");
            }
          }} />
      </label>
      <Button type="button" size="sm" variant="ghost" onClick={() => style(property, highlight ? "transparent" : "inherit")}>
        Reset {highlight ? "highlight" : "text color"}
      </Button>
    </div>;
  };
  const linkMenu = <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Select text to add a link, or place the caret in a link to edit it.</p>
          <label className="block text-xs">Display text<Input aria-label="Text link display text" value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="Link text" /></label>
          <label className="block text-xs">Link URL<Input aria-label="Text link URL" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} /></label>
          <Button type="button" size="sm" onClick={() => run(() => {
            if (!safeDesignUrl(linkUrl)) throw new Error("Enter a valid http(s), mailto or tel link.");
            if (anchor && editor?.contains(anchor)) {
              anchor.setAttribute("href", linkUrl);
              if (linkText.trim()) anchor.textContent = linkText;
            }
            else {
              // The URL field takes focus and some browsers clear window.selection
              // rather than merely moving it. Restore the last editor range from
              // before the toolbar interaction before checking/applying the link.
              restoreToolSelection();
              const selected = window.getSelection()?.toString();
              if (!selected && !linkText.trim()) throw new Error("Select text or enter display text first.");
              if (linkText.trim() && linkText !== selected && editor) {
                const link = document.createElement("a");
                link.href = linkUrl;
                link.textContent = linkText;
                insertAtSelection(editor, link);
              } else document.execCommand("createLink", false, linkUrl);
            }
          })}>{anchor ? "Update text link" : "Add text link"}</Button>
          <Button type="button" size="sm" variant="outline" className="ml-2" disabled={!anchor} onClick={() => run(() => {
            if (anchor && editor?.contains(anchor)) removeTemplateLink(anchor);
          })}>Remove text link</Button>
        </div>;
  const tableMenu = <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Choose a table size</p>
          <div className="grid w-fit grid-cols-5 gap-1" role="group" aria-label="Table size">
            {Array.from({ length: 25 }, (_, index) => {
              const row = Math.floor(index / 5) + 1;
              const column = index % 5 + 1;
              return <button key={index} type="button" title={`${row} rows × ${column} columns`}
                aria-label={`Insert ${row} by ${column} table`}
                className="h-6 w-6 rounded-sm border border-border hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => run(() => { if (editor) insertAtSelection(editor, makeTable(row, column)); })} />;
            })}
          </div>
          <p className="text-xs text-muted-foreground">Or enter a custom size</p>
          <div className="flex gap-2">
            <label className="text-xs">Rows<Input aria-label="Table rows" type="number" min="1" max="20" value={rows} onChange={e => setRows(e.target.value)} /></label>
            <label className="text-xs">Columns<Input aria-label="Table columns" type="number" min="1" max="10" value={columns} onChange={e => setColumns(e.target.value)} /></label>
          </div>
          <Button type="button" size="sm" onClick={() => run(() => {
            if (!/^\d+$/.test(rows) || !/^\d+$/.test(columns) || +rows < 1 || +rows > 20 || +columns < 1 || +columns > 10) throw new Error("Use 1–20 rows and 1–10 columns.");
            if (editor) insertAtSelection(editor, makeTable(+rows, +columns));
          })}>Insert table</Button>
          {cell && <div role="group" aria-label="Table actions" className="flex flex-wrap gap-1">{([
            ["row-before", "Row above"], ["row-after", "Row below"], ["delete-row", "Delete row"],
            ["column-before", "Column left"], ["column-after", "Column right"], ["delete-column", "Delete column"],
            ["merge", "Merge right"], ["split", "Split cell"], ["delete", "Delete table"],
          ] as [TableOperation, string][]).map(([action, label]) => <Button type="button" key={action} size="sm" variant="outline" onClick={() => tableAction(action)}>{label}</Button>)}</div>}
          {cell && <><p className="text-xs text-muted-foreground">Merged or irregular tables are protected from row/column edits. Merge joins the cell to its right; split supports horizontal merges.</p>
          <div className="flex gap-2 max-w-sm">
            <label className="text-xs">Width (%)<Input aria-label="Table width" value={tableWidth} onChange={e => setTableWidth(e.target.value)} /></label>
            <label className="text-xs">Padding (px)<Input aria-label="Cell padding" value={padding} onChange={e => setPadding(e.target.value)} /></label>
            <label className="text-xs">Border (px)<Input aria-label="Cell border" value={border} onChange={e => setBorder(e.target.value)} /></label>
          </div>
          <label className="text-xs">Cell background<input aria-label="Cell background" type="color" value={toHex(background)} onChange={e => setBackground(e.target.value)} /></label>
          {select("Vertical alignment", vertical, [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], setVertical)}
          <Button type="button" size="sm" disabled={!cell} onClick={() => run(() => {
            if (!cell || !editor?.contains(cell)) throw new Error("Select a table cell.");
            if ([tableWidth, padding, border].some(v => !/^\d+$/.test(v)) || +tableWidth < 1 || +tableWidth > 100 || +padding > 100 || +border > 20) throw new Error("Width must be 1–100%, padding 0–100px, border 0–20px.");
            const table = cell.closest("table")!;
            table.style.width = `${tableWidth}%`; table.style.maxWidth = "100%"; table.style.borderCollapse = "collapse";
            tableRows(table).forEach(row => Array.from(row.cells).forEach(target => {
              target.style.padding = `${padding}px`; target.style.border = `${border}px solid #999999`;
            }));
            cell.style.backgroundColor = background; cell.style.verticalAlign = vertical;
          })}>Apply table and cell properties</Button></>}
        </div>;
  const layoutMenu = <div className="space-y-2">
          <div className="flex gap-2">{[1, 2].map(count => <Button key={count} type="button" variant="outline" size="sm" onClick={() => run(() => { if (editor) insertAtSelection(editor, makeTable(1, count, true)); })}>{count}-column layout</Button>)}</div><p className="text-xs text-muted-foreground">Table-based layouts fit the container. Email clients may render them differently.</p>
        </div>;
  const buttonMenu = <div className="space-y-2">
          <label className="block text-xs">Button text<Input aria-label="Button text" value={buttonText} onChange={e => setButtonText(e.target.value)} /></label>
          <label className="block text-xs">Button link<Input aria-label="Button link" value={buttonLink} onChange={e => setButtonLink(e.target.value)} /></label>
          <label className="text-xs">Button background<input aria-label="Button background" type="color" value={buttonColor} onChange={e => setButtonColor(e.target.value)} /></label>
          <Button type="button" size="sm" onClick={() => run(() => {
            if (!safeDesignUrl(buttonLink)) throw new Error("Enter a valid http(s), mailto or tel button link.");
            if (!editor) return;
            const text = buttonText || window.getSelection()?.toString();
            if (!text?.trim()) throw new Error("Enter button text or select text in the editor.");
            const anchor = document.createElement("a");
            anchor.href = buttonLink; anchor.textContent = text;
            anchor.style.cssText = `display:inline-block;padding:12px 20px;background-color:${buttonColor};color:#ffffff;text-decoration:none;font-weight:bold;max-width:100%;overflow-wrap:break-word`;
            insertAtSelection(editor, anchor);
          })}>Insert linked button</Button>
        </div>;
  const chars = [{ name: "Copyright", symbol: "©" }, { name: "Registered", symbol: "®" }, { name: "Trademark", symbol: "™" },
    { name: "Bullet", symbol: "•" }, { name: "En dash", symbol: "–" }, { name: "Em dash", symbol: "—" },
    { name: "Left quote", symbol: "“" }, { name: "Right quote", symbol: "”" }, { name: "Left single quote", symbol: "‘" },
    { name: "Right single quote", symbol: "’" }, { name: "Ellipsis", symbol: "…" }, { name: "Section", symbol: "§" },
    { name: "Paragraph", symbol: "¶" }, { name: "Degree", symbol: "°" }];
  const fontOptions = TEMPLATE_FONTS;
  const sizeOptions = TEMPLATE_SIZES;
  const paragraphOptions: [string, string][] = [["p", "Normal"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"]];
  const alignmentOptions: [string, string][] = [["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]];
  const listButtons = (mobile = false) => (["insertUnorderedList", "insertOrderedList"] as const).map((name, i) =>
    <Button key={name} type="button" size="sm" variant={active[name] === true ? "secondary" : "ghost"}
      className={mobile ? "h-8 w-full justify-start px-2" : "h-8 w-8 p-0"} aria-pressed={active[name] === "mixed" ? "mixed" : !!active[name]}
      aria-label={i ? "Numbered list" : "Bullet list"} title={i ? "Numbered list" : "Bullet list"}
      data-testid={testId ? `${testId}-${i ? "ol" : "ul"}` : undefined} onClick={() => command(name)}>
      {i ? <ListOrdered className="h-4 w-4" /> : <List className="h-4 w-4" />}{mobile && <span>{i ? "Numbered list" : "Bullet list"}</span>}
    </Button>);
  const insertRow = "flex w-full cursor-pointer list-none items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent [&::-webkit-details-marker]:hidden";
  const trackInsertExpansion = (event: SyntheticEvent<HTMLDetailsElement>) => {
    setInsertExpanded(Boolean(event.currentTarget.parentElement?.querySelector("details[open]")));
  };
  const insertContent = <div className="space-y-0.5">
    <details className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary data-testid={testId ? `${testId}-link` : undefined} className={insertRow}><Link2 className="h-4 w-4" />Link</summary>
      <div className="pb-2">{linkMenu}</div>
    </details>
    <details ref={imagePanel} className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary className={insertRow}><ImageIcon className="h-4 w-4" />Image</summary>
       <div className="pb-2"><TemplateImageTools editor={editor} image={image} execute={execute} disabled={disabled} uploadImage={uploadImage} selectionVersion={selectionVersion} /></div>
    </details>
    <details className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary className={insertRow}><Table2 className="h-4 w-4" />Table</summary>
      <div className="pb-2">{tableMenu}</div>
    </details>
    {mode === "email" && <details className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary className={insertRow}><Columns2 className="h-4 w-4" />Layout</summary>
      <div className="pb-2">{layoutMenu}</div>
    </details>}
    <details className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary className={insertRow}><MousePointer2 className="h-4 w-4" />Button</summary>
      <div className="pb-2">{buttonMenu}</div>
    </details>
    {openTokenPicker && <Button type="button" size="sm" variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-sm font-normal" onClick={openTokenPicker}><Braces className="h-4 w-4" />Merge field</Button>}
    <details className="rounded open:bg-muted/30" onToggle={trackInsertExpansion}>
      <summary data-testid={testId ? `${testId}-special` : undefined} className={insertRow}><Type className="h-4 w-4" />Special characters</summary>
      <div className="flex flex-wrap gap-1 pb-2">{chars.map(char => <Button key={char.symbol} type="button" size="sm" variant="outline"
        aria-label={`Insert ${char.name}`} data-testid={testId ? `${testId}-char-${char.name.toLowerCase().replace(/\s/g, "-")}` : undefined}
        onClick={() => command("insertHTML", char.symbol)}>{char.symbol}</Button>)}</div>
    </details>
    {mode === "postal" && <Button type="button" size="sm" variant="outline" className="w-full justify-start"
      data-testid={testId ? `${testId}-page-break` : undefined} onClick={insertPageBreak}>Insert page break</Button>}
  </div>;
  const triggerClass = "h-8 shrink-0 gap-1 px-1.5 text-xs sm:px-2";
  const CurrentAlignIcon = format.textAlign === "center" ? AlignCenter
    : format.textAlign === "right" ? AlignRight
      : format.textAlign === "justify" ? AlignJustify : AlignLeft;
  const spacing = (label: string, value: string, options: [string, string][], property: string, direct: boolean) =>
    <div className={direct ? `shrink-0 ${label === "Line spacing" ? "w-[126px]" : "w-[132px]"}` : ""}>
      {select(label, value, options, next => style(property, next, true), true, direct)}
    </div>;
  const clearFormatting = (direct: boolean) =>
    <Button type="button" size="sm" variant={direct ? "ghost" : "outline"}
      className={direct ? "h-8 w-[116px] shrink-0 px-1 text-xs" : "w-full justify-start"}
      aria-label="Clear formatting" onClick={() => run(() => { if (editor) clearTemplateFormatting(editor); })}>Clear formatting</Button>;
  const htmlSource = (direct: boolean) => toggleRaw && <Button type="button" size="sm"
    variant={direct ? "ghost" : "outline"}
    className={direct ? "h-8 w-[100px] shrink-0 px-1 text-xs" : "w-full justify-start"}
    aria-label="HTML source" data-testid={testId ? `${testId}-raw-mode` : undefined} onClick={toggleRaw}>HTML source</Button>;
  return <fieldset ref={toolbarRef} data-template-design-toolbar disabled={disabled} onMouseDownCapture={rememberToolSelection}
    className="sticky top-0 z-30 flex h-[46px] w-full min-w-0 items-center gap-px overflow-visible border-b bg-background px-1.5"
    aria-label="Template editing toolbar">
    {undo && <Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label="Undo" title="Undo (Ctrl/⌘ Z)"
      disabled={disabled || !canUndo} onClick={undo} data-testid={testId ? `${testId}-undo` : undefined}><Undo2 className="h-4 w-4" /></Button>}
    {redo && <Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)"
      disabled={disabled || !canRedo} onClick={redo} data-testid={testId ? `${testId}-redo` : undefined}><Redo2 className="h-4 w-4" /></Button>}
    <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
    {!compact && select("Paragraph", format.block, paragraphOptions, value => command("formatBlock", value))}
    {!compact && select("Font", format.fontFamily?.replaceAll('"', ""), fontOptions, value => style("font-family", value))}
    {!compact && select("Size", format.fontSize, sizeOptions, value => style("font-size", value))}
    {!compact && <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
    {(["bold", "italic", "underline"] as const).map(name => {
      const Icon = name === "bold" ? Bold : name === "italic" ? Italic : Underline;
      return <Button key={name} type="button" size="sm" className="h-8 w-8 shrink-0 p-0"
        variant={active[name] === true ? "secondary" : "ghost"} aria-pressed={active[name] === "mixed" ? "mixed" : !!active[name]}
        aria-label={name} title={name} data-testid={name !== "underline" && testId ? `${testId}-${name}` : undefined}
        onClick={() => command(name)}><Icon className="h-4 w-4" /></Button>;
    })}
    {!compact && <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
    {!ultraCompact && <>
    <Popover>
      <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 gap-0 p-0" aria-label="Text color" title={`Text color${format.color === "mixed" ? ": Mixed" : format.color ? `: ${format.color}` : ""}`}><span className="relative text-sm font-semibold leading-none">A<span className="absolute -bottom-1 left-0 h-0.5 w-full bg-blue-600" /></span><ChevronDown className="h-2.5 w-2.5" /></Button></PopoverTrigger>
      <PopoverContent side="bottom" align="start" collisionPadding={8} className="z-[100] max-h-[min(75vh,34rem)] w-[min(13rem,calc(100vw-1rem))] overflow-auto p-3">
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0"><div className="space-y-1"><h3 className="text-sm font-medium">Text color</h3>{colorEditor(false)}</div></fieldset>
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 gap-0 p-0" aria-label="Highlight color" title={`Highlight color${format.backgroundColor === "mixed" ? ": Mixed" : format.backgroundColor ? `: ${format.backgroundColor}` : ""}`}><span className="relative"><Highlighter className="h-4 w-4" /><span className="absolute -bottom-1 left-0 h-0.5 w-full bg-yellow-400" /></span><ChevronDown className="h-2.5 w-2.5" /></Button></PopoverTrigger>
      <PopoverContent side="bottom" align="start" collisionPadding={8} className="z-[100] max-h-[min(75vh,34rem)] w-[min(13rem,calc(100vw-1rem))] overflow-auto p-3">
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0"><div className="space-y-1"><h3 className="text-sm font-medium">Highlight color</h3>{colorEditor(true)}</div></fieldset>
      </PopoverContent>
    </Popover>
    </>}
    {!compact && <Popover>
      <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0" aria-label="Alignment" title={`Alignment${format.textAlign === "mixed" ? ": Mixed" : format.textAlign ? `: ${format.textAlign}` : ""}`}><CurrentAlignIcon className="h-4 w-4" /></Button></PopoverTrigger>
      <PopoverContent side="bottom" align="start" collisionPadding={8} className="z-[100] w-56 p-3">
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0"><div className="flex gap-1" role="group" aria-label="Paragraph alignment">{[
            ["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight], ["justify", AlignJustify],
          ].map(([value, Icon]) => {
            const AlignIcon = Icon as typeof AlignLeft;
            return <Button key={value as string} type="button" size="sm" variant={format.textAlign === value ? "secondary" : "outline"} className="h-8 w-8 p-0"
              aria-label={`Align ${value}`} aria-pressed={format.textAlign === "mixed" ? "mixed" : format.textAlign === value}
              onClick={() => style("text-align", value as string, true)}><AlignIcon className="h-4 w-4" /></Button>;
          })}</div></fieldset>
      </PopoverContent>
    </Popover>}
    {!compact && <div className="flex shrink-0">{listButtons()}</div>}
    {!compact && <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
    <Popover open={insertOpen} onOpenChange={open => { setInsertOpen(open); if (!open) setInsertExpanded(false); }}>
      <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className={triggerClass} aria-label="Insert" title="Insert">
        <span>Insert</span><ChevronDown className="h-3 w-3" />
      </Button></PopoverTrigger>
      <PopoverContent side="bottom" align="start" collisionPadding={8} className={`z-[100] max-h-[min(75vh,34rem)] overflow-auto p-2 ${insertExpanded ? "w-[min(26rem,calc(100vw-1rem))]" : "w-[min(13rem,calc(100vw-1rem))]"}`}>
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0">{insertContent}</fieldset>
      </PopoverContent>
    </Popover>
    <div data-promoted-tools className="flex shrink-0 items-center gap-px">
      {promotedCount >= 1 && spacing("Line spacing", format.lineHeight, [["normal", "Normal"], ["1", "Single"], ["1.5", "1.5"], ["2", "Double"]], "line-height", true)}
      {promotedCount >= 2 && spacing("Space after", format.marginBottom, [0, 8, 16, 24, 32].map(n => [`${n}px`, `${n}px`]), "margin-bottom", true)}
      {promotedCount >= 3 && clearFormatting(true)}
      {promotedCount >= 4 && htmlSource(true)}
    </div>
    <Popover>
      <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" className={`${triggerClass} ml-auto`} aria-label="More formatting" title="More">
        <MoreHorizontal className="h-4 w-4" /><span className="sr-only">More</span>
      </Button></PopoverTrigger>
      <PopoverContent side="bottom" align="end" collisionPadding={8} className="z-[100] max-h-[min(75vh,34rem)] w-[min(22rem,calc(100vw-1rem))] overflow-auto p-3">
        <fieldset disabled={disabled} className="min-w-0 border-0 p-0"><div className="space-y-3">
          {compact && <div className="space-y-2">
            {select("Paragraph", format.block, paragraphOptions, value => command("formatBlock", value), true)}
            {select("Font", format.fontFamily?.replaceAll('"', ""), fontOptions, value => style("font-family", value), true)}
            {select("Size", format.fontSize, sizeOptions, value => style("font-size", value), true)}
            {select("Align", format.textAlign, alignmentOptions, value => style("text-align", value, true), true)}
            <div className="grid grid-cols-2 gap-1">{listButtons(true)}</div>
          </div>}
          {ultraCompact && <div className="space-y-1">
            <details className="rounded border px-2"><summary className="cursor-pointer py-1 text-sm">Text color</summary>{colorEditor(false)}</details>
            <details className="rounded border px-2"><summary className="cursor-pointer py-1 text-sm">Highlight</summary>{colorEditor(true)}</details>
          </div>}
          {promotedCount < 1 && spacing("Line spacing", format.lineHeight, [["normal", "Normal"], ["1", "Single"], ["1.5", "1.5"], ["2", "Double"]], "line-height", false)}
          {promotedCount < 2 && spacing("Space after", format.marginBottom, [0, 8, 16, 24, 32].map(n => [`${n}px`, `${n}px`]), "margin-bottom", false)}
          {promotedCount < 3 && clearFormatting(false)}
          {promotedCount < 4 && htmlSource(false)}
        </div></fieldset>
      </PopoverContent>
    </Popover>
    {error && <span className="absolute left-2 top-full z-[130] max-w-[calc(100vw-1rem)] rounded bg-destructive px-3 py-2 text-xs text-destructive-foreground shadow" role="alert">{error}</span>}
  </fieldset>;
}

function toHex(color?: string): string {
  if (color?.startsWith("#")) return color;
  if (color?.startsWith("rgba") && Number(color.match(/,\s*([\d.]+)\s*\)$/)?.[1]) === 0) return "#ffffff";
  const parts = color?.match(/\d+/g);
  return parts && parts.length >= 3 ? `#${parts.slice(0, 3).map(part => (+part).toString(16).padStart(2, "0")).join("")}` : "#ffffff";
}
