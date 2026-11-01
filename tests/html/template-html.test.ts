import { describe, expect, it } from "vitest";
import { sanitizeTemplateHtml } from "@shared/utils/html/sanitize";
import { sanitizeAuthoredFields } from "../../server/delivery/sanitize-authored-fields";

const TOKEN = '{{user.field(name="email")}}';
const LINK = '<a href="/users/{{user.field(name=&quot;id&quot;)}}" target="_blank">Profile</a>';

describe("safe authored template HTML", () => {
  it.each(["authored-document", "rich-document"] as const)(
    "%s removes active content before legacy token conversion",
    (policy) => {
      const html = '<img src="/missing" onerror="window.pwned=1" data-token="bait">' +
        '<span data-token="user.field(name=&quot;email&quot;)" onclick="evil()">old label</span>' +
        '<svg onload="evil()"></svg><script>evil()</script>' +
        '<a href="javascript:evil()">bad</a><iframe src="/private"></iframe>';
      const clean = sanitizeTemplateHtml(html, policy);
      expect(clean).toContain(TOKEN);
      expect(clean).not.toMatch(/onerror|onclick|onload|<img|<svg|<script|<iframe|javascript:|data-token|old label/);
    },
  );

  it("converts mixed-case legacy chips and treats malicious identifiers as text", () => {
    const clean = sanitizeTemplateHtml(
      '<SPAN DATA-TOKEN="&lt;img src=x onerror=evil()&gt;">old</SPAN>',
    );
    expect(clean).toContain("{{&lt;img src=x onerror=evil()&gt;}}");
    expect(clean).not.toContain("<img");
  });

  it("preserves quoted token arguments, safe links, headings, lists, and tables", () => {
    const clean = sanitizeTemplateHtml(
      `<h2>Hello ${TOKEN}</h2><ul><li><strong>Work</strong></li></ul>` +
      `<table><tbody><tr><td colspan="2">${LINK}</td></tr></tbody></table>`,
    );
    expect(clean).toContain(TOKEN);
    expect(clean).toContain('href="/users/{{user.field(name=&quot;id&quot;)}}"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain("<h2>");
    expect(clean).toContain("<ul><li><strong>Work</strong></li></ul>");
    expect(clean).toContain('<td colspan="2">');
    expect(sanitizeTemplateHtml(clean)).toBe(clean);
  });

  it("preserves a token-only URL and a safe absolute URL", () => {
    const clean = sanitizeTemplateHtml(
      '<a href="{{site.url}}">Site</a><a href="https://example.com?a=1&amp;b=2">More</a>',
    );
    expect(clean).toContain('href="{{site.url}}"');
    expect(clean).toContain('href="https://example.com?a=1&amp;b=2"');
  });

  it("handles malformed nested chips without producing active markup", () => {
    const clean = sanitizeTemplateHtml(
      '<span data-token="user.field(name=&quot;id&quot;)"><span data-token="bad">x</span></span>' +
      '<math><mtext><img src=x onerror=evil() data-token=x>',
    );
    expect(clean).toContain('{{user.field(name="id")}}');
    expect(clean).not.toMatch(/<img|<math|<span|data-token|onerror/);
  });
});

describe("save-time field selection", () => {
  it("cleans only declared HTML fields, without mutating or trimming other content", () => {
    const input = {
      subject: " <b>Subject</b> ",
      bodyHtml: `<p>${TOKEN}</p><img onerror="evil()" src=x>`,
      data: { custom: "<img onerror=evil()>" },
    };
    const clean = sanitizeAuthoredFields("email", input);
    expect(clean.bodyHtml).toBe(`<p>${TOKEN}</p>`);
    expect(clean.subject).toBe(input.subject);
    expect(clean.data).toBe(input.data);
    expect(input.bodyHtml).toContain("<img");
  });

  it("sanitizes postal HTML but leaves its description literal", () => {
    expect(sanitizeAuthoredFields("postal", {
      body: "<p>Letter</p><script>evil()</script>",
      description: "<b>operator text</b>",
    })).toEqual({ body: "<p>Letter</p>", description: "<b>operator text</b>" });
  });

  it("does not invent an omitted body or rewrite null", () => {
    expect(sanitizeAuthoredFields("email", { subject: "Only subject" }))
      .toEqual({ subject: "Only subject" });
    expect(sanitizeAuthoredFields("email", { bodyHtml: null })).toEqual({ bodyHtml: null });
  });

  it.each(["sms", "inapp"] as const)("does not sanitize %s plain text", (medium) => {
    const fields = { body: "<img onerror=literal()> & text", title: " <b>Title</b> " };
    expect(sanitizeAuthoredFields(medium, fields)).toEqual(fields);
  });
});
