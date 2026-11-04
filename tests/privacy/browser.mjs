import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startPrivacyFixture, RAW, CANARY } from "./fixture.ts";

const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
assert.ok(executablePath, "Chromium is required for the authorized in-memory privacy fixture.");
const f = await startPrivacyFixture();
let browser;
try {
  // Serve the REAL normal-app bootstrap guard against fictional response data.
  const source = await readFile(new URL("../../client/src/lib/presentation-guard.ts", import.meta.url), "utf8");
  const guard = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  f.app.get("/guard.js", (_req, res) => res.type("application/javascript").send(guard.code));
  f.app.get("/normal", (_req, res) => res.type("html").send(`<!doctype html><title>Fixture</title>
    <script type="module">
      import {installPresentationGuard} from "/guard.js";
      if (await installPresentationGuard()) {
        const result = await fetch("/api/domain");
        const person = await result.json();
        window.fixtureCache = person;
        window.fixtureBlob = URL.createObjectURL(new Blob([person.family]));
        document.body.textContent = person.family;
      }
    </script>`));
  browser = await puppeteer.launch({ executablePath, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(f.origin, ["clipboard-read", "clipboard-write"]);
  const page = await browser.newPage();
  const errors = [], responses = [], urls = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => urls.push(req.url()));
  page.on("response", async res => {
    if (res.url().includes("/api/mask-mode/") && res.headers()["content-type"]?.includes("application/json")) {
      responses.push(await res.text().catch(() => ""));
    }
  });
  page.on("dialog", dialog => dialog.accept());
  await page.setCookie({ name: "fixture", value: "presenter", url: f.origin });
  await page.goto(`${f.origin}/mask-mode`);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("MASK MODE OFF"));
  assert.equal(await page.$eval("#load", el => el.disabled), true);
  await page.click("#enable");
  assert.match(await page.$eval("#error", el => el.textContent), /Confirm/);

  const oldTab = await browser.newPage();
  await oldTab.goto(`${f.origin}/normal`);
  await oldTab.waitForFunction(canary => document.body.textContent.includes(canary), {}, CANARY);
  assert.equal(await oldTab.evaluate(() => !!window.fixtureCache), true);
  await page.bringToFront();
  await page.waitForFunction(() => !document.querySelector("#enable").disabled);
  await page.click("#ack");
  await Promise.all([page.waitForNavigation(), page.click("#enable")]);
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("MASK MODE ON"));
  await oldTab.waitForFunction(() => location.pathname === "/mask-mode", { timeout: 12000 });
  assert.equal(await oldTab.evaluate(() => window.fixtureCache), undefined, "hard boundary must discard old cache");
  assert.equal(await oldTab.evaluate(() => window.fixtureBlob), undefined);
  await page.bringToFront();
  await page.waitForFunction(() => !document.querySelector("#load").disabled);
  await page.click("#load");
  await page.waitForFunction(() => document.querySelectorAll("#rows tr").length === 3);

  const document = await page.content();
  const domText = await page.$eval("body", el => el.innerText);
  for (const value of [...Object.values(RAW).filter(v => typeof v !== "object"), "1980-02-29", "1901-12-31"]) {
    assert.ok(!document.includes(String(value)), `DOM/attributes must not contain fixture identity ${String(value)}`);
    assert.ok(!responses.join("\n").includes(String(value)), "protected network responses must not contain fixture identity");
  }
  assert.ok(domText.includes("1980"));
  assert.ok(domText.includes("90 or older"));
  assert.ok(document.includes("Not a HIPAA certification"));
  assert.ok(urls.every(url => new URL(url).origin === f.origin), "no third-party scripts or network calls");
  assert.ok(!urls.some(url => /weglot|\/api\/plugins\/client-injection/.test(url)));
  await page.evaluate(() => {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.body);
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.down("Control"); await page.keyboard.press("c"); await page.keyboard.up("Control");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.includes("Training person"));
  assert.ok(!copied.includes(CANARY));
  assert.ok(!copied.includes(RAW.ssn));
  const refused = await page.evaluate(async () => {
    const res = await fetch("/api/domain", { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ family:"••••", ssn:"Withheld" }) });
    return { status:res.status, body:await res.text() };
  });
  assert.equal(refused.status, 423);
  assert.ok(!refused.body.includes(CANARY));
  assert.equal(f.controls.effects, 1, "only the intentional OFF fixture read reached the domain double");

  // Independent browser session remains OFF.
  const otherContext = await browser.createBrowserContext();
  const other = await otherContext.newPage();
  await other.setCookie({ name:"fixture", value:"other", url:f.origin });
  await other.goto(`${f.origin}/mask-mode`);
  await other.waitForFunction(() => document.querySelector("#status")?.textContent.includes("MASK MODE OFF"));
  assert.equal(f.rows.get("other").maskMode.mode, "off");
  await otherContext.close();

  // Protected read is refused immediately when effective permissions change.
  f.controls.targetCanRead = false;
  const dataRefusal = await page.evaluate(async () => {
    const state = await (await fetch("/api/mask-mode/state")).json();
    const res = await fetch("/api/mask-mode/people", { headers:{"X-Mask-Revision":String(state.revision)} });
    return res.status;
  });
  assert.equal(dataRefusal, 409);
  f.controls.targetCanRead = true;

  // Cross-tab OFF transition clears the protected sample rather than mixing caches.
  await page.bringToFront();
  await page.click("#ack");
  await Promise.all([page.waitForNavigation(), page.click("#disable")]);
  assert.equal(new URL(page.url()).pathname, "/");
  await oldTab.bringToFront();
  await oldTab.waitForFunction(() => document.querySelector("#status")?.textContent.includes("MASK MODE OFF"), { timeout:12000 });
  assert.equal(await oldTab.$eval("#rows", el => el.children.length), 0);
  assert.equal(f.rows.get("presenter").maskMode.mode, "off");

  const legacy = await browser.newPage();
  await legacy.setCookie({ name:"fixture", value:"legacy", url:f.origin });
  await legacy.goto(`${f.origin}/mask-mode`);
  await legacy.waitForFunction(() => document.querySelector("#status")?.textContent.includes("unknown"));
  assert.equal(await legacy.$eval("#load", el => el.disabled), true);
  await legacy.setRequestInterception(true);
  legacy.on("request", request => {
    if (new URL(request.url()).pathname === "/api/mask-mode/state") f.controls.failRead = true;
    void request.continue();
  });
  await legacy.reload();
  await legacy.waitForFunction(() => document.querySelector("#veil")?.textContent.includes("could not be confirmed"));
  assert.equal(await legacy.$eval("#veil", el => el.hidden), false, "failure must not uncover a ready view");
  assert.ok(!(await legacy.content()).includes(CANARY), "server exceptions may not be relayed");
  await legacy.close();
  f.controls.failRead = false;
  assert.ok(errors.length === 0, errors.join("\n"));
  // A disabled installation must mount normal content without installing
  // fetch interception, state polling or mask-specific browser listeners.
  f.controls.enabled = false;
  const disabledContext = await browser.createBrowserContext();
  const disabledPage = await disabledContext.newPage();
  await disabledPage.setCookie({ name:"fixture", value:"presenter", url:f.origin });
  let stateRequests = 0;
  disabledPage.on("request", request => {
    if (new URL(request.url()).pathname === "/api/mask-mode/state") stateRequests++;
  });
  await disabledPage.evaluateOnNewDocument(() => { window.originalFixtureFetch = window.fetch; });
  await disabledPage.goto(`${f.origin}/normal`);
  await disabledPage.waitForFunction(canary => document.body.textContent.includes(canary), {}, CANARY);
  assert.equal(await disabledPage.evaluate(() => window.fetch === window.originalFixtureFetch), true);
  await new Promise(resolve => setTimeout(resolve, 5500));
  assert.equal(stateRequests, 0, "disabled startup must not call or poll the Mask Mode state endpoint");

  // Disable while ON, then re-enable. The same SID must never resume normal
  // content or revive an old protected session.
  const protectedRow = f.rows.get("presenter");
  protectedRow.maskMode.mode = "on";
  protectedRow.maskModeRevoked = true;
  await disabledPage.goto(`${f.origin}/normal`);
  await disabledPage.waitForFunction(() => document.body.textContent.includes("Protected session ended"));
  assert.ok(!(await disabledPage.content()).includes(CANARY));
  f.controls.enabled = true;
  f.controls.epoch = "re-enabled-generation";
  await disabledPage.goto(`${f.origin}/normal`);
  assert.ok((await disabledPage.content()).includes("Protected session ended"));
  assert.ok(!(await disabledPage.content()).includes(CANARY));
  console.log("PASS authorized in-memory browser: strict ON/OFF/unknown coverage, disabled startup without fetch interception/state polling, disable/re-enable revocation, clipboard/cache isolation, permissions and no live effects.");
} finally {
  await browser?.close();
  await f.close();
}
