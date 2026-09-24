/**
 * The shared HTML library on hostile input.
 *
 * These are render-path functions: `EsigView` calls
 * `sanitizeHtmlReportingChange` on a stored signed snapshot while the page is
 * rendering, and the whole point of that call is that the stored bytes may be
 * hostile. So the bar is not "returns the right string" — it is "cannot
 * throw". A function that raises on malformed input turns a defended page into
 * a blank one, which is a worse outcome than the XSS it was added to prevent.
 *
 * The specific trap: `String.fromCodePoint` throws `RangeError` above
 * U+10FFFF, and `Number.isFinite` does not screen for it — so a stored
 * `&#999999999;` used to take the page down. Malformed numeric entities
 * therefore get first-class coverage below.
 *
 * Also pins the content-vs-encoding distinction that
 * `sanitizeHtmlReportingChange` exists to draw, since getting that wrong
 * silently degrades the signed-document advisory into noise.
 */
import { describe, expect, it } from "vitest";
import {
  decodeHtmlEntities,
  htmlToPlainText,
  sanitizeHtml,
  sanitizeHtmlReportingChange,
} from "@shared/utils/html";

/** Every one of these is a code point `String.fromCodePoint` rejects. */
const HOSTILE_ENTITIES = [
  "&#999999999;", // decimal, far above U+10FFFF
  "&#1114112;", // decimal, exactly one past the maximum
  "&#x110000;", // hex, one past the maximum
  "&#xFFFFFFFF;", // hex, absurd
  "&#xD800;", // lone high surrogate
  "&#xDFFF;", // lone low surrogate
  "&#55296;", // the same high surrogate in decimal
] as const;

describe("malformed numeric entities must not throw (render-path totality)", () => {
  for (const entity of HOSTILE_ENTITIES) {
    const html = `<p>${entity}</p>`;

    it(`decodeHtmlEntities(${entity}) does not throw`, () => {
      expect(() => decodeHtmlEntities(html)).not.toThrow();
    });

    it(`htmlToPlainText(${entity}) does not throw`, () => {
      expect(() => htmlToPlainText(html)).not.toThrow();
    });

    it(`sanitizeHtmlReportingChange(${entity}) does not throw`, () => {
      expect(() =>
        sanitizeHtmlReportingChange(html, "signed-document"),
      ).not.toThrow();
    });

    it(`${entity} is left verbatim by decodeHtmlEntities`, () => {
      expect(decodeHtmlEntities(entity)).toBe(entity);
    });
  }
});

describe("valid entities still decode", () => {
  it("&#10003; → ✓", () => {
    expect(decodeHtmlEntities("&#10003;")).toBe("✓");
  });

  it("&#x2713; → ✓", () => {
    expect(decodeHtmlEntities("&#x2713;")).toBe("✓");
  });

  it("&amp; → &", () => {
    expect(decodeHtmlEntities("&amp;")).toBe("&");
  });

  it("&#x10FFFF; (the maximum) decodes", () => {
    expect(decodeHtmlEntities("&#x10FFFF;")).not.toBe("&#x10FFFF;");
  });

  it("&#0; decodes", () => {
    expect(decodeHtmlEntities("&#0;")).toBe("\u0000");
  });

  it("unknown name left verbatim", () => {
    expect(decodeHtmlEntities("&nope;")).toBe("&nope;");
  });
});

describe("encoding-only change is NOT reported as a content change", () => {
  // DOMPurify re-serializes the DOM it parsed, so a stored `&#10003;` comes
  // back as a literal `✓`. Same glyph; must not fire the advisory.
  const stored = '<span style="color: green;">&#10003;</span>';

  it("bytes did change (DOMPurify re-serialized)", () => {
    const { clean } = sanitizeHtmlReportingChange(stored, "signed-document");
    expect(clean).not.toBe(stored);
  });

  it("but contentChanged is false", () => {
    const { contentChanged } = sanitizeHtmlReportingChange(
      stored,
      "signed-document",
    );
    expect(contentChanged).toBe(false);
  });
});

describe("a real strip IS reported as a content change", () => {
  const cases = [
    ["script tag", "<p>hi</p><script>alert(1)</script>"],
    ["event handler", '<div onclick="alert(1)">hi</div>'],
    ["javascript: href", '<a href="javascript:alert(1)">click</a>'],
    ["iframe", '<iframe src="//evil"></iframe><p>after</p>'],
  ] as const;

  for (const [label, stored] of cases) {
    it(`${label} reported`, () => {
      const { contentChanged } = sanitizeHtmlReportingChange(
        stored,
        "signed-document",
      );
      expect(contentChanged).toBe(true);
    });
  }
});

describe("unchanged content reports no change at all", () => {
  const stored = "I hereby <b>waive all liability</b> for any damage.";

  it("clean is byte-identical", () => {
    const { clean } = sanitizeHtmlReportingChange(stored, "authored-document");
    expect(clean).toBe(stored);
  });

  it("contentChanged is false", () => {
    const { contentChanged } = sanitizeHtmlReportingChange(
      stored,
      "authored-document",
    );
    expect(contentChanged).toBe(false);
  });
});

describe("the signed-document policy keeps the markup signing pages generate", () => {
  // The blocks cardcheck-view appends around a definition body.
  const generated =
    '<div style="margin-top: 16px; border-top: 1px solid #ddd;">' +
    '<p style="font-weight: 600;">Acknowledged Statements:</p>' +
    '<span style="color: green; font-weight: bold;">&#10003;</span> <span>I like apples</span>' +
    "</div>";

  it("div survives", () => {
    expect(sanitizeHtml(generated, "signed-document")).toContain("<div");
  });

  it("span survives", () => {
    expect(sanitizeHtml(generated, "signed-document")).toContain("<span");
  });

  it("inline style survives", () => {
    expect(sanitizeHtml(generated, "signed-document")).toContain("border-top");
  });

  it("no content lost", () => {
    expect(
      sanitizeHtmlReportingChange(generated, "signed-document").contentChanged,
    ).toBe(false);
  });
});
