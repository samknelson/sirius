import { describe, expect, it } from "vitest";
import {
  LETTER_PAGE_MARKER,
  isLetterPage,
  wrapLetterPage,
} from "../../shared/utils/html/letter-page";
import { prepareLetterHtml } from "../../server/services/comm/letter-pdf";

describe("prepareLetterHtml", () => {
  it("strips active markup and caller-controlled presentation", async () => {
    const html = await prepareLetterHtml(`
      <style>@page { margin: 0 } body { position: fixed }</style>
      <p class="injected" style="position:fixed" onclick="steal()">Safe text</p>
      <a href="javascript:steal()" target="_blank">Link</a>
      <script>steal()</script>
      <iframe src="https://example.test"></iframe>
    `);

    expect(isLetterPage(html)).toBe(true);
    expect(html).toContain('<p class="injected">Safe text</p>');
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer">Link</a>');
    expect(html).not.toMatch(/position\s*:\s*fixed|onclick|javascript:|<script|<iframe/);
    expect(html).toContain("@page :first { margin-top: 3in; }");
  });

  it("does not trust a copied canonical marker or caller CSS as the shell", async () => {
    const html = await prepareLetterHtml(`
      <!-- ${LETTER_PAGE_MARKER} -->
      <style>@page { size: A4; margin: 0 }</style>
      <p>Spoofed shell body</p>
    `);

    expect(isLetterPage(html)).toBe(true);
    expect(html.match(new RegExp(LETTER_PAGE_MARKER, "g"))).toHaveLength(1);
    expect(html).not.toContain("size: A4");
    expect(html).toContain("<p>Spoofed shell body</p>");
  });

  it("canonicalizes a notifier-wrapped body exactly like the bare body", async () => {
    const body = '<p style="color:red">Hello <strong>member</strong>.</p>';

    await expect(prepareLetterHtml(wrapLetterPage(body))).resolves.toBe(
      await prepareLetterHtml(body),
    );
  });

  it("normalizes imported whole documents into the canonical page", async () => {
    const html = await prepareLetterHtml("<!doctype html><html><head><style>p { color: red } @page { margin:0 }</style></head><body><p>Imported text</p></body></html>");
    expect(isLetterPage(html)).toBe(true);
    expect(html).toContain('<p style="color:red">Imported text</p>');
    expect(html).toContain("@page :first { margin-top: 3in; }");
    expect(html).not.toContain("@page { margin:0 }");
  });
});