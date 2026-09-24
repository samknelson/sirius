// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { captureBookmark, restoreBookmark, TemplateEditorHistory } from "../../client/src/components/ui/template-editor-history";

describe("template editor command history", () => {
  it("undoes typing and structural commands together, truncating redo after an edit", () => {
    const history = new TemplateEditorHistory();
    history.reset({ html: "" });
    history.push({ html: "<p>Hello</p>" });
    history.push({ html: "<p>Hello</p><table><tbody><tr><td>Cell</td></tr></tbody></table>" });
    expect(history.move(-1)?.html).toBe("<p>Hello</p>");
    expect(history.move(-1)?.html).toBe("");
    expect(history.move(-1)).toBeUndefined();
    expect(history.move(1)?.html).toBe("<p>Hello</p>");
    history.push({ html: "<p>Replacement</p>" });
    expect(history.move(1)).toBeUndefined();
    history.reset({ html: "<p>Other document</p>" });
    expect(history.move(-1)).toBeUndefined();
  });

  it("restores a selection in a nested table after replacing the DOM", () => {
    const root = document.createElement("div");
    root.innerHTML = "<table><tbody><tr><td>A</td><td><b>Target</b></td></tr></tbody></table>";
    document.body.append(root);
    const range = document.createRange();
    const text = root.querySelector("b")!.firstChild!;
    range.setStart(text, 1);
    range.setEnd(text, 4);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const bookmark = captureBookmark(root);
    root.innerHTML = root.innerHTML;
    restoreBookmark(root, bookmark);
    expect(window.getSelection()!.toString()).toBe("arg");
    root.remove();
  });

  it("does not capture selections in another field and bounds the stack", () => {
    const root = document.createElement("div");
    expect(captureBookmark(root)).toBeUndefined();
    const history = new TemplateEditorHistory();
    history.reset({ html: "" });
    for (let i = 0; i < 110; i++) history.push({ html: String(i) });
    expect(history.entries).toHaveLength(100);
    expect(history.index).toBe(99);
  });

  it("retains distinct source edits even when sanitization produces identical HTML", () => {
    const history = new TemplateEditorHistory();
    history.reset({ html: "<p>A</p>" });
    history.push({ html: "<p>A</p>", source: "<p>A</p><script>1</script>" });
    history.push({ html: "<p>A</p>", source: "<p>A</p><script>12</script>" });
    expect(history.move(-1)?.source).toBe("<p>A</p><script>1</script>");
    expect(history.move(1)?.source).toBe("<p>A</p><script>12</script>");
  });
});