import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.CHROMIUM_PATH || [
  "/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].find(existsSync);
assert.ok(executablePath, "Install Chromium and set CHROMIUM_PATH to its executable");
const content = { bodyHtml: "<p>Saved postal letter <strong>fixture</strong>.</p>", description: "Saved postal description" };
const contexts = ["compose-worker", "bulk-message"];
const failures = [];
const saves = [];
const reads = [];
const templateQueries = [];
const renders = [];
let stored = { bodyHtml: "", description: "", templateId: "", fileUrl: "", color: false, doubleSided: false, mailType: "usps_first_class" };
let browser;
// Keep lifecycle failures observable even if a Vite dependency crawl/close hangs.
async function bounded(label, operation, timeout = 30000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// No application config, environment files, backend proxy, DB or provider is loaded.
console.log("Creating isolated Vite frontend");
const server = await bounded("Vite createServer", createServer({
  configFile: false, envFile: false, root,
  cacheDir: path.join(root, "node_modules/.vite-postal-browser"),
  optimizeDeps: {
    entries: [path.join(root, "tests/postal-templates/browser.html")],
    holdUntilCrawlEnd: false,
  },
  plugins: [react(), {
    name: "postal-browser-entry",
    configureServer(s) {
      s.middlewares.use((req, _res, next) => {
        if (/^\/(editor-fixture|workers\/[^/]+\/comm\/send-postal|bulk\/[^/]+\/message)(\?|$)/.test(req.url || "")) {
          req.url = "/tests/postal-templates/browser.html";
        }
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: Number(process.env.POSTAL_BROWSER_PORT || 5188), strictPort: true, hmr: false },
}));

// Only explicit fixture endpoints can succeed; unexpected requests fail the suite.
function api(url, method, body) {
  const p = url.pathname;
  if (method === "GET" && p === "/api/auth/user") return {
    user: { id: "staff-fixture", email: "postal-staff@example.invalid", firstName: "Fixture", lastName: "Staff" },
    permissions: ["admin", "staff", "bulk.edit"], components: ["bulk", "postal"],
  };
  if (method === "GET" && ["/api/variables/by-name/system_mode", "/api/variables/by-name/site_terminology"].includes(p)) return { value: null };
  if (method === "GET" && p === "/api/postal/templates") return { templates: [] };
  if (method === "GET" && p === "/api/options/comm-tag") return [];
  if (method === "POST" && p === "/api/access/tabs") return { tabs: [{ tabId: "message", granted: true }] };
  if (method === "GET" && p === "/api/bulk-messages/bulk-fixture") return { id: "bulk-fixture", name: "Postal browser fixture", medium: ["postal"], status: "draft" };
  if (p === "/api/bulk-messages/bulk-fixture/message") {
    if (method === "GET") {
      reads.push(structuredClone(stored));
      return { media: ["postal"], records: { postal: stored } };
    }
    if (method === "PUT") {
      assert.equal(url.search, "?medium=postal");
      assert.deepEqual(body, { ...stored, ...content });
      saves.push(structuredClone(body));
      stored = structuredClone(body);
      return stored;
    }
  }
  if (method === "GET" && p === "/api/catalogs/token-contexts") return { catalog: {
    entries: contexts.map(id => ({ id, name: id, detail: { rootNames: ["contact"], media: ["postal"] } })),
  } };
  if (method === "GET" && p === "/api/admin/letter-templates") {
    assert.equal(url.searchParams.get("medium"), "postal");
    assert.ok(contexts.includes(url.searchParams.get("context_id")));
    templateQueries.push(url.searchParams.get("context_id"));
    return [{ id: "saved-postal", name: "Saved Postal Letter", content }];
  }
  if (method === "GET" && p === "/api/token-studio/graph") return { segments: [], pickerEntries: [], fieldIndex: {} };
  if (method === "GET" && p === "/api/token-studio/tree/roots") return { roots: [] };
  if (method === "GET" && ["/api/comm-compose/preview-seeds", "/api/bulk-messages/bulk-fixture/preview-seeds"].includes(p)) return { roots: [] };
  if (method === "POST" && ["/api/template-studio/preview", "/api/comm-compose/render"].includes(p)) {
    if (p === "/api/comm-compose/render") {
      assert.deepEqual(body, { scope: "worker", recordId: "worker-fixture", channel: "postal", values: content });
      renders.push(body);
    }
    return { sample: true, contactId: null, deliverable: true, fields: Object.fromEntries(
      Object.entries(body.values).map(([key, rendered]) => [key, { rendered, unknownTokens: [], missingValues: [], emptyValues: [] }]),
    ) };
  }
  throw new Error(`Unmocked request: ${method} ${url.pathname}${url.search}`);
}

try {
  await bounded("Vite listen", server.listen());
  const origin = `http://127.0.0.1:${server.config.server.port}`;
  console.log(`Vite listening at ${origin}; launching ${executablePath}`);
  browser = await bounded("Chromium launch", puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] }));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
   page.setDefaultTimeout(30000);
   page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", error => failures.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", async request => {
    try {
      const url = new URL(request.url());
      if (["data:", "blob:"].includes(url.protocol)) return await request.continue();
      assert.equal(url.origin, origin, `External network forbidden: ${url.href}`);
      if (url.pathname.startsWith("/api/")) {
        // PDF generation is outside this regression. Serve an inert local PDF, never a provider.
        if (url.pathname === "/api/comm/postal/preview" && request.method() === "POST") {
          return await request.respond({ status: 200, contentType: "application/pdf", body: "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF" });
        }
        const result = api(url, request.method(), request.postData() ? JSON.parse(request.postData()) : undefined);
        return await request.respond({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
      }
      assert.equal(request.method(), "GET", "Only static frontend GETs may reach Vite");
      await request.continue();
    } catch (error) {
      failures.push(String(error));
      await request.abort();
    }
  });
  const sel = id => `[data-testid="${id}"]`;
  const click = async id => { await page.waitForSelector(sel(id), { visible: true }); await page.click(sel(id)); };
  const value = id => page.$eval(sel(id), el => el.isContentEditable ? el.innerHTML : el.value);
  const expectFields = async expected => {
    await page.waitForFunction((expected) => {
      const body = document.querySelector('[data-testid="studio-editor-bodyHtml"]');
      const description = document.querySelector('[data-testid="studio-editor-description"]');
      return body?.innerHTML === expected.bodyHtml && description?.value === expected.description;
    }, {}, expected);
    assert.equal(await value("studio-editor-bodyHtml"), expected.bodyHtml);
    assert.equal(await value("studio-editor-description"), expected.description);
  };
  const replaceByTyping = async (id, text) => {
    await click(id);
    await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
    await page.keyboard.type(text);
  };
  async function exerciseStudio(openId) {
    await click(openId);
    await click("button-studio-panel-templates");
    await click("button-load-template-saved-postal");
    await click("button-load-template-confirm");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await expectFields(content);
    assert.equal(await page.$eval(sel("studio-editor-bodyHtml"), el => el.isContentEditable), true);
    await replaceByTyping("studio-editor-bodyHtml", "My edited body");
    await replaceByTyping("studio-editor-description", "My edited description");
    const edited = { bodyHtml: await value("studio-editor-bodyHtml"), description: await value("studio-editor-description") };
    assert.match(edited.bodyHtml, /My edited body/);
    assert.equal(edited.description, "My edited description");
    await click("button-load-template-saved-postal");
    await click("button-load-template-cancel");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await expectFields(edited);
    await click("button-load-template-saved-postal");
    await click("button-load-template-confirm");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await expectFields(content);
  }
  console.log("Checking imported template editor round trips");
  await page.goto(`${origin}/editor-fixture`);
  await click("fixture-editor-raw-mode");
  const imported = '<!doctype html><html><head><style>.letter {color: #123456;} td {padding: 8px;}</style></head><body><div class="letter"><p>BEFORE</p><table><tr><td>Cell</td></tr></table><a href="{{contact.field(name=\"url\")}}">Link</a><p style="color:{{contact.field(name=\"color\")}}">AFTER</p></div></body></html>';
  await replaceByTyping("fixture-editor-raw", imported);
  assert.equal(await page.$eval(sel("fixture-source"), el => el.textContent), imported, "Incomplete raw/source editing must remain literal");
  await click("fixture-editor-raw-mode");
  assert.equal(await page.$eval(`${sel("fixture-editor")} table td`, el => el.textContent), "Cell");
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /padding:\s*8px/);
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="url"\)\}\}/);
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="color"\)\}\}/);
  await page.$eval(sel("fixture-editor"), el => {
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", '<table><tr><td style="text-align:right">PLAIN HTML</td></tr></table>');
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.equal(await page.$$eval(`${sel("fixture-editor")} table`, els => els.length), 2, "Plain clipboard HTML becomes a table, not literal angle brackets");
  await page.$eval(sel("fixture-editor"), el => {
    const text = el.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, text.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await click("fixture-editor-bold");
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /<(?:b|strong)>BEFORE/);
  await page.$eval(sel("fixture-editor"), el => {
    const text = el.querySelector("p").firstChild;
    const range = document.createRange(); range.selectNodeContents(text);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/html", '<div style="text-align:center">PASTED</div>');
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /PASTED/);
  assert.doesNotMatch(await page.$eval(sel("fixture-source"), el => el.textContent), /BEFORE/);
  await click("fixture-editor-page-break");
  const canonical = await page.$eval(sel("fixture-source"), el => el.textContent);
  assert.match(canonical, /data-template-page-break/);
  assert.doesNotMatch(canonical, /Page break/, "Editor guide must never become authored text");
  await click("fixture-save");
  await page.reload();
  await click("fixture-reopen");
  assert.equal(await page.$eval(sel("fixture-source"), el => el.textContent), canonical);
  await click("fixture-editor-raw-mode");
  assert.equal(await value("fixture-editor-raw"), canonical);
  await click("fixture-editor-raw-mode");
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="url"\)\}\}/);
  assert.equal(await page.$(sel("fixture-unrelated-page-break")), null);
  await click("fixture-unrelated-raw-mode");
  await replaceByTyping("fixture-unrelated-raw", '<p style="color:red">Ordinary editor</p>');
  await click("fixture-unrelated-raw-mode");
  assert.equal(await page.$eval(`${sel("fixture-unrelated")} p`, el => el.getAttribute("style")), null);
  console.log("PASS imported layout, source/apply, attribute tokens, selection paste/toolbar, page break and local save/reopen; unrelated editor unchanged");
  console.log("Opening one-off compose");
  await page.goto(`${origin}/workers/worker-fixture/comm/send-postal`);
  await page.waitForSelector(sel("fixture-staff"));
  await exerciseStudio("button-compose-postal-template");
  await click("button-studio-done");
  await page.waitForSelector(sel("dialog-template-studio"), { hidden: true });
  assert.equal(await value("textarea-compose-body"), content.bodyHtml);
  assert.equal(await value("input-postal-description"), content.description);
  assert.equal(renders.length, 1, "Apply must call the compose render endpoint once");
  console.log("PASS one-off: both template fields, real rich-text edits, cancel/confirm overwrite, Apply");

  await page.goto(`${origin}/bulk/bulk-fixture/message`);
  await exerciseStudio("button-open-studio-postal");
  await click("button-studio-done");
  await click("button-save-postal-message");
  await page.waitForFunction(() => document.body.textContent.includes("Message content saved"));
  assert.equal(saves.length, 1);
  const readCount = reads.length;
  await page.reload();
  await click("button-open-studio-postal");
  await expectFields(content);
  assert.ok(reads.length > readCount, "Reopen must fetch stored content, not retain client state");
  assert.deepEqual(reads.at(-1), saves[0]);
  assert.deepEqual([...new Set(templateQueries)].sort(), [...contexts].sort());
  assert.deepEqual(failures, [], "No unexpected API/external requests or browser errors");
  await mkdir(path.join(root, "screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(root, "screenshots/postal-template-regression.png"), fullPage: true });
  console.log("PASS bulk: both fields saved in PUT, fresh GET after reload, reopened actual editor");
  console.log(`PASS fail-closed networking; screenshot: screenshots/postal-template-regression.png; Chromium ${await browser.version()}`);
  if (process.env.POSTAL_BROWSER_KEEP_OPEN === "1") {
    console.log(`Fixture browser retained at ${origin}; Ctrl+C to close. A separate browser has no API interception.`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) {
  // Report BEFORE cleanup: Vite close waits for in-flight transforms and can
  // otherwise mask the original browser/assertion failure with Node exit 13.
  console.error(error);
  const failedPage = (await browser?.pages())?.at(-1);
  if (failedPage) {
    console.error("Editor state:", await failedPage.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="studio-editor-"]')).map(el => ({ id: el.getAttribute("data-testid"), html: el.innerHTML, value: el.value }))));
    await mkdir(path.join(root, "screenshots"), { recursive: true });
    await failedPage.screenshot({ path: path.join(root, "screenshots/postal-template-failure.png") });
  }
  if (failures.length) console.error("Recorded fixture/browser failures:", failures);
  process.exitCode = 1;
} finally {
  for (const [label, close] of [
    ["Chromium close", () => browser?.close()],
    ["Vite close", () => server.close()],
  ]) {
    try {
      await bounded(label, Promise.resolve().then(close), 10000);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  }
}