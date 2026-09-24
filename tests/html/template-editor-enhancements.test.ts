// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectedInlineTextNodes } from "../../client/src/components/ui/template-design-tools";
import { moveImageInFlow, resizeImageBy } from "../../client/src/components/ui/template-image-tools";

describe("template editor enhancement primitives", () => {
  it("refuses collapsed inline formatting and finds only selected text nodes", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "<p>Start <b>nested text</b> end</p>";
    const text = editor.querySelector("b")!.firstChild!;
    const collapsed = document.createRange();
    collapsed.setStart(text, 2);
    collapsed.collapse(true);
    expect(selectedInlineTextNodes(editor, collapsed)).toBeNull();

    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 5);
    expect(selectedInlineTextNodes(editor, range)).toEqual([text]);
    const outside = document.createRange();
    const elsewhere = document.createTextNode("outside");
    outside.selectNodeContents(elsewhere);
    expect(selectedInlineTextNodes(editor, outside)).toBeNull();
  });

  it("resizes an image within safe bounds and repositions it in document flow", () => {
    const image = document.createElement("img");
    Object.defineProperty(image, "width", { configurable: true, writable: true, value: 100 });
    resizeImageBy(image, 35, 0);
    expect(image.width).toBe(135);
    expect(image.style.width).toBe("135px");
    resizeImageBy(image, -500, 0);
    expect(image.width).toBe(1);

    const editor = document.createElement("div");
    editor.innerHTML = "<p>First</p><p>Second</p>";
    const [first, second] = Array.from(editor.children);
    moveImageInFlow(image, second, true);
    expect(editor.firstElementChild).toBe(first);
    expect(editor.children[1]).toBe(image);
    expect(editor.children[2]).toBe(second);
  });
});