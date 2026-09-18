import { access, constants } from "node:fs/promises";
import type { Browser } from "puppeteer-core";
import { getEnvironmentVariable } from "../../config/env-registry";
import {
  ensureLetterPage,
  isRemoteLetterDocument,
  LETTER_PAGE_GEOMETRY,
  unwrapLetterPage,
  wrapLetterPage,
} from "../../../shared/utils/html/letter-page";
import { LetterRenderQueue } from "./letter-render-queue";

export const MAX_LETTER_BODY_BYTES = 200_000;
const renderQueue = new LetterRenderQueue();

async function chromiumPath(): Promise<string> {
  const configured = getEnvironmentVariable("CHROMIUM_EXECUTABLE_PATH");
  if (configured) {
    await access(configured, constants.X_OK);
    return configured;
  }
  for (const candidate of ["/usr/bin/chromium", "/repl/tools/bin/chromium"]) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next documented runtime location. */ }
  }
  throw new Error("Letter PDF rendering requires Chromium. Install the letter-rendering runtime or configure CHROMIUM_EXECUTABLE_PATH.");
}

/**
 * Accept only body markup (or our exact shell), then sanitize and REBUILD.
 * Neither a copied marker nor caller CSS can change the printable area.
 */
export async function prepareLetterHtml(input: string): Promise<string> {
  if (Buffer.byteLength(input, "utf8") > MAX_LETTER_BODY_BYTES) {
    throw new Error("Letter content exceeds the 200,000 byte limit.");
  }
  if (!input.trim() || isRemoteLetterDocument(input)) {
    throw new Error("A composed letter requires body text, not a document URL.");
  }
  const checked = ensureLetterPage(input);
  if (!checked.ok) throw new Error(checked.error);
  const { sanitizeHtml } = await import("../../../shared/utils/html/sanitize");
  const body = sanitizeHtml(unwrapLetterPage(checked.file), "rich-document");
  if (!body.trim()) throw new Error("The letter has no printable content.");
  return wrapLetterPage(body);
}

/**
 * Same PDF engine for compose, notifier delivery and staff preview.
 * No remote resources, scripts, caller CSS, or persistent browser state.
 * Bounded concurrency/time/size; a renderer failure refuses the send instead
 * of silently falling back to Lob's broken HTML pagination.
 */
export async function renderLetterPdf(
  input: string,
  options: { previewGuides?: boolean } = {},
): Promise<Buffer> {
  return renderQueue.run(Boolean(options.previewGuides), async () => {
    let browser: Browser | undefined;
    try {
      const html = await prepareLetterHtml(input);
      const { default: puppeteer } = await import("puppeteer-core");
      browser = await puppeteer.launch({
        executablePath: await chromiumPath(),
        headless: true,
        timeout: 15_000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => { void request.abort(); });
      await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
      const bytes = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        timeout: 20_000,
      });
      const { PDFDocument, rgb } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytes);
      if (pdf.getPageCount() > 60) throw new Error("Letters may not exceed 60 pages.");
      if (!options.previewGuides) return Buffer.from(bytes);

      // Non-printing preview annotations: the underlying pages are identical
      // to a send render. PDF coordinates start at the lower left.
      const G = LETTER_PAGE_GEOMETRY;
      const pt = (inches: number) => inches * 72;
      for (const [index, sheet] of pdf.getPages().entries()) {
        const top = index === 0 ? G.firstPageBodyTopIn : G.topMarginIn;
        sheet.drawRectangle({
          x: pt(G.sideMarginIn), y: pt(G.bottomMarginIn),
          width: pt(G.sheetWidthIn - 2 * G.sideMarginIn),
          height: pt(G.sheetHeightIn - top - G.bottomMarginIn),
          borderWidth: 0.5, borderColor: rgb(0.35, 0.6, 0.8),
          borderDashArray: [3, 3], opacity: 0,
        });
        if (index === 0) {
          const A = G.addressBlock;
          sheet.drawRectangle({
            x: pt(A.leftIn), y: pt(G.sheetHeightIn - A.topIn - A.heightIn),
            width: pt(A.widthIn), height: pt(A.heightIn),
            color: rgb(1, 0.8, 0.8), opacity: 0.2,
            borderWidth: 0.5, borderColor: rgb(0.8, 0.3, 0.3),
            borderDashArray: [3, 3],
          });
          sheet.drawText("Reserved for Lob address and barcode", {
            x: pt(A.leftIn) + 5, y: pt(G.sheetHeightIn - A.topIn) - 12,
            size: 8, color: rgb(0.65, 0.2, 0.2),
          });
        }
      }
      return Buffer.from(await pdf.save());
    } finally {
      await browser?.close();
    }
  });
}