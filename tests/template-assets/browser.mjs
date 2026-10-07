import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = process.cwd();
const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
assert.ok(executablePath, "Chromium is required");
const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=", "base64");
const url = "https://assets.example.invalid/public-files/assets/custom/images/owner/logo.png";
const errors = [];
const uploads = [];
let refuseUpload = false;
const temp = await mkdtemp(path.join(tmpdir(), "template-asset-browser-"));
const fixture = path.join(temp, "logo.png");
await writeFile(fixture, bytes);
const server = await createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-template-assets-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/template-assets/browser.html")], holdUntilCrawlEnd: false },
  plugins: [react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: 5191, strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/screenshots/**"] } },
});
let browser;
function api(pathname, method, data) {
  if (pathname === "/api/auth/user") return {
    user: { id: "staff-fixture", email: "staff@example.invalid", isActive: true },
    permissions: ["staff", "admin", "bulk.edit"], components: ["bulk"],
  };
  if (pathname === "/api/variables/by-name/system_mode" || pathname === "/api/variables/by-name/site_terminology") return { value: null };
  if (pathname === "/api/catalogs/token-contexts") return { catalog: {
    id: "token-contexts", entries: ["compose-worker", "bulk-message", "fixture-notifier"].map(id => ({
      id, name: id, detail: { rootNames: [], media: ["email"] },
    })),
  } };
  if (pathname === "/api/token-studio/graph" || pathname === "/api/comm-compose/graph") return { segments: [], pickerEntries: [], fieldIndex: {} };
  if (pathname === "/api/token-studio/tree/roots") return { roots: [] };
  if (pathname === "/api/token-studio/preview-seeds" || pathname === "/api/comm-compose/preview-seeds") return { roots: [] };
  if (pathname === "/api/admin/letter-templates") return [];
  if (["/api/comm-compose/render", "/api/template-studio/preview"].includes(pathname) && method === "POST") return {
    sample: true, contactId: null, deliverable: true,
    fields: Object.fromEntries(Object.entries(data.values).map(([key, rendered]) =>
      [key, { rendered, unknownTokens: [], missingValues: [], emptyValues: [] }])),
  };
  if (pathname === "/api/token-studio/render" && method === "POST") return { fields: {} };
  throw new Error(`Unexpected fixture request ${method} ${pathname}`);
}
async function bounded(promise, ms = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Fixture operation timed out")), ms);
  })]); } finally { clearTimeout(timer); }
}
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", error => errors.push(error.stack || String(error)));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    try {
      const requestUrl = new URL(request.url());
      if (["data:", "blob:"].includes(requestUrl.protocol)) return await request.continue();
      if (request.url() === url) return await request.respond({ status: 200, contentType: "image/png", body: bytes });
      if (requestUrl.origin === new URL(url).origin && requestUrl.pathname === "/favicon.ico") {
        return await request.respond({ status: 404, body: "" });
      }
      assert.equal(requestUrl.origin, origin, "External network is forbidden");
      if (!requestUrl.pathname.startsWith("/api/")) return await request.continue();
      if (requestUrl.pathname === "/api/template-assets") {
        assert.equal(request.method(), "POST");
        assert.match(request.headers()["content-type"], /multipart\/form-data/);
        uploads.push({ host: new URL(page.url()).searchParams.get("host"), body: request.postData() });
        return await request.respond({ status: refuseUpload ? 503 : 201, contentType: "application/json",
          body: JSON.stringify(refuseUpload ? { message: "Template Assets is unconfigured." } : { url }) });
      }
      const data = request.postData() ? JSON.parse(request.postData()) : null;
      return await request.respond({ status: 200, contentType: "application/json",
        body: JSON.stringify(api(requestUrl.pathname, request.method(), data)) });
    } catch (error) { errors.push(String(error)); await request.abort(); }
  });
  for (const host of ["saved", "notifier", "manual", "bulk"]) {
    await page.goto(`${origin}/tests/template-assets/browser.html?host=${host}`, { waitUntil: "domcontentloaded" });
    await page.click('[data-testid="open-assets-studio"]');
    await page.waitForSelector('[data-testid="studio-editor-bodyHtml"]');
    await page.$eval('[data-testid="studio-editor-bodyHtml"]', el => {
      el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.click('[data-template-design-toolbar] button[aria-label="Insert"]');
    await page.$$eval("summary", nodes => nodes.find(el => el.textContent?.trim() === "Images")?.click());
    const input = await page.$('input[aria-label="Upload image"]');
    assert.ok(input, `${host} must offer upload`);
    await input.uploadFile(fixture);
    await page.waitForFunction(imageUrl => document.querySelector('input[aria-label="Image URL"]')?.value === imageUrl, {}, url);
    await page.evaluate(() => [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === "Insert image")?.click());
    await page.waitForSelector('[data-testid="studio-editor-bodyHtml"] img');
    assert.equal(await page.$eval('[data-testid="studio-editor-bodyHtml"] img', el => el.src), url);
    // Every drop entry also uses the same managed upload callback.
    await page.$eval('[data-testid="studio-editor-bodyHtml"]', (el, encoded) => {
      const content = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], "drop.png", { type: "image/png" }));
      const text = el.querySelector("p").firstChild;
      const range = document.createRange();
      range.setStart(text, Math.min(5, text.textContent.length));
      range.collapse(true);
      const point = range.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, dataTransfer: transfer,
        clientX: point.left, clientY: point.top + point.height / 2 };
      el.dispatchEvent(new DragEvent("dragover", options));
      el.dispatchEvent(new DragEvent("drop", options));
    }, bytes.toString("base64"));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="studio-editor-bodyHtml"] img').length === 2);
    await page.click('[data-testid="button-studio-done"]');
    await page.waitForSelector('[data-testid="dialog-template-studio"]', { hidden: true });
    assert.match(await page.$eval('[data-testid="host-html"]', el => el.textContent), /public-files\/assets\/custom\/images/);
    await page.click('[data-testid="cancel-form"]');
    assert.doesNotMatch(await page.$eval('[data-testid="host-html"]', el => el.textContent), /<img/);
    // Cancellation must not request attachment/file deletion.
    assert.equal((await page.goto(url)).status(), 200);
    console.log(`PASS ${host}: upload, drop, unsaved form, reusable URL, apply and cancel`);
  }
  assert.equal(uploads.length, 8);
  assert.deepEqual([...new Set(uploads.map(item => item.host))], ["saved", "notifier", "manual", "bulk"]);
  refuseUpload = true;
  await page.goto(`${origin}/tests/template-assets/browser.html?host=saved`);
  await page.click('[data-testid="open-assets-studio"]');
  await page.waitForSelector('[data-testid="studio-editor-bodyHtml"]');
  await page.click('[data-template-design-toolbar] button[aria-label="Insert"]');
  await page.$$eval("summary", nodes => nodes.find(el => el.textContent?.trim() === "Images")?.click());
  await (await page.$('input[aria-label="Upload image"]')).uploadFile(fixture);
  await page.waitForFunction(() => document.body.textContent.includes("Template Assets is unconfigured."));
  assert.equal(await page.$eval('input[aria-label="Image URL"]', el => el.value), "");
  assert.equal(await page.$$eval('[data-testid="studio-editor-bodyHtml"] img', nodes => nodes.length), 0);
  assert.deepEqual(errors, []);
  console.log("PASS failed upload shows error and inserts no temporary image; no deletion requests");
} catch (error) {
  console.error(error);
  console.error(errors);
  process.exitCode = 1;
} finally {
  if (browser) await bounded(browser.close());
  await bounded(server.close());
  await rm(temp, { recursive: true, force: true });
}
