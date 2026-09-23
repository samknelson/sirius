/**
 * Opt-in proof that Lob's TEST API accepts the exact locally rendered PDF
 * payload used by postal delivery.
 *
 * This creates only a Lob test-mode letter object. Lob test keys never mail
 * physical pieces. The two gates below deliberately make the script refuse a
 * live key even when someone runs it accidentally.
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-lob-test-pdf.ts --run
 */
import { renderLetterPdf } from "../../server/services/comm/letter-pdf";
import { LobPostalProvider } from "../../server/services/comm/providers/postal/lob";
import type { PostalAddress } from "../../server/services/comm/providers/postal";
import { downloadRemoteLetterPdf } from "../../server/services/comm/remote-letter-pdf";
import { getEnvironmentVariable } from "../../server/config/env-registry";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

if (!process.argv.includes("--run")) {
  throw new Error(
    "Refusing to create a Lob test object without the explicit --run argument.",
  );
}

const apiKey = getEnvironmentVariable("LOB_API_KEY");
if (!apiKey?.startsWith("test_")) {
  throw new Error(
    "Refusing Lob proof: LOB_API_KEY is missing or is not definitely a test-mode key.",
  );
}

const syntheticAddress: PostalAddress = {
  name: "Lob Test Recipient",
  addressLine1: "deliverable",
  city: "Test City",
  state: "CA",
  zip: "11111",
  country: "US",
};

const body = `
  <h1 style="color: #17365d">Template HTML proof</h1>
  <p>This PDF was rendered locally before upload.</p>
  <img
    src="https://httpbin.org/image/png"
    alt="Synthetic proof image"
    style="display: block; width: 72px; height: 72px; margin: 8px 0"
  >
  <table style="width: 100%; border-collapse: collapse">
    <tbody>
      <tr>
        <th style="border: 1px solid #333; padding: 6px">Column A</th>
        <th style="border: 1px solid #333; padding: 6px">Column B</th>
      </tr>
      <tr>
        <td style="border: 1px solid #333; padding: 6px">Preserved</td>
        <td style="border: 1px solid #333; padding: 6px">Locally rendered</td>
      </tr>
    </tbody>
  </table>
  <div data-template-page-break="true" style="break-before: page"></div>
  <p>Second page after an explicit page break.</p>
`;

const pdfFile = await renderLetterPdf(body);
if (!pdfFile.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
  throw new Error("The local renderer did not produce a PDF.");
}
const localDocument = await PDFDocument.load(pdfFile);
if (localDocument.getPageCount() !== 2) {
  throw new Error(`Expected the local PDF to have 2 pages; got ${localDocument.getPageCount()}.`);
}
for (const page of localDocument.getPages()) {
  const { width, height } = page.getSize();
  if (Math.abs(width - 612) > 1 || Math.abs(height - 792) > 1) {
    throw new Error(`Expected US Letter pages; got ${width} x ${height} points.`);
  }
}

const provider = new LobPostalProvider();
const result = await provider.sendLetter({
  to: syntheticAddress,
  from: syntheticAddress,
  pdfFile,
  description: "Sirius local PDF test-mode proof",
  options: {
    color: true,
    doubleSided: false,
    mailType: "usps_first_class",
    useType: "operational",
  },
  metadata: { proof: "local_template_pdf" },
});

if (!result.success || !result.letterId) {
  throw new Error(`Lob test-mode proof was rejected: ${result.error ?? "no letter ID"}`);
}

const proofUrl = result.details?.url;
if (typeof proofUrl !== "string") {
  throw new Error("Lob accepted the letter but did not provide a proof PDF.");
}
let lobProof: Buffer | undefined;
let proofDownloadError: unknown;
for (const delayMs of [0, 2_000, 5_000, 10_000, 15_000, 20_000]) {
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  try {
    lobProof = await downloadRemoteLetterPdf(proofUrl);
    break;
  } catch (error) {
    proofDownloadError = error;
  }
}
if (!lobProof) {
  throw new Error(
    `Lob accepted the letter but its proof PDF remained unavailable: ${
      proofDownloadError instanceof Error ? proofDownloadError.message : "download failed"
    }`,
  );
}
const proofDocument = await PDFDocument.load(lobProof);
if (proofDocument.getPageCount() !== localDocument.getPageCount()) {
  throw new Error(
    `Lob proof page count changed from ${localDocument.getPageCount()} to ${proofDocument.getPageCount()}.`,
  );
}
for (const page of proofDocument.getPages()) {
  const { width, height } = page.getSize();
  if (Math.abs(width - 612) > 1 || Math.abs(height - 792) > 1) {
    throw new Error(`Lob proof changed a page from US Letter to ${width} x ${height} points.`);
  }
}

const work = await mkdtemp(join(tmpdir(), "lob-pdf-proof-"));
try {
  const localPath = join(work, "local.pdf");
  const proofPath = join(work, "proof.pdf");
  const localBboxPath = join(work, "local.xml");
  const proofBboxPath = join(work, "proof.xml");
  await Promise.all([
    writeFile(localPath, pdfFile),
    writeFile(proofPath, lobProof),
  ]);
  await Promise.all([
    execFileAsync("pdftotext", ["-bbox", localPath, localBboxPath]),
    execFileAsync("pdftotext", ["-bbox", proofPath, proofBboxPath]),
  ]);
  const [localBbox, proofBbox, localImages, proofImages] = await Promise.all([
    readFile(localBboxPath, "utf8"),
    readFile(proofBboxPath, "utf8"),
    execFileAsync("pdfimages", ["-list", localPath]).then(({ stdout }) => stdout),
    execFileAsync("pdfimages", ["-list", proofPath]).then(({ stdout }) => stdout),
  ]);

  const markerPosition = (xml: string, marker: string) => {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [pageIndex, page] of xml.split(/<page\b/).slice(1).entries()) {
      const match = page.match(
        new RegExp(`<word xMin="([^"]+)" yMin="([^"]+)"[^>]*>${escaped}<\\/word>`),
      );
      if (match) {
        return { page: pageIndex + 1, x: Number(match[1]), y: Number(match[2]) };
      }
    }
    throw new Error(`Could not locate "${marker}" in a rendered PDF.`);
  };
  const localFirst = markerPosition(localBbox, "Template");
  const proofFirst = markerPosition(proofBbox, "Template");
  const localTable = markerPosition(localBbox, "Preserved");
  const proofTable = markerPosition(proofBbox, "Preserved");
  const localSecond = markerPosition(localBbox, "Second");
  const proofSecond = markerPosition(proofBbox, "Second");
  const close = (a: number, b: number) => Math.abs(a - b) <= 4;
  if (
    localFirst.page !== 1 ||
    proofFirst.page !== 1 ||
    localTable.page !== 1 ||
    proofTable.page !== 1 ||
    localSecond.page !== 2 ||
    proofSecond.page !== 2 ||
    !close(localFirst.x, proofFirst.x) ||
    !close(localFirst.y, proofFirst.y) ||
    !close(localTable.x, proofTable.x) ||
    !close(localTable.y, proofTable.y) ||
    !close(localSecond.x, proofSecond.x) ||
    !close(localSecond.y, proofSecond.y)
  ) {
    throw new Error(
      "Lob proof moved representative content from its local PDF placement " +
      `(page 1 local ${localFirst.x.toFixed(2)},${localFirst.y.toFixed(2)} vs proof ${proofFirst.x.toFixed(2)},${proofFirst.y.toFixed(2)}; ` +
      `page 2 local ${localSecond.x.toFixed(2)},${localSecond.y.toFixed(2)} vs proof ${proofSecond.x.toFixed(2)},${proofSecond.y.toFixed(2)}).`,
    );
  }
  // PDF bbox coordinates run down from the top. Page-one body must stay below
  // the three-inch reserve, and the explicit break must put this marker on page 2.
  if (localFirst.y < 216 || proofFirst.y < 216) {
    throw new Error("Page-one content entered the three-inch address reserve.");
  }
  const imageRows = (list: string) =>
    list.split("\n").filter((line) => /^\s*\d+\s+\d+\s+\w+/.test(line)).length;
  if (imageRows(localImages) < 1 || imageRows(proofImages) < 1) {
    throw new Error("The representative raster image was absent from a PDF.");
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

console.log(
  "Verified Lob test proof: 2 US Letter pages, raster image, table content, explicit page break, address reserve, and content placement match the local PDF; no physical mail was created.",
);