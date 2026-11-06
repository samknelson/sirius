import assert from "node:assert/strict";
import { cobraFixture, caseFixtures, participantFixtures, transactionFixtures, narrative } from "./case-ledger-data.ts";

export function registerCaseLedgerFixture(app) {
  const requests = [];
  app.get("/api/auth/user", (_req, res) => res.json({ user: { id: "fixture-admin" }, permissions: [], components: [] }));
  app.get("/api/sitespecific/bao/cobra/cases", (_req, res) => res.json([
    cobraFixture, { ...cobraFixture, id: "missing", coveredPersonName: null, subscriberName: null },
  ]));
  app.get("/api/sitespecific/bao/cobra/cases/:id", (req, res) => res.json({
    ...cobraFixture, ...(req.params.id === "missing" ? { id: "missing", coveredPersonName: null, subscriberName: null } : {}),
  }));
  app.get("/api/sitespecific/bao/cases/assignees", (_req, res) => res.json({ users: [], selfId: "staff" }));
  app.get("/api/sitespecific/bao/cases", (req, res) => {
    requests.push(req.originalUrl);
    res.json({ items: caseFixtures, total: 30 });
  });
  app.get("/api/sitespecific/bao/cases/:id", (req, res) => res.json(caseFixtures.find(row => row.id === req.params.id)));
  app.get("/api/ledger/accounts/account-fixture", (_req, res) => res.json({ id: "account-fixture", name: "Fictional Account" }));
  app.get("/api/ledger/accounts/account-fixture/participants", (req, res) => {
    requests.push(req.originalUrl);
    res.json({ data: participantFixtures, total: 30 });
  });
  app.get("/api/ledger/accounts/account-fixture/transactions", (req, res) => {
    requests.push(req.originalUrl);
    res.json({ data: transactionFixtures, total: 100, entityTypes: ["worker", "employer", "trust_provider"] });
  });
  app.get("/api/entity-files", (_req, res) => res.json({ files: [] }));
  app.get("/api/variables/by-name/:name", (_req, res) => res.json(""));
  app.get("/api/options/:name", (_req, res) => res.json([]));
  app.get("/api/trust-benefits", (_req, res) => res.json([]));
  app.get("/api/plugins/:kind", (_req, res) => res.json([]));
  return requests;
}

export async function verifyCaseLedgerScreens({ page, fixture, toggle, until, requests }) {
  const masked = "M***** L********";
  const person = mode => mode ? masked : "Morgan Lancaster";
  const check = async (selector, expected) => until(page, `[data-testid="${selector}"]`, expected);
  const closeDetails = async () => {
    await page.click('[data-testid="modal-button-close"]');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]') &&
      getComputedStyle(document.body).pointerEvents !== "none");
  };
  const listCheck = async mode => {
    for (const [id, expected] of [["worker", person(mode)], ["employer", "Fictional Employer"], ["provider", "Fictional Provider"],
      ["missing", "missing-original"], ["empty", ""], ["placeholder", "Unknown worker"]]) {
      await until(page, `[data-testid="row-bao-case-${id}"] .font-medium`, expected);
    }
    assert.equal(await page.$eval('[data-testid="row-bao-case-worker"]', el => el.closest("a").getAttribute("href")), "/bao/cases/worker");
  };
  const ledgerCheck = async (mode, kind) => {
    for (const [id, expected] of [["worker", person(mode)], ["employer", "Fictional Employer"], ["provider", "Fictional Provider"],
      ["missing", "—"], ["empty", "—"], ["placeholder", "Unknown worker"]]) await check(`cell-entity-name-${id}`, expected);
    if (kind === "transactions") {
      await check("cell-memo-worker", narrative);
      await page.click('[data-testid="button-view-transaction-worker"]');
      await check("modal-transaction-entity-name", person(mode));
      await check("modal-transaction-memo", narrative);
      await closeDetails();
    }
  };
  const scenarios = [
    ["/cobra/cases", async mode => {
      await check("text-case-covered-cobra-fixture", mode ? "C**** L********" : "Casey Lancaster");
      await check("text-case-subscriber-cobra-fixture", person(mode));
      await check("text-case-covered-missing", "—");
      await check("text-case-subscriber-missing", "—");
      assert.equal(await page.$eval('[data-testid="link-case-covered-cobra-cobra-fixture"]', el => el.getAttribute("href")), "/workers/covered-worker/sitespecific/bao/cobra");
    }],
    ["/cobra/cases/cobra-fixture", async mode => {
      const title = `COBRA: ${mode ? "C**** L********" : "Casey Lancaster"}`;
      await check("text-cobra-case-title-cobra-fixture", title);
      await page.waitForFunction(title => document.title === `${title} | Sirius`, {}, title);
      await check("text-case-covered-person", mode ? "C**** L********" : "Casey Lancaster");
      await check("text-case-subscriber", person(mode));
      await check("text-case-relationship", "Child");
      await check("text-case-event", "Termination");
    }],
    ["/cobra/cases/missing", async () => {
      await check("text-cobra-case-title-missing", "COBRA Case missing");
      await check("text-case-covered-person", "—");
      await check("text-case-subscriber", "—");
    }],
    ["/bao/cases", listCheck],
    ["/shared-cases", listCheck],
    ...["worker", "employer", "provider", "missing", "empty"].map(id => [`/bao/cases/${id}`, async mode => {
      const row = caseFixtures.find(row => row.id === id);
      await check("text-page-title", `Case · ${id === "worker" ? person(mode) : row.entityName ?? row.entityId}`);
      assert.ok((await page.$eval("main", el => el.innerText)).includes(narrative), "Case notes/subjects stay unchanged");
    }]),
    ["/ledger/accounts/account-fixture/participants", mode => ledgerCheck(mode, "participants")],
    ["/ledger/accounts/account-fixture/transactions", mode => ledgerCheck(mode, "transactions")],
    ["/shared-transactions", mode => ledgerCheck(mode, "transactions")],
  ];
  for (const [route, verify] of scenarios) {
    await page.goto(`${fixture.origin}${route}`, { waitUntil: "networkidle0" });
    await verify(true);
    await toggle(page);
    await verify(false);
    await toggle(page);
    await verify(true);
    fixture.controls.enabled = false;
    const prior = fixture.rows.get("presenter").maskMode;
    fixture.rows.get("presenter").maskMode = { version: 1, mode: "off", revision: prior.revision + 1 };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForSelector('[data-testid="button-mask-mode"]', { hidden: true });
    await verify(false);
    fixture.controls.enabled = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForSelector('[data-testid="button-mask-mode"]');
    await toggle(page);
    await verify(true);
    console.log(`PASS case/ledger ON, OFF, disabled and restoration: ${route}`);
  }
  // Open dialog remains reactive without closing/reopening the selected record.
  await page.click('[data-testid="button-view-transaction-worker"]');
  await check("modal-transaction-entity-name", masked);
  await page.evaluate(() => {
    window.confirm = () => true;
    document.querySelector('[data-testid="button-mask-mode"]').click();
  });
  await check("modal-transaction-entity-name", "Morgan Lancaster");
  await check("modal-transaction-memo", narrative);
  await page.evaluate(() => document.querySelector('[data-testid="button-mask-mode"]').click());
  await check("modal-transaction-entity-name", masked);
  await closeDetails();
  for (const id of ["employer", "provider", "missing", "empty", "placeholder"]) {
    await page.click(`[data-testid="button-view-transaction-${id}"]`);
    await check("modal-transaction-entity-name", transactionFixtures.find(row => row.id === id).entityName || "—");
    await closeDetails();
  }
  await page.click('[data-testid="button-sort-entity-name"]');
  const ids = await page.$$eval('[data-testid^="row-transaction-"]', rows => rows.map(row => row.getAttribute("data-testid").replace("row-transaction-", "")));
  assert.deepEqual(ids, [...transactionFixtures].sort((a, b) => (b.entityName || "").localeCompare(a.entityName || "")).map(row => row.id));
  // These names have the same masked display. Raw-name ordering must still win.
  assert.ok(ids.indexOf("worker-peer") < ids.indexOf("worker"));
  await page.click('[data-testid="button-toggle-filters"]');
  await Promise.all([
    page.waitForResponse(response => response.url().includes("entityName=Morgan+Lancaster")),
    page.type('[data-testid="input-filter-entity-name"]', "Morgan Lancaster"),
  ]);
  assert.ok(requests.some(url => url.includes("entityName=Morgan+Lancaster")));
  assert.deepEqual(await page.evaluate(async () => (await (await fetch("/api/ledger/accounts/account-fixture/transactions")).json()).data), transactionFixtures);
  await page.goto(`${fixture.origin}/ledger/accounts/account-fixture/participants`, { waitUntil: "networkidle0" });
  await check("cell-entity-name-worker", masked);
  await page.evaluate(() => {
    URL.createObjectURL = blob => { blob.text().then(csv => { window.fixtureCSV = csv; }); return "blob:fixture"; };
    // Capture only; avoid navigating to the fake download URL.
    HTMLAnchorElement.prototype.click = () => {};
  });
  await page.click('[data-testid="button-export-csv"]');
  await page.waitForFunction(() => window.fixtureCSV);
  const csv = await page.evaluate(() => window.fixtureCSV);
  assert.ok(csv.includes("Morgan Lancaster") && !csv.includes(masked));
  await Promise.all([
    page.waitForResponse(response => response.url().includes("offset=20")),
    page.click('[data-testid="button-next-page"]'),
  ]);
  await check("cell-entity-name-worker", masked);
  assert.ok(requests.some(url => url.includes("offset=20")));
  console.log("PASS canonical filters, sorting, pagination, raw responses, participant CSV and reactive open dialog.");
}
