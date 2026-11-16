import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { FundColorSwatches } from "./fund-color-swatches";
import { TEMPLATE_CELL_COLORS } from "./template-table-tools";

const BLOCKS = "p,div,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,table";
type Target = { label: string; elements: HTMLElement[] };

export function EditorBackgroundTools({ editor, disabled, execute, selectionVersion }: {
  editor: HTMLElement | null; disabled: boolean; execute: (mutation: () => void) => void; selectionVersion: number;
}) {
  const rangeRef = useRef<Range | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [custom, setCustom] = useState("#ECEAEA");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [outlines, setOutlines] = useState<Array<{ left: number; top: number; width: number; height: number }>>([]);
  useEffect(() => {
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.startContainer) && editor.contains(range.endContainer)) rangeRef.current = range.cloneRange();
  }, [editor, selectionVersion]);
  const describe = (el: HTMLElement) => `${el.tagName.toLowerCase()} — ${(el.textContent || "(empty)").trim().slice(0, 55)}`;
  const refresh = () => {
    const range = rangeRef.current;
    if (!editor || !range || !editor.contains(range.commonAncestorContainer)) { setTargets([]); return; }
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as HTMLElement : range.startContainer.parentElement!;
    const nearest = start.closest<HTMLElement>(BLOCKS);
    const leaves = range.collapsed ? (nearest && nearest !== editor ? [nearest] : [])
      : Array.from(editor.querySelectorAll<HTMLElement>(BLOCKS)).filter(el => range.intersectsNode(el) && !el.querySelector(BLOCKS));
    const next: Target[] = [{ label: leaves.length > 1 ? `Selected blocks (${leaves.length})` : `Current block: ${leaves[0] ? describe(leaves[0]) : "new paragraph"}`, elements: leaves }];
    let ancestor = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as HTMLElement : range.commonAncestorContainer.parentElement);
    while (ancestor && ancestor !== editor && editor.contains(ancestor)) {
      if (ancestor.matches(BLOCKS) && !(leaves.length === 1 && leaves[0] === ancestor)) next.push({ label: `Container level ${next.length}: ${describe(ancestor)}`, elements: [ancestor] });
      ancestor = ancestor.parentElement;
    }
    setTargets(next); setTargetIndex(0);
  };
  const target = targets[targetIndex];
  // Preview is an overlay outside the editable DOM, never a serialized style.
  useLayoutEffect(() => {
    if (!open || !editor || !target) { setOutlines([]); return; }
    const measure = () => {
      const boundary = editor.getBoundingClientRect();
      setOutlines(target.elements.filter(el => el !== editor && editor.contains(el)).map(el => {
        const rect = el.getBoundingClientRect();
        const left = Math.max(rect.left, boundary.left);
        const top = Math.max(rect.top, boundary.top);
        return { left, top, width: Math.max(0, Math.min(rect.right, boundary.right) - left),
          height: Math.max(0, Math.min(rect.bottom, boundary.bottom) - top) };
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    target.elements.forEach(el => observer.observe(el));
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, [open, editor, target, revision]);
  const own = target?.elements.map(el => el.style.backgroundColor || el.getAttribute("bgcolor") || "");
  const state = own?.length ? new Set(own).size > 1 ? "Mixed explicit backgrounds" : own[0] ? `Explicit: ${own[0]}` : "No own background (transparent / inherited)" : "New paragraph";
  const apply = (color: string) => {
    if (disabled || !editor || (color && !/^#[\da-f]{6}$/i.test(color)) || !target) return;
    execute(() => {
      let elements = target.elements;
      if (!elements.length) {
        document.execCommand("formatBlock", false, "p");
        const node = window.getSelection()?.anchorNode;
        const block = (node?.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node?.parentElement)?.closest<HTMLElement>("p");
        elements = block ? [block] : [];
        target.elements = elements;
      }
      for (const el of elements) {
        if (el === editor || !editor.contains(el)) continue;
        if (color) el.style.backgroundColor = color;
        else {
          // Imported solid background shorthands also constitute an own background.
          el.style.removeProperty("background");
          el.style.removeProperty("background-color");
          el.removeAttribute("bgcolor");
        }
      }
    });
    setRevision(n => n + 1);
  };
  return <Popover onOpenChange={next => { setOpen(next); if (next) refresh(); }}>
    <PopoverTrigger asChild><Button type="button" size="sm" variant="ghost" disabled={disabled}
      className="h-8 shrink-0 px-1 text-xs" aria-label="Background color" title="Block/container background color">Background</Button></PopoverTrigger>
    <PopoverContent className="z-[100] w-[min(23rem,calc(100vw-1rem))] space-y-2" align="start"
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (!editor || disabled) return;
        const range = rangeRef.current?.cloneRange();
        editor.focus({ preventScroll: true });
        if (range && editor.contains(range.startContainer) && editor.contains(range.endContainer)) {
          const selection = window.getSelection();
          selection?.removeAllRanges(); selection?.addRange(range);
        }
      }}>
      <fieldset disabled={disabled} className="space-y-2">
        <label className="block text-xs">Background target
          <select aria-label="Background target" className="block w-full rounded border bg-background p-1" value={targetIndex}
            onChange={event => setTargetIndex(Number(event.target.value))}>
            {targets.map((item, index) => <option key={index} value={index}>{item.label}</option>)}
          </select>
        </label>
        <p className="text-xs" role="status">{target ? `Will change ${target.label}. ${state}.` : "Place the caret in the document first."}</p>
        <p className="text-xs text-muted-foreground">The blue outline marks the target inside this document.</p>
        <p className="text-xs text-muted-foreground">Background only; text and link colors stay unchanged. Reset reveals any inherited background.</p>
        <FundColorSwatches label="Background" onChange={apply} disabled={disabled || !target} />
        <div className="flex flex-wrap gap-1">{TEMPLATE_CELL_COLORS.map(color => <button key={color} type="button"
          disabled={disabled || !target} aria-label={`Background ${color}`} title={color} className="h-6 w-6 rounded border"
          style={{ backgroundColor: color }} onMouseDown={event => event.preventDefault()} onClick={() => apply(color)} />)}</div>
        <label className="flex gap-2 text-xs">Custom background
          <input aria-label="Custom background color" type="color" disabled={!target} value={/^#[\da-f]{6}$/i.test(custom) ? custom : "#ECEAEA"}
            onChange={event => { setCustom(event.target.value); apply(event.target.value); }} />
        </label>
        <input aria-label="Background hex" className="w-28 rounded border bg-background px-2 text-sm" value={custom} onChange={event => setCustom(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(custom); } }} />
        <Button type="button" size="sm" disabled={!target || !/^#[\da-f]{6}$/i.test(custom)} onClick={() => apply(custom)}>Apply background</Button>
        <Button type="button" size="sm" variant="outline" disabled={!target} onClick={() => apply("")}>Reset background</Button>
      </fieldset>
    </PopoverContent>
    {open && createPortal(<div aria-hidden="true" className="pointer-events-none">
      {outlines.map((rect, index) => rect.width > 0 && rect.height > 0 &&
        <div key={index} className="pointer-events-none fixed z-[99] border-2 border-dashed border-blue-500" style={rect} />)}
    </div>, document.body)}
  </Popover>;
}
