import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Input } from "./input";
import { TemplateImageTools, safeDesignUrl } from "./template-image-tools";
import { editTable, insertAtSelection, makeTable, tableRows, type TableOperation } from "./template-table-tools";
import { clearTemplateFormatting, removeTemplateLink } from "./template-text-tools";

export interface TemplateDesignToolsProps {
  editor: HTMLDivElement | null;
  disabled: boolean;
  mode: "email" | "postal";
  execute: (mutation: () => void) => void;
  command: (name: string, value?: string) => void;
  selectionVersion: number;
}

const control = "h-8 rounded border bg-background px-2 text-xs";
const blockSelector = "p,div,h1,h2,h3,h4,h5,h6,li,td,th,blockquote";

/** Selection is observed only inside this editor; focusing a control keeps its target. */
export function TemplateDesignTools({ editor, disabled, mode, execute, command, selectionVersion }: TemplateDesignToolsProps) {
  const [cell, setCell] = useState<HTMLTableCellElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const imagePanel = useRef<HTMLDetailsElement>(null);
  const [format, setFormat] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Record<string, boolean>>({});
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
  useEffect(() => {
    const click = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "IMG") {
        setImage(target as HTMLImageElement);
        if (imagePanel.current) imagePanel.current.open = true;
      }
      else setImage(null);
    };
    editor?.addEventListener("click", click);
    return () => editor?.removeEventListener("click", click);
  }, [editor]);
  useEffect(() => {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement;
    if (!node) return;
    const selectedCell = node.closest("td,th") as HTMLTableCellElement | null;
    const selectedAnchor = node.closest("a");
    setAnchor(selectedAnchor && editor.contains(selectedAnchor) ? selectedAnchor : null);
    setLinkUrl(selectedAnchor?.getAttribute("href") ?? "");
    setCell(selectedCell && editor.contains(selectedCell) ? selectedCell : null);
    const child = range.startContainer.childNodes[range.startOffset];
    setImage(child instanceof HTMLImageElement && range.endOffset === range.startOffset + 1 ? child : node.closest("img"));
    const css = getComputedStyle(node);
    const block = node.closest(blockSelector);
    const blockCss = block ? getComputedStyle(block) : css;
    setFormat({ fontFamily: css.fontFamily, fontSize: css.fontSize, color: css.color, backgroundColor: css.backgroundColor,
      textAlign: blockCss.textAlign, lineHeight: (block as HTMLElement | null)?.style.lineHeight || blockCss.lineHeight, marginBottom: blockCss.marginBottom,
      block: block && editor.contains(block) ? block.tagName.toLowerCase() : "p" });
    setActive(Object.fromEntries(["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList"].map(name => [name, document.queryCommandState(name)])));
    if (selectedCell) {
      const table = selectedCell.closest("table")!;
      setTableWidth(table.style.width.endsWith("%") ? table.style.width.slice(0, -1) : "100");
      setPadding(String(parseFloat(selectedCell.style.padding) || 0));
      setBorder(String(parseFloat(selectedCell.style.borderWidth) || 0));
      setBackground(selectedCell.style.backgroundColor || "#ffffff");
      setVertical(selectedCell.style.verticalAlign || "top");
    }
  }, [editor, selectionVersion]);

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
        const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement!;
        const paragraph = start.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote");
        if (paragraph && editor.contains(paragraph)) {
          (paragraph as HTMLElement).style.setProperty(property, value);
        } else setError("Select text or place the caret in a paragraph to apply this formatting.");
        return;
      }
      // Format each selected text fragment in place, never extracting nested
      // table/layout markup into an invalid inline wrapper.
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) if (range.intersectsNode(walker.currentNode)) nodes.push(walker.currentNode as Text);
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
  const select = (label: string, value: string, options: [string, string][], change: (value: string) => void) =>
    <label className="flex items-center gap-1 text-xs">{label}<select className={control} aria-label={label} value={options.some(([v]) => v === value) ? value : ""} onChange={e => change(e.target.value)}>
      <option value="" disabled>Current / mixed</option>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select></label>;
  const tableAction = (operation: TableOperation) => run(() => {
    if (!cell || !editor?.contains(cell)) throw new Error("Place the caret in a table cell first.");
    editTable(cell, operation);
  });
  return <fieldset disabled={disabled} className="border-t p-2 space-y-2" aria-label="Template design tools">
    <div role="group" aria-label="Typography" className="flex flex-wrap items-center gap-2">
      {select("Paragraph", format.block, [["p", "Paragraph"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"]], value => command("formatBlock", value))}
      {select("Font", format.fontFamily?.replaceAll('"', ""), [["Arial, sans-serif", "Arial"], ["Verdana, sans-serif", "Verdana"], ["Georgia, serif", "Georgia"], ["Times New Roman, serif", "Times New Roman"], ["Courier New, monospace", "Courier New"]], value => style("font-family", value))}
      {select("Size", format.fontSize, [10, 12, 14, 16, 18, 24, 32, 48].map(n => [`${n}px`, `${n}px`]), value => style("font-size", value))}
      {(["bold", "italic", "underline"] as const).map(name => <Button type="button" size="sm" variant={active[name] ? "secondary" : "ghost"} aria-pressed={!!active[name]} key={name} onClick={() => command(name)}>{name[0].toUpperCase() + name.slice(1)}</Button>)}
      <label className="text-xs">Text color<input aria-label="Text color" type="color" value={toHex(format.color)} onChange={e => style("color", e.target.value)} /></label>
      <label className="text-xs">Highlight<input aria-label="Text background color" type="color" value={toHex(format.backgroundColor)} onChange={e => style("background-color", e.target.value)} /></label>
    </div>
    <div role="group" aria-label="Paragraph spacing and alignment" className="flex flex-wrap gap-2 items-center">
      {select("Align", format.textAlign, [["left", "Left"], ["center", "Center"], ["right", "Right"], ["justify", "Justify"]], value => style("text-align", value, true))}
      {select("Line spacing", format.lineHeight, [["normal", "Normal"], ["1", "Single"], ["1.5", "1.5"], ["2", "Double"]], value => style("line-height", value, true))}
      {select("Space after", format.marginBottom, [0, 8, 16, 24, 32].map(n => [`${n}px`, `${n}px`]), value => style("margin-bottom", value, true))}
      {(["insertUnorderedList", "insertOrderedList"] as const).map((name, i) => <Button key={name} type="button" size="sm" variant="ghost" aria-pressed={!!active[name]} onClick={() => command(name)}>{i ? "Numbered list" : "Bullet list"}</Button>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => run(() => { if (editor) clearTemplateFormatting(editor); })}>Clear formatting</Button>
    </div>
    <div className="flex flex-wrap gap-2">
      <details className="rounded border p-2 min-w-64">
        <summary className="cursor-pointer text-xs font-medium">Text links</summary>
        <div className="space-y-2 pt-2">
          <p className="text-xs text-muted-foreground">Select text to add a link, or place the caret in a link to edit it.</p>
          <label className="block text-xs">Link URL<Input aria-label="Text link URL" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} /></label>
          <Button type="button" size="sm" onClick={() => run(() => {
            if (!safeDesignUrl(linkUrl)) throw new Error("Enter a valid http(s), mailto or tel link.");
            if (anchor && editor?.contains(anchor)) anchor.setAttribute("href", linkUrl);
            else {
              if (!window.getSelection()?.toString()) throw new Error("Select the text to link first.");
              document.execCommand("createLink", false, linkUrl);
            }
          })}>{anchor ? "Update text link" : "Add text link"}</Button>
          <Button type="button" size="sm" variant="outline" className="ml-2" disabled={!anchor} onClick={() => run(() => {
            if (anchor && editor?.contains(anchor)) removeTemplateLink(anchor);
          })}>Remove text link</Button>
        </div>
      </details>
      <details className="rounded border p-2 min-w-64">
        <summary className="cursor-pointer text-xs font-medium">Tables</summary>
        <div className="space-y-2 pt-2">
          <div className="flex gap-2">
            <label className="text-xs">Rows<Input aria-label="Table rows" type="number" min="1" max="20" value={rows} onChange={e => setRows(e.target.value)} /></label>
            <label className="text-xs">Columns<Input aria-label="Table columns" type="number" min="1" max="10" value={columns} onChange={e => setColumns(e.target.value)} /></label>
          </div>
          <Button type="button" size="sm" onClick={() => run(() => {
            if (!/^\d+$/.test(rows) || !/^\d+$/.test(columns) || +rows < 1 || +rows > 20 || +columns < 1 || +columns > 10) throw new Error("Use 1–20 rows and 1–10 columns.");
            if (editor) insertAtSelection(editor, makeTable(+rows, +columns));
          })}>Insert table</Button>
          <div className="flex flex-wrap gap-1 max-w-sm">{([
            ["row-before", "Row above"], ["row-after", "Row below"], ["delete-row", "Delete row"],
            ["column-before", "Column left"], ["column-after", "Column right"], ["delete-column", "Delete column"],
            ["merge", "Merge right"], ["split", "Split cell"], ["delete", "Delete table"],
          ] as [TableOperation, string][]).map(([action, label]) => <Button type="button" key={action} size="sm" variant="outline" disabled={!cell} onClick={() => tableAction(action)}>{label}</Button>)}</div>
          <p className="text-xs text-muted-foreground">Merged or irregular tables are protected from row/column edits. Merge joins the cell to its right; split supports horizontal merges.</p>
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
          })}>Apply table and cell properties</Button>
        </div>
      </details>
      <details ref={imagePanel} className="rounded border p-2 min-w-64"><summary className="cursor-pointer text-xs font-medium">Images</summary><div className="pt-2"><TemplateImageTools editor={editor} image={image} execute={execute} disabled={disabled} /></div></details>
      <details className="rounded border p-2 min-w-64">
        <summary className="cursor-pointer text-xs font-medium">Layouts and linked buttons</summary>
        <div className="pt-2 space-y-2">
          {mode === "email" && <><div className="flex gap-2">{[1, 2].map(count => <Button key={count} type="button" variant="outline" size="sm" onClick={() => run(() => { if (editor) insertAtSelection(editor, makeTable(1, count, true)); })}>{count}-column layout</Button>)}</div><p className="text-xs text-muted-foreground">Table-based layouts fit the container. Email clients may render them differently.</p></>}
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
        </div>
      </details>
    </div>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
  </fieldset>;
}

function toHex(color?: string): string {
  if (color?.startsWith("#")) return color;
  const parts = color?.match(/\d+/g);
  return parts && parts.length >= 3 ? `#${parts.slice(0, 3).map(part => (+part).toString(16).padStart(2, "0")).join("")}` : "#ffffff";
}