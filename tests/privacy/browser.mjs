import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";
import { startPrivacyFixture } from "./fixture.ts";
import { personalDisplaysPlugin, transformPersonalDisplays } from "../../scripts/build/personal-displays.ts";
import { getSystemHelp } from "../../server/help/system/index.ts";
import { likePatternMatches } from "../../server/help/path-match.ts";
import { registerCaseLedgerFixture, verifyCaseLedgerScreens } from "./case-ledger-browser.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
console.log("Starting fictional screen masking browser fixture");
const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
assert.ok(executablePath, "Chromium is required for this fictional browser fixture.");
const fixture = await startPrivacyFixture();
const caseLedgerRequests = registerCaseLedgerFixture(fixture.app);
const saved = [];
const contact = { id: "contact-fixture", given: "Morgan", family: "Lancaster", displayName: "Morgan Lancaster",
  title: "", middle: "", generational: "", credentials: "" };
const builtIn = getSystemHelp("system:mask-mode");
const local = { id: "local-fixture", paths: ["/config/components"], summary: "Local administrator procedure.", details: "<p>Local content unchanged.</p>" };
fixture.app.get("/api/contacts/contact-fixture", (_req, res) => res.json(contact));
fixture.app.put("/api/workers/worker-fixture", (req, res) => {
  saved.push(req.body); Object.assign(contact, req.body.nameComponents);
  contact.displayName = `${contact.given} ${contact.family}`; res.json({ id: "worker-fixture" });
});
fixture.app.get("/api/helps", (_req, res) => res.json([builtIn, local]));
fixture.app.get("/api/helps/lookup", (req, res) => res.json([builtIn, local].filter(entry =>
  entry.paths.some(pattern => likePatternMatches(pattern, String(req.query.path))))));
const vite = await createServer({
  configFile: false, envFile: false, root, cacheDir: path.join(root, "node_modules/.vite-mask-browser"),
  optimizeDeps: { entries: [path.join(root, "tests/privacy/browser.html")], holdUntilCrawlEnd: false },
  plugins: [personalDisplaysPlugin(), {
    name: "fixture-only-tab-access",
    enforce: "pre",
    transform(_code, id) {
      if (!id.endsWith("/client/src/hooks/useTabAccess.ts")) return null;
      // Normal auth/policy is NOT bypassed in the app. Only this isolated,
      // fictional fixture avoids requiring the full application's auth shell.
      return { code: `const tabs = () => ({ tabs: [], getActiveRoot: () => undefined });
        export const useBaoCobraCaseTabAccess = tabs;
        export const useLedgerAccountTabAccess = tabs;`, map: null };
    },
  }, {
    name: "mask-fictional-display-slots",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/tests/privacy/screen-fixture.tsx")) return null;
      return { code: transformPersonalDisplays(code, id).code, map: null };
    },
  }, react()],
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  appType: "custom", server: { middlewareMode: true, hmr: false,
    watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/generated-artifacts/**"] } },
});
console.log("Isolated Vite fixture ready");
for (const route of ["/screen", "/config/components", "/config/helps", "/config/components/near-miss",
  "/cobra/cases", "/cobra/cases/:id", "/bao/cases", "/bao/cases/:id",
  "/ledger/accounts/:id/participants", "/ledger/accounts/:id/transactions", "/shared-cases", "/shared-transactions"]) {
  fixture.app.get(route, async (_req, res) => res.type("html").send(await vite.transformIndexHtml(route,
    readFileSync(path.join(root, "tests/privacy/browser.html"), "utf8"))));
}
fixture.app.use(vite.middlewares);
let browser;
const errors = [];
const text = (page, selector) => page.$eval(selector, el => el.textContent);
async function until(page, selector, expected) {
  await page.waitForFunction((selector, expected) => document.querySelector(selector)?.textContent === expected,
    { timeout: 15000 }, selector, expected);
}
async function untilAttribute(page, selector, name, expected) {
  await page.waitForFunction((selector, name, expected) => document.querySelector(selector)?.getAttribute(name) === expected,
    { timeout: 15000 }, selector, name, expected);
}
async function assertMaskControl(page, { label, icon, color, tooltip }) {
  const selector = '[data-testid="button-mask-mode"]';
  const attributes = await page.$eval(selector, (el, { icon, color }) => ({
    label: el.getAttribute("aria-label"),
    pressed: el.getAttribute("aria-pressed"),
    hasIcon: !!el.querySelector("svg")?.classList.contains(`lucide-${icon}`),
    hasColor: el.className.includes(color),
  }), { icon, color });
  assert.equal(attributes.label, label);
  assert.equal(attributes.pressed, label.includes(" ON ") ? "true" : "false");
  assert.ok(attributes.hasIcon);
  assert.ok(attributes.hasColor);
  await page.keyboard.press("Escape");
  await page.$eval(selector, el => el.blur());
  await page.mouse.move(0, 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  await page.hover(selector);
  await page.waitForFunction(expected => [...document.querySelectorAll('[role="tooltip"]')]
    .some(el => el.textContent === expected), { timeout: 5000 }, tooltip);
  await page.keyboard.press("Escape");
}
async function toggle(page) {
  await page.bringToFront();
  // A closing Radix portal can remain over the header during its exit animation.
  await page.waitForFunction(() => getComputedStyle(document.body).pointerEvents !== "none" &&
    !document.querySelector('[role="dialog"]') &&
    !document.querySelector('[data-testid="button-mask-mode"]')?.disabled);
  const wasOn = (await page.$eval('[data-testid="button-mask-mode"]', el => el.getAttribute("aria-pressed"))) === "true";
  console.log("Toggling screen preference");
  page.once("dialog", dialog => dialog.accept());
  await page.click('[data-testid="button-mask-mode"]');
  await untilAttribute(page, '[data-testid="button-mask-mode"]', "aria-label", wasOn ? "Mask Mode OFF" : "Mask Mode ON — screen only");
}
try {
  browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  console.log("Browser launched");
  const page = await browser.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.setCookie({ name: "fixture", value: "presenter", url: fixture.origin });
  console.log("Loading initial screen");
  await page.goto(`${fixture.origin}/screen`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(page, '[data-testid="worker-name"]', "Morgan Lancaster");
  console.log("Initial normal screen ready");
  await assertMaskControl(page, { label: "Mask Mode OFF", icon: "eye", color: "text-muted-foreground", tooltip: "Mask Mode OFF" });
  page.once("dialog", dialog => dialog.dismiss());
  await page.click('[data-testid="button-mask-mode"]');
  console.log("Confirmation cancel path checked");
  assert.equal(await page.$eval('[data-testid="button-mask-mode"]', el => el.getAttribute("aria-label")), "Mask Mode OFF",
    "Canceling confirmation leaves the mode unchanged");

  const second = await browser.newPage();
  console.log("Loading second login tab");
  await second.goto(`${fixture.origin}/screen`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await until(second, '[data-testid="worker-name"]', "Morgan Lancaster");
  console.log("Second tab ready");

  fixture.controls.transitionDelayMs = 400;
  await page.bringToFront();
  page.once("dialog", dialog => dialog.accept());
  await page.click('[data-testid="button-mask-mode"]');
  console.log("Confirmation accepted for delayed transition");
  await page.waitForFunction(() => document.querySelector('[data-testid="button-mask-mode"]')?.disabled);
  console.log("Busy state observed");
  assert.equal(await page.$eval('[data-testid="button-mask-mode"]', el => el.getAttribute("aria-busy")), "true");
  assert.equal(await page.$eval('[data-testid="button-mask-mode"]', el => el.parentElement.title), "Mask Mode OFF");
  fixture.controls.transitionDelayMs = 0;
  await untilAttribute(page, '[data-testid="button-mask-mode"]', "aria-label", "Mask Mode ON — screen only");

  await page.mouse.move(0, 0);
  await assertMaskControl(page, { label: "Mask Mode ON — screen only", icon: "eye-off", color: "text-red-600", tooltip: "Mask Mode ON — screen only" });
  await until(page, '[data-testid="worker-name"]', "M***** L********");
  await until(second, '[data-testid="worker-name"]', "M***** L********");
  console.log("ON and same-login tab sync confirmed");
  for (const [testid, expected] of [["worker-ssn", "1**-**-****"], ["worker-email", "m*****@gmail.com"],
    ["worker-dob", "1*/**/****"], ["worker-identifier", "1****"], ["worker-status", "Active"], ["worker-hours", "160"]]) {
    assert.equal(await text(page, `[data-testid="${testid}"]`), expected);
  }
  assert.equal(await page.$eval('[data-testid="worker-tooltip"]', el => el.title), "M***** L********");
  assert.equal(await page.$eval('[data-testid="worker-name"]', el => el.getAttribute("href")), "/workers/worker-fixture");
  assert.equal(await page.$eval('[data-testid="person-picker"]', el => el.value), "worker-fixture");
  assert.equal(await page.$eval('[data-testid="dob-input"]', el => el.type), "date");
  assert.equal(await page.$eval('[data-testid="dob-input"]', el => el.value), "1980-12-31");
  assert.equal(await page.$eval('[data-testid="dob-input"]', el => {
    el.min = "1981-01-01"; const invalid = el.validity.rangeUnderflow; el.min = ""; return invalid;
  }), true, "native date constraints stay intact while masked");
  await page.click('[data-testid="uncontrolled-name"]', { clickCount: 3 });
  await page.type('[data-testid="uncontrolled-name"]', "Moira");
  assert.equal(await page.$eval('[data-testid="person-picker"] option', el => el.textContent), "M***** L********");
  assert.match(await text(page, '[data-testid="contact"]'), /D\*\*\* R\*\*\*\*\*\*/);
  assert.match(await text(page, '[data-testid="dependent"]'), /C\*\*\*\* L\*\*\*\*\*\*\*\*/);
  assert.match(await text(page, '[data-testid="ordinary"]'), /Fictional Employer Medical \$200.00 12\/01\/2026/);
  for (const testid of ["note", "template-preview"]) assert.match(await text(page, `[data-testid="${testid}"]`), /Morgan Lancaster 123-45-6789/);
  assert.equal(await page.evaluate(async () => (await (await fetch("/api/domain")).json()).family), "FictionalSurname");
  assert.equal(await page.evaluate(async () => (await fetch("/files/canary.pdf")).text()), "FictionalSurname");
  const socketData = await page.evaluate(() => new Promise((resolve, reject) => {
    const ws = new WebSocket(location.origin.replace("http", "ws") + "/ws");
    ws.onmessage = event => { resolve(event.data); ws.close(); };
    ws.onerror = () => reject(new Error("Socket failed"));
  }));
  assert.equal(JSON.parse(socketData).family, "FictionalSurname");
  await page.click('[data-testid="button-edit-name"]');
  await page.waitForSelector("#given[data-screen-masked]");
  assert.equal(await page.$eval("#given", el => el.value), "Morgan");
  assert.equal(await page.$eval("#given", el => getComputedStyle(el).color), "rgba(0, 0, 0, 0)");
  await page.focus("#given");
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.type("Mavis");
  fixture.controls.failTransition = true;
  page.once("dialog", dialog => dialog.accept());
  await page.click('[data-testid="button-mask-mode"]');
  await page.waitForFunction(() => document.body.innerText.includes("Mask Mode change was not confirmed"));
  assert.equal(await page.$eval('[data-testid="button-mask-mode"]', el => el.getAttribute("aria-label")), "Mask Mode ON — screen only",
    "A failed transition leaves the confirmed ON state visible");
  fixture.controls.failTransition = false;
  await toggle(page); // OFF without losing unsaved state
  assert.equal(await page.$eval('[data-testid="uncontrolled-name"]', el => el.value), "Moira");
  await page.waitForFunction(() => document.querySelector("#given")?.value === "Mavis" && !document.querySelector("#given")?.hasAttribute("data-screen-masked"));
  await toggle(page);
  await page.waitForSelector("#given[data-screen-masked]");
  assert.equal(await page.$eval('[data-testid="uncontrolled-name"]', el => el.value), "Moira");
  await page.click('[data-testid="button-save-name"]');
  await page.waitForSelector('[data-testid="button-edit-name"]');
  assert.equal(saved.at(-1).nameComponents.given, "Mavis");
  assert.equal(saved.at(-1).nameComponents.family, "Lancaster");
  console.log("Real NameManagement save preserves canonical name");
  assert.ok(!JSON.stringify(saved).includes("*"), "Never save a masked value");
  await page.reload({ waitUntil: "networkidle0" });
  await until(page, '[data-testid="worker-name"]', "M***** L********");
  await page.goto(`${fixture.origin}/config/components`, { waitUntil: "networkidle0" });
  await page.click('[data-testid="button-help-more-system:mask-mode"]');
  await page.waitForSelector('[data-testid="text-help-details"]');
  assert.match(await text(page, '[data-testid="text-help-details"]'), /API responses/);
  assert.match(await text(page, '[data-testid="text-help-details"]'), /muted gray eye means/);
  assert.match(await text(page, '[data-testid="text-help-details"]'), /red eye with a slash means/);
  await page.keyboard.press("Escape");
  await page.goto(`${fixture.origin}/config/helps`, { waitUntil: "networkidle0" });
  assert.match(await page.$eval("body", el => el.innerText), /System/);
  assert.match(await page.$eval("body", el => el.innerText), /Built-in/);
  assert.match(await page.$eval("body", el => el.innerText), /Local administrator procedure/);
  await page.goto(`${fixture.origin}/config/components/near-miss`, { waitUntil: "networkidle0" });
  assert.equal(await page.$('[data-testid="help-summary-system:mask-mode"]'), null);
  await verifyCaseLedgerScreens({ page, fixture, toggle, until, requests: caseLedgerRequests });
  await page.goto(`${fixture.origin}/config/components/near-miss`, { waitUntil: "networkidle0" });

  const restricted = await browser.newPage();
  await restricted.setCookie({ name: "fixture", value: "nonadmin", url: fixture.origin });
  await restricted.goto(`${fixture.origin}/screen`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await restricted.waitForSelector('[data-testid="button-mask-mode"]');
  assert.equal(await restricted.$eval('[data-testid="button-mask-mode"]', el => el.disabled), true,
    "A non-admin can see the active state but cannot toggle it");
  assert.equal(await restricted.$eval('[data-testid="button-mask-mode"]', el => el.getAttribute("aria-label")), "Mask Mode ON — screen only");
  assert.equal(await restricted.$eval('[data-testid="button-mask-mode"]', el => el.parentElement.title), "Mask Mode ON — screen only");
  await restricted.close();
  await page.setCookie({ name: "fixture", value: "presenter", url: fixture.origin });

  fixture.controls.enabled = false;
  // Real lifecycle resets mode to OFF. Simulate the same transaction result here.
  fixture.rows.get("presenter").maskMode = { version: 1, mode: "off", revision: 99 };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await until(page, '[data-testid="worker-name"]', "Morgan Lancaster");
  assert.equal(await page.$('[data-testid="mask-mode-on-indicator"]'), null);
  assert.equal(await page.$('[data-testid="button-mask-mode"]'), null, "OFF control is hidden when the component is unavailable");
  fixture.controls.enabled = true;
  await page.reload({ waitUntil: "networkidle0" });
  await until(page, '[data-testid="worker-name"]', "Morgan Lancaster");
  fixture.controls.failComponent = true;
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.body.innerText.includes("Mask Mode state unavailable"));
  assert.ok(page.url().endsWith("/config/components/near-miss"));
  assert.deepEqual(errors, []);
  console.log("PASS screen masking, raw HTTP/WebSocket/downloads, actual name edit integrity, exclusions, header icon/tooltip/accessibility states, ON/OFF, reload/tab sync, component transitions, error recovery, built-in/local help listing and dialog.");
} catch (error) {
  console.error("Browser page errors:", errors);
  for (const page of await browser?.pages() ?? []) {
    console.error("Failed page:", page.url(), await page.$eval("body", el => el.innerText).catch(() => ""));
  }
  console.error(error.stack || error);
  throw error;
} finally {
  await browser?.close();
  await fixture.close();
  await Promise.race([vite.close(), new Promise(resolve => setTimeout(resolve, 5000))]);
}
