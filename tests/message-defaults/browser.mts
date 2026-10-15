import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { PDFDocument } from "pdf-lib";
import { findSystemHelpsForPath, getAllSystemHelps } from "../../server/help/system/index";
import { mkdir } from "node:fs/promises";

// Real shipped settings, compose, and Help UI; only HTTP data is fixture-backed.
// No application server, database mutations, provider configuration or sends.
const root = process.cwd();
const saved: Record<string, any> = {
  email: { letterheadHtml: "" },
  postal: { letterheadHtml: "", footerHtml: "", showPageCount: false },
};
const requests: Array<{ path: string; method: string; body: any }> = [];
const errors: string[] = [];
const localHelp = { id: "fixture-local", source: "config", paths: ["/config/email"], summary: "Local procedure stays intact.", details: "<p>Local content.</p>" };
const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
const pdfBytes = Buffer.from(await pdf.save());
let failLoad = false;
let failSave = false;
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-message-defaults"),
  plugins: [react(), {
    name: "message-defaults-fixture",
    configureServer(vite) {
      vite.middlewares.use((req, _res, next) => {
        if (/^\/(config\/(?:email|postal|helps)|workers\/fixture\/comm\/send-email)(?:\?|$)/.test(req.url || "")) req.url = "/tests/message-defaults/browser.html";
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  optimizeDeps: { entries: [path.join(root, "tests/message-defaults/browser.html")], holdUntilCrawlEnd: false },
  server: { host: "127.0.0.1", port: 5191, strictPort: true, hmr: false, watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/generated-artifacts/**"] } },
});
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  await server.listen();
  browser = await puppeteer.launch({
    executablePath: ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync),
    headless: true, timeout: 60_000, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(30_000);
  await page.setViewport({ width: 1360, height: 1000 });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return void request.continue();
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()!) : undefined;
    requests.push({ path: url.pathname, method, body });
    const json = (data: unknown, status = 200) => request.respond({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname === "/api/auth/user") return void json({ user: { id: "fixture", email: "admin@example.invalid" }, permissions: ["admin", "staff"], components: ["email", "postal"] });
    if (url.pathname === "/api/helps/lookup") {
      const route = url.searchParams.get("path")!;
      return void json([...findSystemHelpsForPath(route), ...(route === "/config/email" ? [localHelp] : [])]);
    }
    if (url.pathname === "/api/helps") return void json([...getAllSystemHelps(), localHelp]);
    if (url.pathname.startsWith("/api/email-optin/")) return void json({ optin: true, allowlist: true });
    if (url.pathname === "/api/options/comm-tag") return void json([]);
    const match = url.pathname.match(/^\/api\/config\/(email|postal)\/message-defaults(\/preview)?$/);
    if (match) {
      const medium = match[1];
      if (match[2]) {
        if (medium === "postal") return void request.respond({ status: 200, contentType: "application/pdf", body: pdfBytes });
        return void json({ html: `${body.letterheadHtml}<p>Example message</p>`, text: `${body.letterheadHtml.replace(/<[^>]*>/g, "")}\nExample message` });
      }
      if (method === "GET") return void json(failLoad ? { message: "Fixture load refusal" } : saved[medium], failLoad ? 500 : 200);
      if (failSave) return void json({ message: "Fixture save refusal" }, 422);
      saved[medium] = structuredClone(body); return void json(saved[medium]);
    }
    if (url.pathname === "/api/comm/email/preview") return void json({ html: saved.email.letterheadHtml + body.bodyHtml, text: (saved.email.letterheadHtml + body.bodyHtml).replace(/<[^>]*>/g, "") });
    if (/^\/api\/config\/(email|postal)$/.test(url.pathname)) return void json({
      defaultProvider: "local", providers: [{ id: "local", displayName: "Local", supportedFeatures: [] }],
      currentProvider: { id: "local", supportedFeatures: [], connection: { success: false } },
    });
    if (/^\/api\/config\/(sendgrid|lob|email\/default-from|postal\/return-address)$/.test(url.pathname)) return void json({});
    errors.push(`Unexpected request: ${method} ${url.pathname}`);
    return void json({ message: "Unexpected fixture request" }, 500);
  });
  const goto = (route: string) => page.goto(`http://127.0.0.1:5191${route}`, { waitUntil: "domcontentloaded" });
  const clickText = async (text: string) => {
    await page.waitForFunction((text) => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === text), {}, text);
    const buttons = await page.$$("button");
    for (const button of buttons) {
      if ((await button.evaluate((el) => el.textContent?.trim())) === text) { await button.click(); return; }
    }
    throw new Error(`No button: ${text}`);
  };
  const fillEditor = async (testId: string, text: string) => {
    const selector = `[data-testid="${testId}"][contenteditable="true"], [data-testid="${testId}"] [contenteditable="true"]`;
    await page.waitForSelector(selector);
    await page.click(selector);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.type(text);
  };
  await goto("/config/email");
  await page.waitForSelector('[data-testid="email-letterhead-editor"]');
  await fillEditor("email-letterhead-editor", "EMAIL DRAFT");
  await clickText("Preview unsaved changes");
  await page.waitForSelector('iframe[title="Rendered email preview"]');
  assert.equal(saved.email.letterheadHtml, "");
  const emailFrame = await (await page.$('iframe[title="Rendered email preview"]'))!.contentFrame();
  assert.match(await emailFrame!.$eval("body", (el) => el.textContent!), /EMAIL DRAFT/);
  await clickText("Close"); await page.waitForSelector('[role="dialog"]', { hidden: true });
  await clickText("Save defaults");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save defaults")?.disabled === true);
  assert.match(saved.email.letterheadHtml, /EMAIL DRAFT/);
  await goto("/config/email");
  await page.waitForSelector('[data-testid="email-letterhead-editor"]');
  assert.match(await page.$eval('[data-testid="email-letterhead-editor"]', (el) => el.textContent!), /EMAIL DRAFT/);
  // Shipped Help dialog and listing, populated with real built-in registry data.
  await page.click('[data-testid="button-help-more-system:email-message-defaults"]');
  await page.waitForSelector('[role="dialog"]');
  assert.match(await page.$eval('[role="dialog"]', (el) => el.textContent!), /queued work/);
  await clickText("Close"); await page.waitForSelector('[role="dialog"]', { hidden: true });
  await goto("/config/postal");
  await fillEditor("postal-letterhead-editor", "POSTAL DRAFT");
  await fillEditor("postal-footer-editor", "REPEATING FOOTER");
  await page.click("#postal-page-count");
  await clickText("Preview unsaved changes");
  await page.waitForSelector('iframe[title="Postal message PDF preview"]');
  assert.equal(saved.postal.letterheadHtml, "");
  await clickText("Close"); await page.waitForSelector('[role="dialog"]', { hidden: true });
  await clickText("Save defaults");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save defaults")?.disabled === true);
  assert.match(saved.postal.footerHtml, /REPEATING FOOTER/); assert.equal(saved.postal.showPageCount, true);
  assert.match(saved.email.letterheadHtml, /EMAIL DRAFT/);
  await page.click('[data-testid="button-help-more-system:postal-message-defaults"]');
  assert.match(await page.$eval('[role="dialog"]', (el) => el.textContent!), /every page/);
  await page.setViewport({ width: 402, height: 874 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await clickText("Close"); await page.waitForSelector('[role="dialog"]', { hidden: true });
  await mkdir("generated-artifacts/message-defaults", { recursive: true });
  await page.screenshot({ path: "generated-artifacts/message-defaults/postal-settings-mobile.png", fullPage: true });
  await page.setViewport({ width: 1360, height: 1000 });
  await goto("/workers/fixture/comm/send-email");
  await fillEditor("input-email-body", "COMPOSE BODY");
  await page.waitForSelector('iframe[title="Email body preview"]');
  await page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('iframe[title="Email body preview"]')?.srcdoc.includes("EMAIL DRAFT"));
  assert.doesNotMatch(await page.$eval('[data-testid="input-email-body"] [contenteditable="true"]', (el) => el.textContent!), /EMAIL DRAFT/);
  await goto("/config/helps");
  await page.waitForSelector("table");
  const helpText = await page.$eval("table", (el) => el.textContent!);
  assert.match(helpText, /System/); assert.match(helpText, /Built-in/); assert.match(helpText, /Local procedure stays intact/);
  assert.equal(requests.some((req) => req.path.includes("/contacts/") && req.method === "POST"), false);
  await goto("/config/email");
  failSave = true;
  await clickText("Clear Email Letterhead"); await clickText("Save defaults");
  await page.waitForFunction(() => document.body.textContent?.includes("Save failed"));
  assert.match(saved.email.letterheadHtml, /EMAIL DRAFT/);
  failSave = false; await clickText("Save defaults");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Save defaults")?.disabled === true);
  assert.equal(saved.email.letterheadHtml, "");
  assert.match(saved.postal.letterheadHtml, /POSTAL DRAFT/);
  // Load errors refuse to show editable blanks, rather than overwriting settings.
  failLoad = true;
  await goto("/config/postal");
  await page.waitForFunction(() => document.body.textContent?.includes("Could not load message defaults"));
  assert.equal(await page.$('[data-testid="postal-letterhead-editor"]'), null);
  failLoad = false; await clickText("Retry");
  await page.waitForSelector('[data-testid="postal-letterhead-editor"]');
  assert.deepEqual(errors, []);
  console.log("PASS: settings persistence/independence, clear, preview-only, error/retry, compose source isolation, built-in Help dialogs/listing, mobile fit; no sends.");
} catch (error) {
  console.error("Browser fixture failed:", error, errors, requests.slice(-15));
  throw error;
} finally {
  await browser?.close();
  await Promise.race([server.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("Vite shutdown timed out")), 10_000))]);
}
