import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ download: vi.fn(), log: vi.fn() }));
vi.mock("../../server/services/comm/remote-letter-pdf", async (original) => ({
  ...await original<object>(), downloadPublicHttpsResource: mocks.download,
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/files", () => ({
  fileSystemService: {}, getFileSystemConfig: vi.fn(), isFileSystemConfigured: vi.fn(),
}));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: () => undefined, PUBLIC_URL_LOCAL_FALLBACK: "https://app.example",
}));
vi.mock("../../server/logger", () => ({ storageLogger: { error: mocks.log } }));
// Cold Chromium starts vary on shared CI hosts. Only the launch deadline is
// relaxed in this harness; use the real browser and unchanged production code.
vi.mock("puppeteer-core", async (original) => {
  const module = await original<typeof import("puppeteer-core")>();
  return { ...module, default: { ...module.default, launch: (options: import("puppeteer-core").LaunchOptions) =>
    module.default.launch({ ...options, timeout: 60_000 }) } };
});

import { renderLetterPdf } from "../../server/services/comm/letter-pdf";
import { convertLetterSvg } from "../../server/services/comm/letter-svg";
import { LetterImageError } from "../../server/services/comm/letter-image-error";

function imageStreams(pdf: PDFDocument): PDFRawStream[] {
  return pdf.context.enumerateIndirectObjects().flatMap(([, object]) =>
    object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image") ? [object] : []);
}

describe("real SVG postal PDF embedding (no mail)", () => {
  it("uses identical converted PNGs in guided preview and delivery with preserved logo geometry", async () => {
    const svg = readFileSync(new URL("./fixtures/benefits11-logo.svg", import.meta.url));
    const converted = await convertLetterSvg(svg);
    mocks.download.mockImplementation(async (_url, options) => {
      options.onContentType("image/svg+xml");
      return svg;
    });
    const source = "https://www.benefits11.org/wp-content/uploads/2025/08/UNITE-HERE-11-health-benefit-fund-logo-rgb-color.svg";
    const dir = await mkdtemp(join(tmpdir(), "svg-letter-"));
    try {
      const input = `<img src="${source}"><p>SVGPRINTPROOF</p>`;
      let deliveredStreams: PDFRawStream[] | undefined;
      for (const previewGuides of [false, true]) {
        const bytes = await renderLetterPdf(input, { previewGuides });
        const pdf = await PDFDocument.load(bytes);
        expect(pdf.getPages()[0].getSize()).toEqual({ width: 612, height: 792 });
        expect(pdf.getPageCount()).toBe(1);
        const streams = imageStreams(pdf);
        const logo = streams.find((stream) => stream.dict.get(PDFName.of("Width")) instanceof PDFNumber &&
          (stream.dict.get(PDFName.of("Width")) as PDFNumber).asNumber() === 750);
        expect(logo).toBeDefined();
        expect(logo!.dict.has(PDFName.of("SMask"))).toBe(true);
        if (!previewGuides) deliveredStreams = streams;
        else expect(streams.map((stream) => Buffer.from(stream.contents))).toEqual(deliveredStreams!.map((stream) => Buffer.from(stream.contents)));
        const path = join(dir, `${previewGuides ? "preview" : "delivery"}.pdf`);
        await writeFile(path, bytes);
        const listing = execFileSync("pdfimages", ["-list", path], { encoding: "utf8" });
        // Unsized source is still 240 CSS px (180 pt), not 750 CSS px.
        const row = listing.split("\n").find((line) => /\bimage\b/.test(line))!.trim().split(/\s+/);
        expect(Number(row[12])).toBeGreaterThanOrEqual(299); // x-ppi
        expect(Number(row[13])).toBeGreaterThanOrEqual(297); // small integer raster/layout rounding
        const bbox = execFileSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" });
        const word = bbox.match(/yMin="([^"]+)"[^>]*>SVGPRINTPROOF<\/word>/);
        expect(word).not.toBeNull();
        expect(Number(word![1])).toBeGreaterThan(250);
        expect(Number(word![1])).toBeLessThan(300);
        execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1200", "-png", path, join(dir, "page")]);
        expect(readFileSync(join(dir, "page.png")).length).toBeGreaterThan(5000);
        // Rasterize the actual PDF, not just the source PNG. The logo must
        // visibly occupy the expected 240 x 56.75 CSS-pixel body region.
        const ppm = execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-r", "96", path], { maxBuffer: 4 * 1024 * 1024 });
        const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString("ascii", 0, 80))!;
        const pageWidth = Number(header[1]);
        const pixels = ppm.subarray(header[0].length);
        let visible = 0;
        let colored = 0;
        for (let y = 288; y < 344; y++) for (let x = 96; x < 336; x++) {
          const offset = (y * pageWidth + x) * 3;
          const [r, g, b] = pixels.subarray(offset, offset + 3);
          if (Math.min(r, g, b) < 200) visible++;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++;
        }
        expect(visible).toBeGreaterThan(1000);
        expect(colored).toBeGreaterThan(100);
      }
      expect(converted.bytes.length).toBeGreaterThan(1000);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 180_000);

  it("records controlled image failures in the administrator logger without URL or content", async () => {
    mocks.log.mockClear();
    mocks.download.mockImplementation(async (_url, options) => {
      options.onContentType("image/svg+xml");
      return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>private-letter-canary</script></svg>');
    });
    await expect(renderLetterPdf('<p>private-letter-canary</p><img src="https://example.com/private-path?signature=secret-canary">', { previewGuides: true }))
      .rejects.toBeInstanceOf(LetterImageError);
    expect(mocks.log).toHaveBeenCalledWith("Letter PDF preparation failed", expect.objectContaining({
      stage: "images", category: "unsafe-svg", imageNumber: 1, lane: "preview",
    }));
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/canary|example.com|private-path|<svg/);
  }, 90_000);
});
