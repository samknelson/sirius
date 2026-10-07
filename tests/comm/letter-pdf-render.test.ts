import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/logger", () => ({ storageLogger: { error: vi.fn() } }));
// Shared-host cold-start allowance for actual Chromium tests only.
vi.mock("puppeteer-core", async (original) => {
  const module = await original<typeof import("puppeteer-core")>();
  return { ...module, default: { ...module.default, launch: (options: import("puppeteer-core").LaunchOptions) =>
    module.default.launch({ ...options, timeout: 60_000 }) } };
});
vi.mock("../../server/services/comm/letter-images", () => ({
  prepareLetterImages: vi.fn(async (sources: string[]) => sources.map(() =>
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=")),
}));

import { renderLetterPdf } from "../../server/services/comm/letter-pdf";
import { prepareLetterImages } from "../../server/services/comm/letter-images";

describe("actual Chromium letter PDF", () => {
  it("preserves styled tables, images, page breaks and canonical geometry in preview and send", async () => {
    const input = `<!doctype html><html><head><style>
      .blue { color:#0000ff; font-size:16pt }
      td { border:1px solid black; padding:8pt }
    </style></head><body>
      <p class="blue">FIRSTPAGE</p>
      <img src="https://images.example/logo.png" width="40" height="40" alt="Logo">
      <table><tbody><tr><td>TABLELEFT</td><td>TABLERIGHT</td></tr></tbody></table>
      <p style="break-before:page">SECONDPAGE</p>
      <p style="page-break-before:always">THIRDPAGE</p>
    </body></html>`;
    const dir = await mkdtemp(join(tmpdir(), "letter-pdf-test-"));
    try {
      const send = await renderLetterPdf(input);
      const preview = await renderLetterPdf(input, { previewGuides: true });
      const sendDoc = await PDFDocument.load(send);
      const previewDoc = await PDFDocument.load(preview);
      expect(sendDoc.getPageCount()).toBe(3);
      expect(previewDoc.getPageCount()).toBe(3);
      for (const doc of [sendDoc, previewDoc]) {
        expect(doc.getPages().map((page) => page.getSize())).toEqual(Array(3).fill({ width: 612, height: 792 }));
        expect(doc.context.enumerateIndirectObjects().some(([, object]) =>
          object instanceof PDFRawStream &&
          object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))).toBe(true);
      }
      const positions: string[][] = [];
      for (const [name, bytes] of [["send", send], ["preview", preview]] as const) {
        const file = join(dir, `${name}.pdf`);
        await writeFile(file, bytes);
        const bbox = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
        const words = [...bbox.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">((?:FIRST|SECOND|THIRD)PAGE|TABLELEFT|TABLERIGHT)<\/word>/g)];
        expect(words).toHaveLength(5);
        positions.push(words.map((word) => word[0]));
        const first = words.find((word) => word[5] === "FIRSTPAGE")!;
        const second = words.find((word) => word[5] === "SECONDPAGE")!;
        const table = words.find((word) => word[5] === "TABLELEFT")!;
        // Chromium's PDF float encoding introduces sub-millipoint rounding.
        expect(Number(first[1])).toBeGreaterThanOrEqual(71.99);
        expect(Number(first[2])).toBeGreaterThanOrEqual(215.99);
        expect(Number(second[2])).toBeGreaterThanOrEqual(71.99);
        expect(Number(second[2])).toBeLessThan(100);
        expect(Number(table[2])).toBeGreaterThan(Number(first[4]) + 30);
      }
      expect(positions[0]).toEqual(positions[1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("fails explicitly if an image is unavailable rather than printing a broken image", async () => {
    vi.mocked(prepareLetterImages).mockRejectedValueOnce(new Error("Image unavailable"));
    await expect(renderLetterPdf('<p>Letter</p><img src="https://images.example/missing.png">'))
      .rejects.toThrow("Image unavailable");
  });

  it("prints authored break markers as blank boundaries, not text, and retains the first-page address reserve", async () => {
    const body = `<p>RESERVEDFIRST</p>
      <div data-template-page-break="true" style="break-before:page"></div>
      <table style="width:100%;border-collapse:collapse"><tr><td style="padding:8pt">
        <p>AFTERBREAK</p><table><tr><td>NESTEDCELL</td></tr></table>
      </td></tr></table>
      <div data-template-page-break="true" style="break-before:page"></div>
      <p>LASTPAGE</p>`;
    const dir = await mkdtemp(join(tmpdir(), "letter-break-test-"));
    try {
      const sent = await renderLetterPdf(body);
      const preview = await renderLetterPdf(body, { previewGuides: true });
      for (const [kind, bytes] of [["sent", sent], ["preview", preview]] as const) {
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPageCount()).toBe(3);
        expect(pdf.getPages().map((page) => page.getSize()))
          .toEqual(Array(3).fill({ width: 612, height: 792 }));
        const path = join(dir, `${kind}.pdf`);
        await writeFile(path, bytes);
        const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
        const sheets = text.trim().split("\f");
        expect(sheets).toHaveLength(3);
        expect(sheets[0]).toContain("RESERVEDFIRST");
        expect(sheets[1]).toContain("AFTERBREAK");
        expect(sheets[1]).toContain("NESTEDCELL");
        expect(sheets[2]).toContain("LASTPAGE");
        expect(text).not.toMatch(/Page break|data-template-page-break/);
        const bbox = execFileSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" });
        const first = bbox.match(/<word xMin="([^"]+)" yMin="([^"]+)"[^>]*>RESERVEDFIRST<\/word>/);
        const second = bbox.match(/<word xMin="([^"]+)" yMin="([^"]+)"[^>]*>AFTERBREAK<\/word>/);
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(Number(first![1])).toBeGreaterThanOrEqual(71.99);
        expect(Number(first![2])).toBeGreaterThanOrEqual(215.99);
        expect(Number(second![2])).toBeGreaterThanOrEqual(71.99);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180_000);
});