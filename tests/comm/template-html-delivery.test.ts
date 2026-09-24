import { describe, it, expect } from "vitest";
import { mediumField, tokenCleanerFor, validateDeliveryFieldSpecs } from "@shared/delivery-fields";
import { prepareAuthoredValue, shapeRenderedValue } from "../../server/delivery/shape";
import { normalizeTemplateHtml, sanitizeHtml } from "@shared/utils/html";

describe("imported message HTML delivery contract", () => {
  const email = mediumField("email", "bodyHtml");
  const postal = mediumField("postal", "bodyHtml");
  const token = '{{worker.field(name="color")}}';
  const imported = `<!doctype html><html><head><style>
    .heading { color: ${token}; font-size: 18px }
    td { padding: 8px; border: 1px solid black }
    </style></head><body><h2 class="heading">Hello</h2>
    <table width="400"><tr><td colspan="2">Details</td></tr></table>
    <div data-template-page-break style="break-before:page"></div><p>Next page</p>
    </body></html>`;

  it("normalizes before evaluation and preserves layout after substitution on both media", () => {
    const authored = prepareAuthoredValue(email, imported);
    expect(authored).toContain(token);
    expect(authored).not.toContain("<head");
    const clean = tokenCleanerFor(email)!;
    const rendered = authored.replaceAll(token, clean("red", { id: null, emitsHtml: false }));
    const result = shapeRenderedValue(email, rendered);
    expect(result).toMatch(/color:\s*red/);
    expect(result).toMatch(/padding:\s*8px/);
    expect(result).toContain('colspan="2"');
    expect(result).toMatch(/break-before:\s*page/);
    expect(shapeRenderedValue(postal, rendered)).toBe(result);
    expect(shapeRenderedValue(email, result)).toBe(result);
  });

  it("rechecks substituted CSS and URL values, not just authored template markup", () => {
    const urlToken = '{{worker.field(name="url")}}';
    const authored = prepareAuthoredValue(email,
      `<a href="${urlToken}">Link</a><p style="color:${token}">Hello</p>`);
    expect(authored).toContain(urlToken);
    const rendered = authored.replaceAll(urlToken, "javascript:alert(1)")
      .replaceAll(token, "expression(alert(1))");
    const result = shapeRenderedValue(email, rendered);
    expect(result).not.toMatch(/javascript:|expression\s*\(/i);
    expect(result).toContain("Hello");
  });

  it("round trips nested imported tables, styled images and quoted attribute tokens without markers", () => {
    const url = '{{worker.field(name="profileUrl")}}';
    const color = '{{worker.field(name="brandColor")}}';
    const image = '{{worker.field(name="logoUrl")}}';
    const source = `<table width="600" style="width:600px;border-collapse:collapse"><tbody><tr>
      <td style="padding:12px;vertical-align:top;background-color:#efefef">
        <table style="width:100%;border-spacing:4px"><tbody><tr><td colspan="2">
          <a href="${url}" style="color:${color}">View details</a>
          <img src="${image}" width="120" height="60" alt="Company logo" style="max-width:100%;height:auto">
        </td></tr></tbody></table>
      </td></tr></tbody></table>`;
    for (const field of [email, postal]) {
      const saved = prepareAuthoredValue(field, source);
      for (const expression of [url, color, image]) expect(saved).toContain(expression);
      expect(saved.match(/<table/g)).toHaveLength(2);
      expect(saved).toMatch(/padding:\s*12px/);
      expect(saved).toContain('alt="Company logo"');
      expect(saved).not.toMatch(/siriustemplateplaceholder|sirius[a-f0-9]+token/i);
      expect(normalizeTemplateHtml(saved)).toBe(saved);
      const rendered = saved.replaceAll(url, "https://example.com/profile")
        .replaceAll(color, "#123456").replaceAll(image, "https://example.com/logo.png");
      const delivered = shapeRenderedValue(field, rendered);
      expect(delivered.match(/<table/g)).toHaveLength(2);
      expect(delivered).toContain('href="https://example.com/profile"');
      expect(delivered).toContain('src="https://example.com/logo.png"');
      expect(delivered).toMatch(/color:\s*#123456/);
      expect(shapeRenderedValue(field, delivered)).toBe(delivered);
    }
  });

  it("rejects active markup, hostile CSS and unsafe URLs before and after substitution", () => {
    const hrefToken = '{{worker.field(name="url")}}';
    const cssToken = '{{worker.field(name="color")}}';
    const authored = prepareAuthoredValue(email, `<script>alert(1)</script><p onclick="alert(1)"
      style="position:absolute;color:${cssToken};background-image:url(https://evil.example/pixel);margin-left:-500px">
      Safe copy</p><a href="${hrefToken}">Link</a>
      <img src="data:image/svg+xml,evil" onerror="alert(1)" alt="bad">
      <a href="javascript:alert(1)">Unsafe link</a>`);
    expect(authored).toContain(hrefToken);
    expect(authored).toContain(cssToken);
    expect(authored).not.toMatch(/<script|onclick|onerror|position:|background-image:|margin-left:|data:image|javascript:/i);
    const delivered = shapeRenderedValue(email, authored.replaceAll(hrefToken, "javascript:alert(1)")
      .replaceAll(cssToken, "expression(alert(1))"));
    expect(delivered).toContain("Safe copy");
    expect(delivered).not.toMatch(/javascript:|expression\s*\(|<script|onclick|onerror|position:|data:image/i);
  });

  it("does not broaden unrelated HTML fields or plain text", () => {
    const generic = { key: "body", syntax: "html" as const };
    expect(prepareAuthoredValue(generic, imported)).toBe(imported);
    expect(shapeRenderedValue(generic, '<p style="color:red">Hi</p><img src="https://example.com/a.png">'))
      .toBe("<p>Hi</p>");
    expect(prepareAuthoredValue(mediumField("sms", "body"), imported)).toBe(imported);
    expect(validateDeliveryFieldSpecs([{ key: "body", syntax: "text", htmlPolicy: "template-html" }]))
      .not.toEqual([]);
    const designed = '<div style="background-color:red"><img src="https://example.com/a.png"><table><tr><td style="padding:8px">Hi</td></tr></table></div>';
    const strict = sanitizeHtml(designed, "authored-document");
    expect(strict).not.toMatch(/<div|<img|style=|src=/i);
    expect(strict).toContain("<table>");
    expect(shapeRenderedValue(generic, designed)).toBe(strict);
  });
});