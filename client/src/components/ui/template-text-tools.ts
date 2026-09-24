const TEXT_BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote";
const INLINE_FORMATS = "span,b,strong,i,em,u,s,strike,sub,sup,font";

export function clearTemplateFormatting(editor: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  // Browser removeFormat splits inline wrappers at the range edges, preserving
  // unselected text. Block spacing belongs to the affected paragraphs.
  const blocks = Array.from(editor.querySelectorAll<HTMLElement>(TEXT_BLOCKS))
    .filter(el => range.intersectsNode(el));
  document.execCommand("removeFormat", false);
  blocks.forEach(el => el.removeAttribute("style"));
  const current = selection.rangeCount ? selection.getRangeAt(0) : range;
  // Remove styles only on wholly selected inline elements; never strip table,
  // image, button, or surrounding layout presentation.
  for (const el of Array.from(editor.querySelectorAll<HTMLElement>(INLINE_FORMATS))) {
    const contents = document.createRange();
    contents.selectNodeContents(el);
    if (current.compareBoundaryPoints(Range.START_TO_START, contents) <= 0 &&
        current.compareBoundaryPoints(Range.END_TO_END, contents) >= 0) el.removeAttribute("style");
  }
}

export function removeTemplateLink(anchor: HTMLAnchorElement): void {
  anchor.replaceWith(...Array.from(anchor.childNodes));
}