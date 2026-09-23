import { describe, it, expect } from "vitest";
import { mediumField, tokenCleanerFor, validateDeliveryFieldSpecs } from "@shared/delivery-fields";
import { prepareAuthoredValue, shapeRenderedValue } from "../../server/delivery/shape";

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

  it("does not broaden unrelated HTML fields or plain text", () => {
    const generic = { key: "body", syntax: "html" as const };
    expect(prepareAuthoredValue(generic, imported)).toBe(imported);
    expect(shapeRenderedValue(generic, '<p style="color:red">Hi</p><img src="https://example.com/a.png">'))
      .toBe("<p>Hi</p>");
    expect(prepareAuthoredValue(mediumField("sms", "body"), imported)).toBe(imported);
    expect(validateDeliveryFieldSpecs([{ key: "body", syntax: "text", htmlPolicy: "template-html" }]))
      .not.toEqual([]);
  });
});