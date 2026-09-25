import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { exerciseAuthoring } from "./authoring.mjs";

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
const postalPreviewBodies = [];
let uploads = 0;
let uploadFailure = false;
let uploadDelayMs = 0;
let stored = { bodyHtml: "", description: "", templateId: "", fileUrl: "", color: false, doubleSided: false, mailType: "usps_first_class" };
const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=", "base64");
const managedImageUrl = "https://assets.example.invalid/public-files/public/letter-template-assets/fixture.png";
const imageFixture = "/tmp/postal-template-image-fixture.png";
await writeFile(imageFixture, imageBytes);
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
        if (/^\/(editor-fixture|email-studio-fixture|workers\/[^/]+\/comm\/send-postal|bulk\/[^/]+\/message)(\?|$)/.test(req.url || "")) {
          req.url = "/tests/postal-templates/browser.html";
        }
        next();
      });
    },
  }],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  server: { host: "127.0.0.1", port: Number(process.env.POSTAL_BROWSER_PORT || 5188), strictPort: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/screenshots/**"] } },
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
      assert.deepEqual({ ...body, bodyHtml: content.bodyHtml }, { ...stored, ...content });
      if (body.bodyHtml !== content.bodyHtml) assert.match(body.bodyHtml, /<img src="https:\/\/assets\.example\.invalid/);
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
      if (["data:", "blob:", "chrome:", "chrome-extension:"].includes(url.protocol)) return await request.continue();
      if (url.href === "https://fixture-images.invalid/logo.png") {
        return await request.respond({ status: 200, contentType: "image/png",
          body: imageBytes });
      }
      if (url.href === managedImageUrl) return await request.respond({ status: 200, contentType: "image/png", body: imageBytes });
      assert.equal(url.origin, origin, `External network forbidden: ${url.href}`);
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/template-assets" && request.method() === "POST") {
          assert.match(request.headers()["content-type"], /multipart\/form-data/);
          uploads++;
          if (uploadDelayMs) await new Promise(resolve => setTimeout(resolve, uploadDelayMs));
          if (uploadFailure) return await request.respond({ status: 503, contentType: "application/json",
            body: JSON.stringify({ message: "Template image storage is unavailable." }) });
          return await request.respond({ status: 201, contentType: "application/json", body: JSON.stringify({ url: managedImageUrl }) });
        }
        // PDF generation is outside this regression. Serve an inert local PDF, never a provider.
        if (url.pathname === "/api/comm/postal/preview" && request.method() === "POST") {
          postalPreviewBodies.push(JSON.parse(request.postData()).body);
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
  const click = async id => {
    const editorTestId = id.replace(/-(?:page-break|raw-mode)$/, "");
    const toolbarSelector = `div:has(> ${sel(editorTestId)}) [data-template-design-toolbar]`;
    if (id.endsWith("-page-break") && !await page.$(sel(id)) && await page.$(toolbarSelector)) {
      await page.click(`${toolbarSelector} button[aria-label="Insert"]`);
    }
    if (id.endsWith("-raw-mode")) {
      const target = await page.$(sel(id));
      const visible = target && await target.evaluate(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length));
      if (!visible && await page.$(toolbarSelector)) {
        await page.$eval(`${toolbarSelector} button[aria-label="More formatting"]`, el => el.click());
      }
    }
    await page.waitForSelector(sel(id), { visible: true });
    const tagName = await page.$eval(sel(id), el => el.tagName);
    if (tagName === "DIV" || tagName === "TEXTAREA" || tagName === "INPUT") await page.click(sel(id));
    else await page.$eval(sel(id), el => el.click());
  };
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
    await page.keyboard.sendCharacter(text);
  };
  const dropImage = async (id, mime = "image/png", paragraph = 0) => page.$eval(sel(id), (el, { bytes, mime, paragraph }) => {
    const text = el.querySelectorAll("p")[paragraph]?.firstChild;
    if (!text) throw new Error("Expected a paragraph at the drop point");
    const range = document.createRange();
    range.setStart(text, Math.min(5, text.textContent.length));
    range.collapse(true);
    const point = range.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    const binary = atob(bytes);
    dataTransfer.items.add(new File([Uint8Array.from(binary, c => c.charCodeAt(0))], "dropped.png", { type: mime }));
    el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer,
      clientX: point.left, clientY: point.top + point.height / 2 }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer,
      clientX: point.left, clientY: point.top + point.height / 2 }));
  }, { bytes: imageBytes.toString("base64"), mime, paragraph });
  async function exerciseStudio(openId) {
    await click(openId);
    assert.equal(await page.$eval(sel("dialog-template-studio"), el => el.dataset.maximized), "true");
    const editorNode = await page.$(sel("studio-editor-bodyHtml"));
    const studioToolbar = `div:has(> ${sel("studio-editor-bodyHtml")}) [data-template-design-toolbar]`;
    const toolbarState = () => page.$eval(studioToolbar, el => ({
      width: el.clientWidth, scrollWidth: el.scrollWidth,
      direct: !!el.querySelector('[data-promoted-tools] [aria-label="HTML source"]'),
    }));
    const panelOpen = await toolbarState();
    await click("button-studio-toggle-right-column");
    assert.equal(await page.$eval("#studio-right-column", el => getComputedStyle(el).display), "none");
    await page.waitForFunction((selector, previous) => document.querySelector(selector)?.clientWidth > previous, {}, studioToolbar, panelOpen.width);
    const panelClosed = await toolbarState();
    assert.ok(panelClosed.direct, "Full Studio writing canvas exposes HTML source directly");
    assert.ok(panelClosed.scrollWidth <= panelClosed.width, "Expanded editor toolbar does not overflow");
    await page.$eval(sel("button-studio-toggle-maximize"), el => el.click());
    assert.equal(await page.$eval(sel("dialog-template-studio"), el => el.dataset.maximized), "false");
    await page.$eval(sel("button-studio-toggle-maximize"), el => el.click());
    await page.$eval(sel("button-studio-toggle-right-column"), el => el.click());
    await page.waitForFunction((selector, previous) => document.querySelector(selector)?.clientWidth < previous, {}, studioToolbar, panelClosed.width);
    const restoredPanel = await toolbarState();
    assert.ok(restoredPanel.scrollWidth <= restoredPanel.width, "Panel resize does not overflow the toolbar");
    assert.equal(restoredPanel.direct, panelOpen.direct, "Panel resize restores the previous toolbar location");
    assert.equal(await editorNode.evaluate(el => el === document.querySelector('[data-testid="studio-editor-bodyHtml"]')), true,
      "Resizing the workspace must not remount the editor");
    await click("button-studio-panel-templates");
    await click("button-load-template-saved-postal");
    await click("button-load-template-confirm");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await expectFields(content);
    // Upload is a reusable HTTPS image reference, never a blob or expiring signed URL.
    await page.$eval(sel("studio-editor-bodyHtml"), el => {
      el.focus();
      const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.click('[data-template-design-toolbar] button[aria-label="Insert"]');
    await page.$$eval("summary", nodes => {
      const images = nodes.find(el => el.textContent?.trim() === "Images");
      if (images && !images.parentElement.open) images.click();
    });
    const upload = await page.$('input[aria-label="Upload image"]');
    assert.ok(upload, "Template Studio provides image upload");
    await upload.uploadFile(imageFixture);
    await page.waitForFunction(url => document.querySelector('input[aria-label="Image URL"]')?.value === url, {}, managedImageUrl);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(el => el.textContent?.trim() === "Insert image");
      if (!button) throw new Error("Insert image control not found");
      button.click();
    });
    await page.waitForSelector(`${sel("studio-editor-bodyHtml")} img`);
    assert.equal(await page.$eval(`${sel("studio-editor-bodyHtml")} img`, el => el.getAttribute("src")), managedImageUrl);
    await click("studio-editor-bodyHtml-undo");
    await expectFields(content);
    // A direct file drop uses the same managed upload without opening Images.
    const uploadsBeforeDrop = uploads;
    await dropImage("studio-editor-bodyHtml");
    await page.waitForSelector(`${sel("studio-editor-bodyHtml")} img`);
    assert.equal(uploads, uploadsBeforeDrop + 1);
    assert.equal(await page.$eval(`${sel("studio-editor-bodyHtml")} p img`, el => el.getAttribute("src")), managedImageUrl,
      "Dropped image lands inside the paragraph at the pointer, not at document end");
    assert.equal(await page.$eval(`${sel("studio-editor-bodyHtml")} img`, el => el.complete && el.naturalWidth > 0), true);
    assert.doesNotMatch(await value("studio-editor-bodyHtml"), /blob:|data:image/);
    await click("studio-editor-bodyHtml-undo");
    await expectFields(content);
    const uploadsBeforeUnsupported = uploads;
    await dropImage("studio-editor-bodyHtml", "image/gif");
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("Drop one PNG or JPEG image."));
    assert.equal(uploads, uploadsBeforeUnsupported);
    await expectFields(content);
    uploadFailure = true;
    await dropImage("studio-editor-bodyHtml");
    await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("Template image storage is unavailable."));
    assert.equal(await value("studio-editor-bodyHtml"), content.bodyHtml);
    uploadFailure = false;
    uploadDelayMs = 600;
    await dropImage("studio-editor-bodyHtml");
    await page.waitForFunction(() => document.body.textContent.includes("Uploading image…"));
    await dropImage("studio-editor-bodyHtml");
    await page.waitForFunction(() => document.body.textContent.includes("Wait for the current image upload to finish."));
    await click("button-load-template-saved-postal");
    await click("button-load-template-confirm");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await new Promise(resolve => setTimeout(resolve, 750));
    await expectFields(content);
    assert.equal(await page.$(`${sel("studio-editor-bodyHtml")} img`), null,
      "An upload finishing after the document was replaced cannot insert into the new document");
    uploadDelayMs = 0;
    // Edit this document away and back to the next template's exact bytes.
    // Loading that template is still a new document, not an onChange echo.
    await click("studio-editor-bodyHtml-raw-mode");
    await replaceByTyping("studio-editor-bodyHtml-raw", "<p>Previous template content</p>");
    await replaceByTyping("studio-editor-bodyHtml-raw", content.bodyHtml);
    await click("studio-editor-bodyHtml-raw-mode");
    await expectFields(content);
    assert.equal(await page.$eval(sel("studio-editor-bodyHtml-undo"), el => el.disabled), false);
    await click("button-load-template-saved-postal");
    await click("button-load-template-confirm");
    await page.waitForSelector(sel("dialog-load-letter-template"), { hidden: true });
    await expectFields(content);
    assert.equal(await page.$eval(sel("studio-editor-bodyHtml-undo"), el => el.disabled), true,
      "Same-content saved template replacement discards the previous document history");
    assert.equal(await page.$eval(sel("studio-editor-bodyHtml-redo"), el => el.disabled), true);
    await click("studio-editor-bodyHtml");
    await page.keyboard.down("Control"); await page.keyboard.press("KeyZ"); await page.keyboard.up("Control");
    await expectFields(content);
    console.log("PASS same-content saved-template replacement resets editor history");
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
  const imported = '<!doctype html><html><head><style>.letter {color: #123456;} td {padding: 8px;}</style></head><body><div class="letter"><p>BEFORE</p><table><tr><td>Cell</td><td><table><tr><td>Nested</td></tr></table></td></tr></table><img src="{{contact.field(name=\"logoUrl\")}}" alt="Logo" width="120" style="max-width:100%;height:auto"><a href="{{contact.field(name=\"url\")}}">Link</a><p style="color:{{contact.field(name=\"color\")}}">AFTER</p></div></body></html>';
  await replaceByTyping("fixture-editor-raw", imported);
  assert.equal(await page.$eval(sel("fixture-source"), el => el.textContent), imported, "Incomplete raw/source editing must remain literal");
  await click("fixture-editor-raw-mode");
  assert.equal(await page.$eval(`${sel("fixture-editor")} table td`, el => el.textContent), "Cell");
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /padding:\s*8px/);
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="url"\)\}\}/);
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="color"\)\}\}/);
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="logoUrl"\)\}\}/);
  assert.equal(await page.$$eval(`${sel("fixture-editor")} table`, els => els.length), 2, "Imported nested tables remain nested");
  assert.equal(await page.$eval(`${sel("fixture-editor")} img`, el => el.getAttribute("alt")), "Logo");
  await page.$eval(sel("fixture-editor"), el => {
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", '<table><tr><td style="text-align:right">PLAIN HTML</td></tr></table>');
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  assert.equal(await page.$$eval(`${sel("fixture-editor")} table`, els => els.length), 3, "Plain clipboard HTML becomes a table without losing imported nested tables");
  await page.$eval(sel("fixture-editor"), el => {
    const text = el.querySelector("p").firstChild;
    const range = document.createRange();
    range.setStart(text, 0); range.setEnd(text, text.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await click("fixture-editor-bold");
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /(?:<(?:b|strong)>|<span style="font-weight:bold">)BEFORE/);
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
  assert.match(await page.$eval(sel("fixture-source"), el => el.textContent), /\{\{contact.field\(name="logoUrl"\)\}\}/);
  assert.equal(await page.$(sel("fixture-unrelated-page-break")), null);
  await click("fixture-unrelated-raw-mode");
  await replaceByTyping("fixture-unrelated-raw", '<p style="color:red">Ordinary editor</p>');
  await click("fixture-unrelated-raw-mode");
  assert.equal(await page.$eval(`${sel("fixture-unrelated")} p`, el => el.getAttribute("style")), null);
  console.log("PASS imported layout, source/apply, attribute tokens, selection paste/toolbar, page break and local save/reopen; unrelated editor unchanged");
  console.log("Opening one-off compose");
  const toolbarLayoutFailures = await exerciseAuthoring(page, origin);
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
  await dropImage("studio-editor-bodyHtml");
  await page.waitForSelector(`${sel("studio-editor-bodyHtml")} img`);
  const savedBodyWithImage = await value("studio-editor-bodyHtml");
  await click("button-studio-panel-preview");
  await page.waitForFunction(() => !!document.querySelector('[data-testid="studio-preview-postal-bodyHtml-page"]'));
  await bounded("Postal managed image preview", new Promise(resolve => {
    const check = () => postalPreviewBodies.some(body => body.includes(managedImageUrl))
      ? resolve() : setTimeout(check, 100);
    check();
  }), 10000);
  assert.ok(postalPreviewBodies.some(body => body.includes(managedImageUrl)),
    "Postal PDF preview receives the managed image URL");
  await click("button-studio-done");
  await click("button-save-postal-message");
  await page.waitForFunction(() => document.body.textContent.includes("Message content saved"));
  assert.equal(saves.length, 1);
  assert.equal(saves[0].bodyHtml.replace(/max-width:\s*100%;?/g, "max-width:100%"),
    savedBodyWithImage.replace(/max-width:\s*100%;?/g, "max-width:100%"));
  const readCount = reads.length;
  await page.reload();
  await click("button-open-studio-postal");
  await page.waitForSelector(`${sel("studio-editor-bodyHtml")} img`);
  assert.equal(await page.$eval(`${sel("studio-editor-bodyHtml")} img`, el => el.getAttribute("src")), managedImageUrl);
  assert.equal(await page.$eval(`${sel("studio-editor-bodyHtml")} img`, el => el.complete && el.naturalWidth > 0), true);
  assert.ok(reads.length > readCount, "Reopen must fetch stored content, not retain client state");
  assert.deepEqual(reads.at(-1), saves[0]);
  assert.deepEqual([...new Set(templateQueries)].sort(), [...contexts].sort());
  assert.deepEqual(failures, [], "No unexpected API/external requests or browser errors");
  assert.deepEqual(toolbarLayoutFailures, [], "Responsive toolbar must remain 46px tall, one row and overflow-free at 390px, 800px and 1400px");
  await mkdir(path.join(root, "screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(root, "screenshots/postal-template-regression.png"), fullPage: true });
  console.log("PASS bulk: both fields saved in PUT, fresh GET after reload, reopened actual editor");
  // Capture the real email Studio component separately from the postal flow.
  // Its sample text lives only in this isolated browser fixture.
  await page.setViewport({ width: 1024, height: 720 });
  await page.goto(`${origin}/email-studio-fixture`);
  await page.waitForSelector(sel("dialog-template-studio"), { visible: true });
  await dropImage("studio-editor-bodyHtml", "image/png", 1);
  await page.waitForSelector(`${sel("studio-editor-bodyHtml")} img`);
  await click("button-studio-toggle-right-column");
  await click("button-studio-panel-preview");
  await page.waitForFunction(url => document.querySelector('[data-testid="studio-preview-email-body"]')?.srcdoc.includes(url), {}, managedImageUrl);
  const emailPreviewFrame = await (await page.$(sel("studio-preview-email-body"))).contentFrame();
  await emailPreviewFrame.waitForSelector("img");
  assert.equal(await emailPreviewFrame.$eval("img", el => el.getAttribute("src")), managedImageUrl);
  await click("button-studio-toggle-right-column");
  assert.equal(await page.$eval("#studio-right-column", el => getComputedStyle(el).display), "none",
    "Email editor opens with the full writing canvas");
  const emailToolbar = `[data-template-design-toolbar]`;
  assert.equal(await page.$eval(emailToolbar, el => el.getBoundingClientRect().height), 46);
  const emailCanvasTop = await page.$eval(sel("studio-editor-bodyHtml"), el => el.getBoundingClientRect().top);
  await new Promise(resolve => setTimeout(resolve, 300)); // Wait for dialog entrance animation before capture.
  await page.screenshot({ path: path.join(root, "screenshots/email-template-editor.png") });
  await page.click(`${emailToolbar} button[aria-label="Insert"]`);
  await page.waitForFunction(() => document.querySelector('[data-template-design-toolbar] button[aria-label="Insert"]')?.getAttribute("aria-expanded") === "true");
  assert.equal(await page.$eval(sel("studio-editor-bodyHtml"), el => el.getBoundingClientRect().top), emailCanvasTop,
    "Insert menu floats without moving the email document");
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.screenshot({ path: path.join(root, "screenshots/email-template-insert-menu.png") });
  await page.keyboard.press("Escape");
  await page.click(`${emailToolbar} button[aria-label="Text color"]`);
  await page.waitForSelector('[role="group"][aria-label="Text color presets"]', { visible: true });
  assert.equal(await page.$eval(sel("studio-editor-bodyHtml"), el => el.getBoundingClientRect().top), emailCanvasTop,
    "Color menu floats without moving the email document");
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.screenshot({ path: path.join(root, "screenshots/email-template-color-menu.png") });
  console.log("PASS email Studio full-width canvas, 46px toolbar, and floating Insert/color menus");
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