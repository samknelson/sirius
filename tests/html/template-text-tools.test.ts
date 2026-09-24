// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTemplateFormatting, removeTemplateLink } from "../../client/src/components/ui/template-text-tools";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("template text tools", () => {
  it("removes links while preserving content, formatting and tokens", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<p><a href="https://example.com"><strong>{{worker.name}}</strong> details</a></p>';
    removeTemplateLink(editor.querySelector("a")!);
    expect(editor.innerHTML).toBe("<p><strong>{{worker.name}}</strong> details</p>");
  });
  it("clears selected inline styles and paragraph spacing without stripping table layout", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<table style="width:100%"><tbody><tr><td style="padding:12px"><p style="line-height:2;margin-bottom:24px"><span style="font-family:Georgia;color:red">Selected</span></p><p style="color:blue">Untouched</p></td></tr></tbody></table>';
    document.body.appendChild(editor);
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector("p")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => true) });
    clearTemplateFormatting(editor);
    expect(editor.querySelector("span")!.hasAttribute("style")).toBe(false);
    expect(editor.querySelector("p")!.hasAttribute("style")).toBe(false);
    expect(editor.querySelectorAll("p")[1].style.color).toBe("blue");
    expect(editor.querySelector("table")!.style.width).toBe("100%");
    expect(editor.querySelector("td")!.style.padding).toBe("12px");
  });
});