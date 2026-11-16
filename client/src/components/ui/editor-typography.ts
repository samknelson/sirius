import { AUTHORING_TYPOGRAPHY } from "@shared/utils/html/authoring";
import { captureBookmark, restoreBookmark } from "./template-editor-history";

export function setBlockTypography(block: HTMLElement, tag: keyof typeof AUTHORING_TYPOGRAPHY) {
  const preset = AUTHORING_TYPOGRAPHY[tag];
  block.style.fontFamily = "Arial, sans-serif";
  block.style.fontSize = preset.size;
  block.style.fontWeight = preset.weight;
}

/** An explicit paragraph preset supersedes old inline size/family/bold, not links or layout. */
export function applyParagraphPreset(editor: HTMLElement, tag: string) {
  if (!(tag in AUTHORING_TYPOGRAPHY)) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
  document.execCommand("formatBlock", false, tag);
  const bookmark = captureBookmark(editor);
  const range = selection.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as HTMLElement : range.startContainer.parentElement!;
  const targets = range.collapsed ? [start.closest("p,h1,h2,h3")]
    : Array.from(editor.querySelectorAll("p,h1,h2,h3")).filter(el => range.intersectsNode(el));
  for (const target of targets) {
    if (!(target instanceof HTMLElement) || target === editor || !editor.contains(target)) continue;
    for (const child of Array.from(target.querySelectorAll<HTMLElement>("*"))) {
      // Nested tables/containers are not typography targets of their parent.
      if (child.closest("p,h1,h2,h3") !== target) continue;
      ["font", "font-family", "font-size", "font-weight"].forEach(property => child.style.removeProperty(property));
      child.removeAttribute("face");
      child.removeAttribute("size");
      if (/^(B|STRONG)$/.test(child.tagName)) {
        const span = document.createElement("span");
        for (const attr of Array.from(child.attributes)) span.setAttribute(attr.name, attr.value);
        span.append(...Array.from(child.childNodes));
        child.replaceWith(span);
      }
    }
    setBlockTypography(target, tag as keyof typeof AUTHORING_TYPOGRAPHY);
  }
  restoreBookmark(editor, bookmark);
}

/** Only new DOM nodes are defaulted; opening a saved document never emits a rewrite. */
export function materializeNewTypography(editor: HTMLElement, known: WeakSet<Element>) {
  const selection = window.getSelection();
  // Bare browser-created runs need a serialized parent, never a styled editor host.
  const runs: Node[][] = [];
  let run: Node[] = [];
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE ||
        (node instanceof HTMLElement && /^(SPAN|B|STRONG|I|EM|U|A|FONT|BR|IMG|S|STRIKE|SUB|SUP|CODE)$/.test(node.tagName))) run.push(node);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  for (const nodes of runs) {
    if (!nodes.some(node => node.textContent || node.nodeName === "BR")) continue;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const startNode = range?.startContainer;
    const endNode = range?.endContainer;
    const start = startNode && nodes.some(node => node === startNode || node.contains(startNode)) ? range!.startOffset : null;
    const end = endNode && nodes.some(node => node === endNode || node.contains(endNode)) ? range!.endOffset : null;
    const p = document.createElement("p");
    editor.insertBefore(p, nodes[0]); p.append(...nodes);
    if (start !== null) range!.setStart(startNode!, start);
    if (end !== null) range!.setEnd(endNode!, end);
  }
  for (const block of Array.from(editor.querySelectorAll<HTMLElement>("p,div,h1,h2,h3,li,td,th"))) {
    if (known.has(block) || block.hasAttribute("data-template-page-break")) continue;
    const tag = block.tagName.toLowerCase() as keyof typeof AUTHORING_TYPOGRAPHY;
    const preset = AUTHORING_TYPOGRAPHY[tag] ?? AUTHORING_TYPOGRAPHY.p;
    for (const [property, value] of [["font-family", "Arial, sans-serif"], ["font-size", preset.size], ["font-weight", preset.weight]]) {
      let parent: HTMLElement | null = block;
      let explicit = false;
      while (parent && parent !== editor) {
        if (parent.style.getPropertyValue(property) || parent.style.font ||
            (property === "font-family" && parent.hasAttribute("face")) ||
            (property === "font-size" && parent.hasAttribute("size"))) { explicit = true; break; }
        parent = parent.parentElement;
      }
      if (!explicit) block.style.setProperty(property, value);
    }
  }
  editor.querySelectorAll("*").forEach(el => known.add(el));
}
