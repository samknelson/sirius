import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderLetterPdf, prepareLetterHtml } from "../../server/services/comm/letter-pdf";
import { wrapLetterPage } from "@shared/utils/html/letter-page";

vi.mock("../../server/logger", () => ({ storageLogger: { error: vi.fn() } }));
vi.mock("../../server/services/comm/letter-images", () => ({
  prepareLetterImages: async (sources: string[]) => sources.map(() =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII="),
}));

describe("postal branding PDF geometry", () => {
  const defaults = {
    letterheadHtml: '<p style="font-size:16pt"><b>POSTALBRAND</b></p><img src="https://example.invalid/logo.png" width="40" height="20">',
    footerHtml: '<table><tr><td>REPEATFOOTER</td><td>Contact office</td></tr></table>',
    showPageCount: true,
  };
  const body = '<p>FIRSTBODY</p><table><tr><td>TABLEBODY</td></tr></table><img src="https://example.invalid/body.png" width="50" height="30"><p style="break-before:page">SECONDBODY</p><p style="break-before:page">THIRDBODY</p>';
  const text = async (pdf: Buffer) => {
    const dir = await mkdtemp(join(tmpdir(), "branding-pdf-"));
    try {
      const path = join(dir, "letter.pdf");
      await writeFile(path, pdf);
      return {
        text: execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" }),
        bbox: execFileSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" }),
      };
    } finally { await rm(dir, { recursive: true, force: true }); }
  };

  it("prints the letterhead once and footer plus accurate page counts on all pages with safe geometry", async () => {
    const bytes = await renderLetterPdf(body, { defaults });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    const rendered = await text(bytes);
    const pages = rendered.text.split("\f").filter((page) => page.trim());
    expect(pages).toHaveLength(3);
    expect(rendered.text.match(/POSTALBRAND/g)).toHaveLength(1);
    pages.forEach((page, index) => {
      expect(page).toContain("REPEATFOOTER");
      expect(page).toContain(`Page ${index + 1} of 3`);
      if (index) expect(page).not.toContain("POSTALBRAND");
    });
    const words = [...rendered.bbox.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]+)<\/word>/g)];
    for (const word of words) {
      expect(Number(word[1])).toBeGreaterThanOrEqual(71.9);
      expect(Number(word[3])).toBeLessThanOrEqual(540.1);
      expect(Number(word[2])).toBeGreaterThan(4.5);
      expect(Number(word[4])).toBeLessThan(787.5);
      if (word[5] === "POSTALBRAND") expect(Number(word[2])).toBeGreaterThan(215);
      if (word[5] === "REPEATFOOTER") {
        expect(Number(word[2])).toBeGreaterThan(702);
        expect(Number(word[4])).toBeLessThan(756.1);
      }
      if (/BODY/.test(word[5])) expect(Number(word[4])).toBeLessThan(684.1);
    }
    // Save a non-repository copy for visual inspection during this task.
    await writeFile("/tmp/message-defaults-multipage.pdf", bytes);
  }, 60_000);

  it("preview and delivery match; prewrapped notifier and effective history inputs never add another letterhead", async () => {
    const source = wrapLetterPage("<p>SHORTBODY</p>");
    const effective = await prepareLetterHtml(source, defaults.letterheadHtml);
    const sent = await text(await renderLetterPdf(effective, { defaults: { ...defaults, letterheadHtml: "" } }));
    const preview = await text(await renderLetterPdf(source, { defaults, previewGuides: true }));
    expect(sent.text.match(/POSTALBRAND/g)).toHaveLength(1);
    expect(preview.text.replace("Reserved for Lob address and barcode", "").replace(/\s+/g, " ").trim()).toBe(sent.text.replace(/\s+/g, " ").trim());
  }, 60_000);

  it("supports footer-only and counts-only and emits no numbering when disabled", async () => {
    const disabled = await text(await renderLetterPdf(body, { defaults: { ...defaults, showPageCount: false } }));
    expect(disabled.text).not.toContain("Page ");
    expect(disabled.text.match(/REPEATFOOTER/g)).toHaveLength(3);
    const countsOnly = await text(await renderLetterPdf("<p>Only body</p>", { defaults: { letterheadHtml: "", footerHtml: "", showPageCount: true } }));
    expect(countsOnly.text).toContain("Page 1 of 1");
    expect(countsOnly.text).not.toContain("POSTALBRAND");
  }, 60_000);

  it("keeps naturally paginated text and table rows out of the repeated footer band", async () => {
    const long = Array.from({ length: 90 }, (_, index) => `<tr><td>ROW${index} ordinary letter details</td><td>Evidence text</td></tr>`).join("");
    const bytes = await renderLetterPdf(`<p>Natural pagination</p><table><tbody>${long}</tbody></table>`, { defaults });
    const count = (await PDFDocument.load(bytes)).getPageCount();
    expect(count).toBeGreaterThan(2);
    const rendered = await text(bytes);
    expect(rendered.text.match(/REPEATFOOTER/g)).toHaveLength(count);
    expect(rendered.text.match(/POSTALBRAND/g)).toHaveLength(1);
    expect(rendered.text).toContain(`Page ${count} of ${count}`);
    for (const row of rendered.bbox.matchAll(/<word xMin="[^"]+" yMin="[^"]+" xMax="[^"]+" yMax="([^"]+)">ROW\d+<\/word>/g)) {
      expect(Number(row[1])).toBeLessThan(684.1);
    }
  }, 60_000);

  it("refuses oversized branding, page breaks, clipped content and wide body elements instead of overlap", async () => {
    for (const override of [
      { footerHtml: '<p style="font-size:100pt">TOOBIG</p>' },
      { letterheadHtml: '<p style="height:4in">TOOBIG</p>' },
      { footerHtml: '<p style="break-before:page">BREAK</p>' },
      { letterheadHtml: '<div style="height:1px"><p>Clipped</p></div>' },
    ]) {
      await expect(renderLetterPdf("<p>Body</p>", { defaults: { ...defaults, ...override } })).rejects.toMatchObject({ name: "LetterLayoutError" });
    }
    await expect(renderLetterPdf('<table style="width:900px"><tr><td>Wide</td></tr></table>')).rejects.toMatchObject({ name: "LetterLayoutError" });
  }, 90_000);

  it("preserves letterhead safety through the delivery/history second normalization, not only direct preview", async () => {
    for (const letterheadHtml of [
      '<p style="height:4in">LARGELETTERHEAD</p>',
      '<div style="height:8in">SPLITLETTERHEAD</div>',
      '<p style="break-before:page">FORCEDBREAK</p>',
      '<table style="width:900px"><tr><td>WIDELETTERHEAD</td></tr></table>',
    ]) {
      const snapshot = { ...defaults, letterheadHtml };
      const prepared = await prepareLetterHtml("<p>MESSAGE</p>", letterheadHtml);
      const preparedAgain = await prepareLetterHtml(prepared);
      expect(preparedAgain.match(/id="site-postal-letterhead"/g)).toHaveLength(1);
      expect(preparedAgain).toMatch(/(?:height:(?:4|8)in|break-before:page|width:900px)/);
      await expect(renderLetterPdf("<p>MESSAGE</p>", { defaults: snapshot, previewGuides: true }))
        .rejects.toThrow(/Postal Letterhead/);
      await expect(renderLetterPdf(preparedAgain, { defaults: { ...snapshot, letterheadHtml: "" } }))
        .rejects.toThrow(/Postal Letterhead/);
    }
  }, 90_000);
});
