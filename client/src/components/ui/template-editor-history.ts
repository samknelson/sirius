/** DOM paths survive restoring a history snapshot; live Ranges do not. */
export interface EditorBookmark {
  start: number[];
  end: number[];
  startOffset: number;
  endOffset: number;
}

export function captureBookmark(root: HTMLElement): EditorBookmark | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
  const path = (node: Node) => {
    const result: number[] = [];
    while (node !== root && node.parentNode) {
      result.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      node = node.parentNode;
    }
    return result;
  };
  return { start: path(range.startContainer), end: path(range.endContainer),
    startOffset: range.startOffset, endOffset: range.endOffset };
}

export function restoreBookmark(root: HTMLElement, bookmark?: EditorBookmark): void {
  const resolve = (path: number[]) => path.reduce<Node | undefined>(
    (node, index) => node?.childNodes[index], root);
  const range = document.createRange();
  const start = bookmark && resolve(bookmark.start);
  const end = bookmark && resolve(bookmark.end);
  if (bookmark && start && end) {
    const length = (node: Node) => node.nodeType === Node.TEXT_NODE
      ? node.textContent?.length ?? 0 : node.childNodes.length;
    range.setStart(start, Math.min(bookmark.startOffset, length(start)));
    range.setEnd(end, Math.min(bookmark.endOffset, length(end)));
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export interface EditorSnapshot {
  html: string;
  bookmark?: EditorBookmark;
  source?: string;
}

/** One document, bounded memory, and a single stack for native and structural edits. */
export class TemplateEditorHistory {
  entries: EditorSnapshot[] = [];
  index = -1;
  reset(snapshot: EditorSnapshot) {
    this.entries = [snapshot];
    this.index = 0;
  }
  push(snapshot: EditorSnapshot) {
    const current = this.entries[this.index];
    if (current?.html === snapshot.html && current.source === snapshot.source) return;
    this.entries.splice(this.index + 1);
    this.entries.push(snapshot);
    if (this.entries.length > 100) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  move(delta: number): EditorSnapshot | undefined {
    const next = this.index + delta;
    if (next < 0 || next >= this.entries.length) return;
    this.index = next;
    return this.entries[next];
  }
}