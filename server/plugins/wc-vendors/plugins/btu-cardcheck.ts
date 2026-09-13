import { randomUUID } from "node:crypto";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
import { registerEnvironmentVariables } from "../../../config/env-registry";
import { logger } from "../../../logger";
import { registerWcVendorPlugin } from "../registry";
import type { WcVendorContext } from "../types";
import { redactCredentialText } from "./credential-redaction";

export const BTU_CARDCHECK_PLUGIN_ID = "btu-cardcheck";
export const BTU_SCRAPE_LOGIN = "login";
export const BTU_SCRAPE_FETCH_CARDCHECK = "fetch-cardcheck";
export const LEGACY_BTU_SITE_URL = "https://sirius-btu.activistcentral.net";
export const LEGACY_BTU_CHROMIUM_PATH =
  "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";

export interface BtuScrapeLoginResult {
  sessionId: string;
}

export interface BtuScrapeCardcheckResult {
  pdfBase64: string;
}

declare module "../types" {
  interface WcVendorOperations {
    login: { args: void; result: BtuScrapeLoginResult };
    "fetch-cardcheck": {
      args: { sessionId: string; nid: string };
      result: BtuScrapeCardcheckResult;
    };
  }
}

registerEnvironmentVariables([
  {
    name: "BTU_SCRAPER_USERNAME",
    description: "Legacy login username for the BTU card-check scraper.",
    secret: false,
    category: "sitespecific.btu",
    changeTakesEffect: "immediate",
  },
  {
    name: "BTU_SCRAPER_PASSWORD",
    description: "Login password for the BTU card-check scraper.",
    secret: true,
    category: "sitespecific.btu",
    changeTakesEffect: "immediate",
  },
]);

interface BtuConnectionSettings {
  siteUrl: string;
  username: string;
  chromiumPath: string;
}

interface Session {
  browser: Browser;
  page: Page;
  timer: NodeJS.Timeout;
  configId: string;
  settings: BtuConnectionSettings;
  scrub(text: string): string;
}

const SESSION_TTL_MS = 15 * 60 * 1000;

function connectionSettings(ctx: WcVendorContext): BtuConnectionSettings {
  const data =
    ctx.config.data && typeof ctx.config.data === "object"
      ? ctx.config.data as Record<string, unknown>
      : {};
  const siteUrl = typeof data.siteUrl === "string" ? data.siteUrl.trim() : "";
  const username = typeof data.username === "string" ? data.username.trim() : "";
  const chromiumPath =
    typeof data.chromiumPath === "string" ? data.chromiumPath.trim() : "";
  if (!siteUrl || !username || !chromiumPath) {
    throw new Error(
      "The BTU card-check connection requires Site URL, Username, and Chromium Path.",
    );
  }
  return { siteUrl: siteUrl.replace(/\/+$/, ""), username, chromiumPath };
}

function safeError(error: unknown, scrub: (text: string) => string): Error {
  return new Error(scrub(error instanceof Error ? error.message : String(error)));
}

async function fetchSameOrigin(
  initialUrl: URL,
  allowedOrigin: string,
  cookieHeader: string,
): Promise<Response> {
  let target = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (target.protocol !== "https:" || target.origin !== allowedOrigin) {
      throw new Error("BTU attachment URL is outside the configured site.");
    }
    const response = await fetch(target, {
      headers: { Cookie: cookieHeader },
      redirect: "manual",
    });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("BTU attachment redirect has no location.");
    target = new URL(location, target);
  }
  throw new Error("BTU attachment redirected too many times.");
}

export class BtuCardcheckRuntime {
  private readonly sessions = new Map<string, Session>();

  private armExpiry(sessionId: string, session: Omit<Session, "timer">): Session {
    const timer = setTimeout(() => {
      void this.close(sessionId);
    }, SESSION_TTL_MS);
    timer.unref();
    return { ...session, timer };
  }

  private refreshExpiry(sessionId: string, session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      void this.close(sessionId);
    }, SESSION_TTL_MS);
    session.timer.unref();
  }

  async login(
    ctx: WcVendorContext,
    browser: Browser,
  ): Promise<BtuScrapeLoginResult> {
    const settings = connectionSettings(ctx);
    const scrub = (text: string) =>
      redactCredentialText(
        redactCredentialText(text, ctx.credential.value),
        settings.username,
      );
    try {
      const page = await browser.newPage();
      await page.goto(new URL("/user/login", settings.siteUrl).toString(), {
        waitUntil: "networkidle2",
        timeout: 60_000,
      });
      const hasLoginForm = await page.evaluate(
        () => Boolean(document.querySelector("#edit-name")),
      );
      if (!hasLoginForm) {
        throw new Error(`Login form not found. Page title: ${scrub(await page.title())}`);
      }
      await page.type("#edit-name", settings.username);
      await page.type("#edit-pass", ctx.credential.value);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }),
        page.click("#edit-submit"),
      ]);
      const loginError = await page.evaluate(() => {
        const element = document.querySelector(".messages.error, .error-message");
        return element?.textContent?.trim() || null;
      });
      if (loginError) throw new Error(`Login failed: ${scrub(loginError)}`);

      const sessionId = randomUUID();
      this.sessions.set(
        sessionId,
        this.armExpiry(sessionId, {
          browser,
          page,
          configId: ctx.config.id,
          settings,
          scrub,
        }),
      );
      return { sessionId };
    } catch (error) {
      await browser.close().catch(() => {});
      throw safeError(error, scrub);
    }
  }

  async fetchCardcheck(
    ctx: WcVendorContext,
    args: { sessionId: string; nid: string },
  ): Promise<BtuScrapeCardcheckResult> {
    const session = this.sessions.get(args.sessionId);
    if (!session) throw new Error("The BTU scrape session is unavailable or expired.");
    if (session.configId !== ctx.config.id) {
      throw new Error("The BTU scrape session belongs to a different connection.");
    }
    this.refreshExpiry(args.sessionId, session);
    try {
      const pageUrl = new URL(
        `/node/${encodeURIComponent(args.nid)}/sirius_log_cardcheck`,
        session.settings.siteUrl,
      );
      await session.page.goto(pageUrl.toString(), {
        waitUntil: "networkidle2",
        timeout: 60_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const pageTitle = (await session.page.title()).toLowerCase();
      if (pageTitle.includes("access denied")) {
        throw new Error(`Access denied for NID ${args.nid}`);
      }
      if (pageTitle.includes("not found") || pageTitle.includes("page not found")) {
        throw new Error(`Page not found for NID ${args.nid}`);
      }

      const pagePdf = await session.page.pdf({
        format: "Letter",
        printBackground: true,
      });
      const attachedPdfUrls: string[] = await session.page.evaluate(() =>
        Array.from(document.querySelectorAll("a[href]"))
          .map((element) => (element as HTMLAnchorElement).href)
          .filter((href) => href.toLowerCase().endsWith(".pdf")),
      );
      const cookies = await session.page.cookies();
      const cookieHeader = cookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

      let combinedBytes: Uint8Array;
      try {
        const combined = await PDFDocument.create();
        const renderedPage = await PDFDocument.load(pagePdf);
        for (const page of await combined.copyPages(
          renderedPage,
          renderedPage.getPageIndices(),
        )) {
          combined.addPage(page);
        }
        for (const pdfUrl of attachedPdfUrls) {
          try {
            const target = new URL(pdfUrl);
            const allowedOrigin = new URL(session.settings.siteUrl).origin;
            const response = await fetchSameOrigin(
              target,
              allowedOrigin,
              cookieHeader,
            );
            if (!response.ok) continue;
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length < 100) continue;
            const attachment = await PDFDocument.load(bytes, { ignoreEncryption: true });
            for (const page of await combined.copyPages(
              attachment,
              attachment.getPageIndices(),
            )) {
              combined.addPage(page);
            }
          } catch {
            logger.warn("BTU card-check attachment could not be downloaded or parsed", {
              service: "btu-cardcheck",
              nid: args.nid,
            });
          }
        }
        combinedBytes = await combined.save();
      } catch {
        logger.warn("BTU card-check attachments could not be combined; using page PDF", {
          service: "btu-cardcheck",
          nid: args.nid,
        });
        combinedBytes = new Uint8Array(pagePdf);
      }
      return { pdfBase64: Buffer.from(combinedBytes).toString("base64") };
    } catch (error) {
      throw safeError(error, session.scrub);
    }
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    clearTimeout(session.timer);
    await session.browser.close().catch(() => {});
  }

  activeSessionCount(): number {
    return this.sessions.size;
  }
}

const runtime = new BtuCardcheckRuntime();

/** Local resource cleanup, not an outbound vendor operation. */
export function closeBtuCardcheckSession(sessionId: string): Promise<void> {
  return runtime.close(sessionId);
}

registerWcVendorPlugin({
  id: BTU_CARDCHECK_PLUGIN_ID,
  name: "BTU Card Check",
  description: "Authenticated browser access to BTU card-check signature pages.",
  requiredComponent: "sitespecific.btu",
  service: "BTU",
  credential: {
    secretName: "required",
    setupGuidance: "Name the secret containing the BTU card-check login password.",
    setupExample: "BTU_SCRAPER_PASSWORD",
  },
  configFields: [
    { name: "siteUrl", label: "Site URL", type: "string", required: true },
    { name: "username", label: "Username", type: "string", required: true },
    { name: "chromiumPath", label: "Chromium Path", type: "string", required: true },
  ],
  validateConfig: (data) => {
    try {
      const url = new URL(String(data.siteUrl ?? ""));
      if (url.protocol !== "https:") throw new Error("not HTTPS");
    } catch {
      return { valid: false, errors: ["Site URL must be a valid HTTPS URL."] };
    }
    return { valid: true };
  },
  operations: {
    login: {
      description: "sign in to the BTU site",
      needsWritableDatabase: true,
      cache: { mode: "uncached" },
      run: async (ctx) => {
        const { chromiumPath } = connectionSettings(ctx);
        const browser = await puppeteer.launch({
          headless: true,
          executablePath: chromiumPath,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        });
        return runtime.login(ctx, browser);
      },
    },
    "fetch-cardcheck": {
      description: "fetch a card check page from the BTU site",
      needsWritableDatabase: true,
      cache: { mode: "uncached" },
      run: (ctx, args) => runtime.fetchCardcheck(ctx, args),
    },
  },
});