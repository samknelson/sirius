import { access, constants } from "node:fs/promises";
import type { Browser } from "puppeteer-core";
import { getEnvironmentVariable } from "../../config/env-registry";
import {
  isRemoteLetterDocument,
  LETTER_PAGE_GEOMETRY,
  unwrapLetterPage,
  wrapLetterPage,
} from "../../../shared/utils/html/letter-page";
import { LetterRenderQueue } from "./letter-render-queue";
import { prepareLetterImages } from "./letter-images";
import { LetterImageError, letterFailureContext } from "./letter-image-error";
import { storageLogger } from "../../logger";
import { isMaintenanceModeError } from "../maintenance-flag";
import type { PostalMessageDefaults } from "@shared/message-defaults";

// Footer lives above the printer clearance, within a separate reserved band.
// Body ends at 1.5", footer occupies 0.5"–1.25", page count sits at 0.3".
export const POSTAL_FOOTER_MAX_HEIGHT_IN = 0.75;
const EMPTY_DEFAULTS: PostalMessageDefaults = { letterheadHtml: "", footerHtml: "", showPageCount: false };

export class LetterLayoutError extends Error {
  constructor(message: string) { super(message); this.name = "LetterLayoutError"; }
}

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
 * Normalize imported documents/body markup (or our exact shell) and REBUILD.
 * Neither a copied marker nor caller CSS can change the printable area.
 */
export async function prepareLetterHtml(input: string, letterheadHtml = ""): Promise<string> {
  if (Buffer.byteLength(input, "utf8") > MAX_LETTER_BODY_BYTES) {
    throw new Error("Letter content exceeds the 200,000 byte limit.");
  }
  if (!input.trim() || isRemoteLetterDocument(input)) {
    throw new Error("A composed letter requires body text, not a document URL.");
  }
  const { normalizeTemplateHtml } = await import("../../../shared/utils/html");
  const body = normalizeTemplateHtml(unwrapLetterPage(input), { preserveTokens: false });
  if (!body.trim()) throw new Error("The letter has no printable content.");
  return wrapLetterPage(letterheadHtml
    // Use the sanitizer-supported id, not an unapproved data attribute:
    // delivery/history normalize this effective document a second time.
    ? `<div id="site-postal-letterhead">${normalizeTemplateHtml(letterheadHtml, { preserveTokens: false })}</div>\n${body}`
    : body);
}

/**
 * Same PDF engine for compose, notifier delivery and staff preview.
 * No browser network, scripts, unsafe CSS, or persistent browser state.
 * Bounded concurrency/time/size; a renderer failure refuses the send instead
 * of silently falling back to Lob's broken HTML pagination.
 */
export async function renderLetterPdf(
  input: string,
  options: { previewGuides?: boolean; defaults?: PostalMessageDefaults } = {},
): Promise<Buffer> {
  let entered = false;
  return renderQueue.run(Boolean(options.previewGuides), async () => {
    entered = true;
    let browser: Browser | undefined;
    let stage = "html";
    try {
      const defaults = options.defaults ?? EMPTY_DEFAULTS;
      const hasFooter = Boolean(defaults.footerHtml || defaults.showPageCount);
      let html = await prepareLetterHtml(input, defaults.letterheadHtml);
      // Footer is measured with the very same fonts and secure raster image
      // pipeline as the body, then printed separately and overlaid on each
      // sheet. It cannot take part in body pagination or intrude into it.
      const { normalizeTemplateHtml } = await import("@shared/utils/html");
      const footer = normalizeTemplateHtml(defaults.footerHtml, { preserveTokens: false });
      html = html.replace("</head>", `<style>
        ${hasFooter ? "@page { margin-bottom: 1.5in; }" : ""}
        #site-postal-letterhead { display: flow-root; break-inside: avoid; margin-bottom: 12pt; }
        #site-postal-footer { position: absolute; top: 0; left: 0; width: 6.5in; font-size: 9pt; line-height: 1.2; visibility: hidden; }
        #site-postal-footer p { margin: 0; }
      </style></head>`).replace("</body>", `<div id="site-postal-footer">${footer}</div></body>`);
      stage = "browser";
      const { default: puppeteer } = await import("puppeteer-core");
      browser = await puppeteer.launch({
        executablePath: await chromiumPath(),
        headless: true,
        timeout: 15_000,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      // Measure in the printable width, not Puppeteer's default 800px screen.
      await page.setViewport({ width: 624, height: 1056 });
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        // The only resources Chromium may consume are already bounded and
        // verified raster bytes supplied by our server-side downloader.
        if (request.url().startsWith("data:image/png;base64,") ||
            request.url().startsWith("data:image/jpeg;base64,")) {
          void request.continue();
        } else {
          void request.abort();
        }
      });
      await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
      const sources = await page.$$eval("img", (images) =>
        images.map((image) => image.getAttribute("src") ?? ""));
      stage = "images";
      const dimensions: Array<{ width: number; height: number } | undefined> = [];
      const imageData = await prepareLetterImages(sources, (index, width, height) => {
        dimensions[index] = { width, height };
      });
      const decodeFailure = await page.evaluate(async ({ data, dimensions }) => {
        const images = Array.from(document.querySelectorAll("img"));
        return Promise.race([
          Promise.all(images.map(async (image, index) => {
            image.removeAttribute("srcset");
            // A 300-DPI PNG must not enlarge an un-sized 96-DPI SVG logo.
            if (dimensions[index] && !image.hasAttribute("width") && !image.style.width) {
              if (!image.hasAttribute("height") && !image.style.height) {
                image.style.width = `${dimensions[index]!.width}px`;
              }
            }
            if (dimensions[index]) {
              image.style.aspectRatio = `${dimensions[index]!.width} / ${dimensions[index]!.height}`;
            }
            image.src = data[index];
            try { await image.decode(); return 0; } catch { return index + 1; }
          })).then((failures) => failures.find((index) => index > 0) ?? 0),
          new Promise<number>((resolve) => setTimeout(() => resolve(-1), 10_000)),
        ]);
      }, { data: imageData, dimensions });
      if (decodeFailure) throw new LetterImageError(
        decodeFailure === -1 ? "timeout" : "invalid",
        decodeFailure === -1 ? "Image decoding timed out." : "Image is not a valid decodable PNG or JPEG.",
        decodeFailure === -1 ? 1 : decodeFailure,
      );
      const layout = await page.evaluate(() => {
        const footer = document.body.lastElementChild as HTMLElement;
        const heads = Array.from(document.querySelectorAll<HTMLElement>("#site-postal-letterhead"));
        const tooWide = (root: HTMLElement) => {
          const bounds = root.getBoundingClientRect();
          return [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].some((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && (box.right > bounds.right + 1 || box.left < bounds.left - 1 ||
              el.scrollWidth > el.clientWidth + 1);
          });
        };
        // Page breaks and fixed-height clipping in branding would undermine
        // both measurement and first-page-only semantics. Refuse, don't clip.
        const unsafeBranding = [footer, ...heads].some((root) =>
          [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))].some((el) => {
            const css = getComputedStyle(el);
            return ["page", "always", "left", "right", "recto", "verso"].includes(css.breakBefore) ||
              ["page", "always", "left", "right", "recto", "verso"].includes(css.breakAfter) ||
              el.scrollHeight > el.clientHeight + 1;
          }));
        const result = {
          footerHeight: footer.getBoundingClientRect().height,
          footerWide: tooWide(footer),
          headHeight: Math.max(0, ...heads.map((head) => head.getBoundingClientRect().height)),
          headWide: heads.some(tooWide),
          unsafeBranding,
          footerHtml: footer.innerHTML,
        };
        footer.remove();
        return result;
      });
      if (layout.footerHeight > POSTAL_FOOTER_MAX_HEIGHT_IN * 96 + 1 || layout.footerWide) {
        throw new LetterLayoutError("Postal Footer must fit within 6.5 inches wide and 0.75 inches high. Reduce its text, image size, spacing, or font size, then preview again.");
      }
      if (layout.headHeight > 2 * 96 || layout.headWide || layout.unsafeBranding) {
        throw new LetterLayoutError("Postal Letterhead must fit within 6.5 inches wide and 2 inches high. Remove page breaks or fixed-height clipping from the letterhead/footer and reduce oversized content, then preview again.");
      }
      const overflow = await page.evaluate(({ bottom }) => {
        const root = document.querySelector<HTMLElement>(".letter-body")!;
        const bounds = root.getBoundingClientRect();
        return Array.from(root.querySelectorAll<HTMLElement>("*")).some((el) => {
          const box = el.getBoundingClientRect();
          // Rows and images cannot be split safely; other text blocks paginate.
          return box.width > 0 && (box.right > bounds.right + 1 || box.left < bounds.left - 1 ||
            el.scrollWidth > el.clientWidth + 1 ||
            (["IMG", "TR"].includes(el.tagName) && box.height > (11 - 3 - bottom) * 96));
        });
      }, { bottom: hasFooter ? 1.5 : 1 });
      if (overflow) throw new LetterLayoutError("Letter content is too wide, or an image/table row is taller than the printable area. Reduce its dimensions or split the content, then preview again.");
      stage = "pdf";
      const bytes = await page.pdf({
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        timeout: 20_000,
      });
      const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
      const pdf = await PDFDocument.load(bytes);
      if (pdf.getPageCount() > 60) throw new Error("Letters may not exceed 60 pages.");
      if (footer) {
        // Resolved image data URLs are already verified and bounded. No network
        // or new resources are introduced by rendering this footer sheet.
        await page.setContent(`<!doctype html><html><head><style>
          @page { size: 8.5in 11in; margin: 0; }
          html,body { margin:0;padding:0; font-family:'Liberation Sans',Arial,sans-serif; color:#333; }
          #footer { position:absolute; left:1in; bottom:0.5in; width:6.5in; font-size:9pt; line-height:1.2; overflow-wrap:anywhere; }
          p { margin:0; } table { width:100%;table-layout:fixed;border-collapse:collapse; }
          th,td { overflow-wrap:anywhere;vertical-align:top;padding:3pt; }
          img { max-width:100%;height:auto; } a {color:inherit;text-decoration:underline;}
        </style></head><body><div id="footer">${layout.footerHtml}</div></body></html>`, { waitUntil: "load", timeout: 10_000 });
        const footerBytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, timeout: 20_000 });
        const footerDoc = await PDFDocument.load(footerBytes);
        if (footerDoc.getPageCount() !== 1) throw new LetterLayoutError("Postal Footer must fit on one page. Reduce its content and preview again.");
        const [footerPage] = await pdf.embedPdf(footerBytes, [0]);
        for (const sheet of pdf.getPages()) sheet.drawPage(footerPage);
      }
      if (defaults.showPageCount) {
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        for (const [index, sheet] of pdf.getPages().entries()) {
          const text = `Page ${index + 1} of ${pdf.getPageCount()}`;
          sheet.drawText(text, { x: (612 - font.widthOfTextAtSize(text, 9)) / 2, y: 21.6, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
        }
      }
      if (!options.previewGuides) return hasFooter ? Buffer.from(await pdf.save()) : Buffer.from(bytes);

      // Non-printing preview annotations: the underlying pages are identical
      // to a send render. PDF coordinates start at the lower left.
      const G = LETTER_PAGE_GEOMETRY;
      const pt = (inches: number) => inches * 72;
      for (const [index, sheet] of pdf.getPages().entries()) {
        const top = index === 0 ? G.firstPageBodyTopIn : G.topMarginIn;
        sheet.drawRectangle({
          x: pt(G.sideMarginIn), y: pt(hasFooter ? 1.5 : G.bottomMarginIn),
          width: pt(G.sheetWidthIn - 2 * G.sideMarginIn),
          height: pt(G.sheetHeightIn - top - (hasFooter ? 1.5 : G.bottomMarginIn)),
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
    } catch (error) {
      // Fixed fields only; private HTML and raw browser errors never reach logs.
      storageLogger.error("Letter PDF preparation failed", {
        source: "letter-renderer", module: "comm", operation: "render_pdf",
        lane: options.previewGuides ? "preview" : "delivery",
        ...letterFailureContext(error, stage),
        ...(isMaintenanceModeError(error) ? { category: "maintenance" } : {}),
      });
      throw error;
    } finally {
      await browser?.close();
    }
  }).catch((error: unknown) => {
    if (!entered) {
      storageLogger.error("Letter PDF preparation failed", {
        source: "letter-renderer", module: "comm", operation: "render_pdf",
        lane: options.previewGuides ? "preview" : "delivery",
        ...letterFailureContext(error, "queue"),
      });
    }
    throw error;
  });
}