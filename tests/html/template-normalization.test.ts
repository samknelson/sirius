import { describe, expect, it } from "vitest";
import { normalizeTemplateHtml, sanitizeHtml, wrapLetterPage } from "@shared/utils/html";

describe("imported template normalization", () => {
  it("extracts bodies, inlines selector cascade, and preserves tables and images", () => {
    const source = `<!doctype html><html><head><style>
      td { color: red; padding: 4px }
      .amount { color: blue }
      #total { color: green !important }
    </style></head><body><table width="600" cellpadding="2"><tr>
      <td id="total" class="amount" style="color:purple">Total</td>
    </tr></table><img src="https://example.org/logo.png" width="120" alt="Logo"></body></html>`;
    const result = normalizeTemplateHtml(source);
    expect(result).toContain("color:green!important");
    expect(result).toContain("padding:4px");
    expect(result).toContain('width="600"');
    expect(result).toContain('src="https://example.org/logo.png"');
    expect(result).not.toMatch(/<(?:html|head|body|style)/);
    expect(normalizeTemplateHtml(result)).toBe(result);
  });

  it("honors inline importance, selector lists, specificity and source order", () => {
    const result = normalizeTemplateHtml(`<style>
      .x, #y { color:red!important }
      div.x { color:blue!important }
      .x { padding-left:2px; padding:4px }
    </style><div class="x" style="color:green!important">A</div><p id="y">B</p>`);
    expect(result).toContain('style="padding-left:2px;padding:4px;color:green!important"');
    expect(result).toContain('style="color:red!important"');
    expect(normalizeTemplateHtml(result)).toBe(result);
  });

  it("preserves opaque quoted token arguments in text, URLs, and CSS", () => {
    const token = '{{worker.field(name="id")}}';
    const source = `<a href="https://example.org/${token}" style="color:{{worker.field(name="color")}}">${token}</a>`;
    const result = normalizeTemplateHtml(source);
    expect(result).toContain(`href="https://example.org/${token}"`);
    expect(result).toContain('color:{{worker.field(name="color")}}');
    expect(result).toContain(`>${token}</a>`);
    expect(normalizeTemplateHtml(result)).toBe(result);
  });

  it("keeps body formatting and fragmentation rules, never supplied page geometry", () => {
    const result = normalizeTemplateHtml(`<html><head><style>
      @page { margin:0 }
      body { font-size:14pt }
      p { break-inside:avoid; page-break-after:always; margin-top:-2in; position:fixed; top:0 }
    </style></head><body><p>Hello</p></body></html>`);
    expect(result).toContain('font-size:14pt');
    expect(result).toContain('break-inside:avoid');
    expect(result).toContain('page-break-after:always');
    expect(result).not.toMatch(/@page|margin-top|position|top:/);
    expect(normalizeTemplateHtml(result)).toBe(result);
    expect(normalizeTemplateHtml(wrapLetterPage("<p>Hello</p>"))).toBe("<p>Hello</p>");
  });

  it("strips active HTML, external CSS, dangerous CSS and resource URLs", () => {
    const result = normalizeTemplateHtml(`<style>
      @import "https://evil.test/style";
      p { color:red; background-image:url(https://evil.test/pixel); behavior:url(x); --x:red }
    </style><script>alert(1)</script><iframe src="https://evil.test"></iframe>
    <p onclick="alert(1)" style="width:expression(alert(1));height:var(--x);color:rgb(1,2,3);padding:-10px;transform:translateY(-100px)">OK</p>
    <a href="java&#115;cript:alert(1)" target="_blank">link</a>
    <img src="data:image/svg+xml,evil" onerror="alert(1)" srcset="https://evil.test/x 2x">
    <img src="//evil.test/x"><img src="file:///etc/passwd">`, { preserveTokens: false });
    expect(result).not.toMatch(/script|iframe|onclick|onerror|srcset|data:|file:|evil|expression|var\(|behavior|background-image|transform|padding/);
    expect(result).toContain("color:rgb(1,2,3)");
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it("validates final CSS and does not broaden unrelated document policies", () => {
    expect(normalizeTemplateHtml('<p style="color:{{color}}">X</p>', { preserveTokens: false })).toBe("<p>X</p>");
    expect(sanitizeHtml('<div style="color:red"><img src="https://example.org/a">X</div>', "authored-document")).toBe("X");
    expect(sanitizeHtml('<p style="color:red;position:fixed">X</p>', "template-document")).toBe('<p style="color:red">X</p>');
  });

  it("retains html inheritance and safe shorthand formatting", () => {
    const result = normalizeTemplateHtml(`<html><head><style>
      html {font-family:Arial;color:red}
      p {font:italic 14px Arial;background:#fff;display:block}
    </style></head><body><p>Text</p></body></html>`);
    expect(result).toContain('font-family:Arial;color:red');
    expect(result).toContain('font:italic 14px Arial;background:#fff;display:block');
    expect(normalizeTemplateHtml(result)).toBe(result);
  });
});