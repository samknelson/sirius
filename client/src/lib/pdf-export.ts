import type { TDocumentDefinitions } from "pdfmake/interfaces";

type PdfMake = typeof import("pdfmake/build/pdfmake");

let pdfMakePromise: Promise<PdfMake> | null = null;

/**
 * Loads pdfmake and its embedded font file (~2 MB) on demand.
 *
 * Both are imported dynamically so the font payload is fetched the first time
 * a PDF is generated rather than on page load. The two imports are sequential
 * on purpose: pdfmake's build publishes itself as a global on evaluation and
 * vfs_fonts registers its fonts against that global, so loading them in
 * parallel would let the fonts miss their registration.
 *
 * The promise is cached so repeated exports reuse the same instance; a failed
 * load is not cached, so a retry can succeed.
 */
export function loadPdfMake(): Promise<PdfMake> {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const pdfMakeModule = await import("pdfmake/build/pdfmake");
      const pdfFontsModule = await import("pdfmake/build/vfs_fonts");
      // The bundled builds expose themselves as the interop default; fall back
      // to the namespace so either shape works.
      const pdfMake = ((pdfMakeModule as any).default ?? pdfMakeModule) as PdfMake;
      const pdfFonts: any = (pdfFontsModule as any).default ?? pdfFontsModule;
      pdfMake.vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs || pdfFonts;
      return pdfMake;
    })().catch((err) => {
      pdfMakePromise = null;
      throw err;
    });
  }
  return pdfMakePromise;
}

/** Builds the document with pdfmake and triggers a browser download. */
export async function downloadPdf(
  docDefinition: TDocumentDefinitions,
  fileName: string,
): Promise<void> {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(docDefinition).download(fileName);
}
