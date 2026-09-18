import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request } from "node:https";
import { PDFDocument } from "pdf-lib";
import { assertExternalServiceAllowed } from "../maintenance-flag";

const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const LETTER_WIDTH_POINTS = 612;
const LETTER_HEIGHT_POINTS = 792;
const PAGE_SIZE_TOLERANCE_POINTS = 1;

interface DownloadState {
  expired: boolean;
  request?: ClientRequest;
  response?: IncomingMessage;
}

function fail(message: string): Error {
  return new Error(`Remote letter PDF refused: ${message}`);
}

function parseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw fail("the URL is invalid.");
  }
  if (url.protocol !== "https:") throw fail("only HTTPS URLs are allowed.");
  if (url.port && url.port !== "443") throw fail("HTTPS must use port 443.");
  if (url.username || url.password) throw fail("URL user information is not allowed.");
  if (!url.hostname) throw fail("the URL has no hostname.");

  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if (isIP(host) === 6) throw fail("IPv6 addresses are not supported.");
  return url;
}

function ipv4Number(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;
  const octets = address.split(".").map(Number);
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function inCidr(value: number, base: number, prefix: number): boolean {
  const blockSize = 2 ** (32 - prefix);
  return Math.floor(value / blockSize) === Math.floor(base / blockSize);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === undefined) return false;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["192.88.99.0", 24],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3],
  ];
  return !blocked.some(([base, prefix]) => inCidr(value, ipv4Number(base)!, prefix));
}

function hostnameWithoutBrackets(url: URL): string {
  return url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
}

async function resolvePublicAddress(url: URL, state: DownloadState): Promise<string> {
  const hostname = hostnameWithoutBrackets(url);
  const literal = ipv4Number(hostname);
  let addresses: string[];
  if (literal !== undefined) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve4(hostname);
    } catch {
      throw fail("the hostname does not resolve to an IPv4 address.");
    }
  }
  if (state.expired) throw fail("the download timed out.");
  if (addresses.length === 0) throw fail("the hostname does not resolve to an IPv4 address.");
  if (addresses.some((address) => !isPublicIpv4(address))) {
    throw fail("the hostname resolves to a private or reserved address.");
  }
  return addresses[0];
}

function pinnedLookup(address: string) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (options?.all) callback(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  };
}

function requestHop(url: URL, redirects: number, state: DownloadState): Promise<Buffer> {
  return resolvePublicAddress(url, state).then((address) => {
    if (state.expired) throw fail("the download timed out.");

    return new Promise<Buffer>((resolve, reject) => {
      let finished = false;
      const finish = (error?: Error, value?: Buffer) => {
        if (finished) return;
        finished = true;
        state.request = undefined;
        state.response = undefined;
        if (error) reject(error);
        else resolve(value!);
      };

      const req = request(url, {
        method: "GET",
        agent: false,
        lookup: pinnedLookup(address) as never,
        headers: { Accept: "application/pdf" },
      }, (res) => {
        state.response = res;
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = res.headers.location;
          res.destroy();
          if (!location) return finish(fail("a redirect had no Location header."));
          if (redirects >= MAX_REDIRECTS) return finish(fail("too many redirects."));
          let target: URL;
          try {
            target = new URL(location, url);
            parseUrl(target.href);
          } catch (error) {
            return finish(error instanceof Error ? error : fail("the redirect URL is invalid."));
          }
          state.request = undefined;
          state.response = undefined;
          void requestHop(target, redirects + 1, state).then(
            (body) => finish(undefined, body),
            (error) => finish(error instanceof Error ? error : fail("the download failed.")),
          );
          return;
        }
        if (status < 200 || status >= 300) {
          res.destroy();
          return finish(fail(`the server returned HTTP ${status}.`));
        }

        const contentType = String(res.headers["content-type"] ?? "")
          .split(";", 1)[0].trim().toLowerCase();
        if (contentType !== "application/pdf") {
          res.destroy();
          return finish(fail("the response is not application/pdf."));
        }
        const declaredLength = Number(res.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
          res.destroy();
          return finish(fail("the PDF exceeds the 5 MB limit."));
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer | Uint8Array | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.length;
          if (size > MAX_PDF_BYTES) {
            res.destroy();
            finish(fail("the PDF exceeds the 5 MB limit."));
            return;
          }
          chunks.push(bytes);
        });
        res.once("end", () => finish(undefined, Buffer.concat(chunks, size)));
        res.once("error", () => finish(fail("the response failed.")));
        res.once("aborted", () => finish(fail("the response ended before the PDF was complete.")));
      });
      state.request = req;
      req.once("error", () => finish(fail("the request failed.")));
      req.end();
    });
  });
}

async function validatePdf(bytes: Buffer): Promise<void> {
  if (bytes.length < 5 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw fail("the response does not have a valid PDF signature.");
  }
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch {
    throw fail("the response is not a valid PDF document.");
  }
  if (pdf.getPageCount() === 0) throw fail("the PDF has no pages.");
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const portrait = Math.abs(width - LETTER_WIDTH_POINTS) <= PAGE_SIZE_TOLERANCE_POINTS
      && Math.abs(height - LETTER_HEIGHT_POINTS) <= PAGE_SIZE_TOLERANCE_POINTS;
    const landscape = Math.abs(width - LETTER_HEIGHT_POINTS) <= PAGE_SIZE_TOLERANCE_POINTS
      && Math.abs(height - LETTER_WIDTH_POINTS) <= PAGE_SIZE_TOLERANCE_POINTS;
    if (!portrait && !landscape) throw fail("every PDF page must be US Letter size.");
  }
}

/**
 * Downloads an existing PDF for Lob without allowing the URL to become an
 * SSRF or HTML-rendering escape hatch.
 */
export function downloadRemoteLetterPdf(url: string): Promise<Buffer> {
  assertExternalServiceAllowed("Lob", "download remote letter PDF");

  const state: DownloadState = { expired: false };
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(() => {
      state.expired = true;
      const error = fail("the download timed out.");
      // This is a true overall deadline, not merely a socket-idle timeout.
      // It also tears down both sides of any request currently in flight.
      settle(error);
      state.response?.destroy(error);
      state.request?.destroy(error);
    }, DOWNLOAD_TIMEOUT_MS);

    let parsed: URL;
    try {
      parsed = parseUrl(url);
    } catch (error) {
      settle(error instanceof Error ? error : fail("the URL is invalid."));
      return;
    }
    void requestHop(parsed, 0, state)
      .then(async (bytes) => {
        await validatePdf(bytes);
        settle(undefined, bytes);
      })
      .catch((error) => settle(error instanceof Error ? error : fail("the download failed.")));
  });
}