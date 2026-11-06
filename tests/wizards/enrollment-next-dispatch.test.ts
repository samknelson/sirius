import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import puppeteer from "puppeteer-core";

const state = vi.hoisted(() => ({
  rows: new Map<string, any>(), events: [] as string[], admin: false,
  failSave: false, failNavigation: false, release: undefined as (() => void) | undefined,
  holdSave: undefined as Promise<void> | undefined,
  matched: false, dependentDob: "", relationOptions: [] as Array<{ id: string; name: string }>,
}));
vi.mock("../../server/storage/unified-options", () => ({
  createUnifiedOptionsStorage: () => ({
    get: async (_type: string, id: string) => state.relationOptions.find(option => option.id === id),
  }),
}));
vi.mock("../../server/plugins/_core", async original => ({
  ...await original<any>(), enforcePluginGating: async () => ({ ok: true }),
}));
vi.mock("../../server/plugins/wizards/entity-access", () => ({
  enforceWizardEntityAccess: async () => ({ ok: true }),
  enforceWizardRecordAccess: async () => ({ ok: true }),
}));
vi.mock("../../server/services/access-policy-evaluator", async original => ({
  ...await original<any>(), checkAccessInline: async () => ({ granted: state.admin }),
}));
vi.mock("../../server/trust/eligibility/executor", () => ({
  evaluateBenefitEligibility: async () => ({ eligible: true, results: [] }),
  pluginConfigToEligibilityRule: vi.fn(),
}));
vi.mock("../../server/plugins/wizards/attachments", () => ({
  createWizardAttachment: async (input: any) => ({ id: "signature-file", fileName: input.fileName }),
  listWizardAttachments: async () => [{ id: "signature-file" }, { id: "document-file" }],
}));

import { storage } from "../../server/storage";
import { registerWizardDispatcherRoutes } from "../../server/plugins/wizards/dispatcher";
import { wizardPluginRegistry } from "../../server/plugins/wizards/registry";
import { benefitElectionEnrollmentPlugin } from "../../server/plugins/wizards/plugins/benefit-election-enrollment";
import { openEnrollmentEnrollmentPlugin } from "../../server/plugins/wizards/plugins/open-enrollment-enrollment";
import { lifeEventEnrollmentPlugin } from "../../server/plugins/wizards/plugins/life-event-enrollment";
import { baoCobraEnrollmentPlugin } from "../../server/plugins/wizards/plugins/bao-cobra-enrollment";
import { computeDefaultEffectiveDate, todayYmd } from "../../server/plugins/wizards/enrollment/foundation";
import { CHILD_ENROLLMENT_RELATIONSHIPS, ADULT_ENROLLMENT_RELATIONSHIPS } from "@shared/utils/enrollment-dependent-age";
import { findSystemHelpsForPath } from "../../server/help/system";

const plugins = [benefitElectionEnrollmentPlugin, openEnrollmentEnrollmentPlugin,
  lifeEventEnrollmentPlugin, baoCobraEnrollmentPlugin];
let server: Server;
let origin: string;
let cookie: string;
function seed(plugin = plugins[0], currentStep = "benefits", extra: any = {}) {
  const row = { id: "enrollment-fixture", type: plugin.id, status: "draft", currentStep,
    data: { workerId: "worker-fixture", policyId: "policy-fixture", benefitIds: ["medical"],
      progress: {}, ...extra } };
  state.rows.set(row.id, row);
  return row;
}
const send = async (suffix: string, input: any, signedIn = true) => fetch(
  `${origin}/api/wizards/enrollment-fixture/dispatch/${suffix}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(signedIn ? { cookie } : {}) },
    body: JSON.stringify(input),
  },
);
const post = async (suffix: string, input: any) => {
  const response = await send(suffix, { input });
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  state.relationOptions = [...CHILD_ENROLLMENT_RELATIONSHIPS, ...ADULT_ENROLLMENT_RELATIONSHIPS]
    .map((name, i) => ({ id: `configured-${i}`, name }));
  vi.spyOn(storage.wizards, "getById").mockImplementation(async id => structuredClone(state.rows.get(id)));
  vi.spyOn(storage.wizards, "update").mockImplementation(async (id, updates) => {
    const saving = !(updates as any).currentStep;
    state.events.push(saving ? "save" : "navigate");
    if (saving && state.holdSave) await state.holdSave;
    if ((saving && state.failSave) || (!saving && state.failNavigation)) {
      throw new Error(saving ? "Fixture persistence unavailable" : "Fixture navigation unavailable");
    }
    const row = { ...state.rows.get(id), ...structuredClone(updates) };
    state.rows.set(id, row);
    return structuredClone(row);
  });
  vi.spyOn(storage.workers, "getWorker").mockResolvedValue({ id: "worker-fixture" } as any);
  vi.spyOn(storage.workers, "getWorkerBySSN").mockImplementation(async () =>
    state.matched ? { id: "dependent-fixture", contactId: "dependent-contact" } as any : undefined);
  vi.spyOn(storage.contacts, "getContact").mockImplementation(async () =>
    ({ id: "dependent-contact", birthDate: state.dependentDob, displayName: "Fictional Dependent" }) as any);
  vi.spyOn(storage.workers, "createWorker").mockResolvedValue({ id: "dependent-fixture" } as any);
  vi.spyOn(storage.workers, "updateWorkerSSN").mockResolvedValue(undefined as any);
  vi.spyOn(storage.workers, "updateWorkerContactBirthDate").mockResolvedValue(undefined as any);
  vi.spyOn(storage.workers, "updateWorkerContactGender").mockResolvedValue(undefined as any);
  vi.spyOn(storage.workerRelations, "searchWorkerRelations").mockImplementation(async params =>
    state.matched ? [{ id: "dependent-relation", worker1: params.workerId,
      worker2: "dependent-fixture", relationType: params.relationTypeId ?? state.relationOptions[0].id }] as any : []);
  vi.spyOn(storage.workerRelations, "create").mockResolvedValue({ id: "dependent-relation" } as any);
  vi.spyOn(storage.workerRelations, "delete").mockResolvedValue(true);
  vi.spyOn(storage.workerTrustElections, "checkDualCoverage").mockResolvedValue([]);
  vi.spyOn(storage.policies, "getPolicyById").mockResolvedValue({ id: "policy-fixture", data: { benefitIds: ["medical", "medical-alt"] } } as any);
  vi.spyOn(storage.pluginConfigs, "search").mockResolvedValue([]);
  vi.spyOn(storage.trustBenefits, "getAllTrustBenefits").mockResolvedValue(
    ["medical", "medical-alt"].map(id => ({ id, name: id, benefitType: "medical-type",
      benefitTypeName: "Medical", benefitTypeOnlyOne: true })) as any,
  );
  vi.spyOn(storage.workerTrustElections, "getActiveByWorker").mockResolvedValue({ benefitIds: ["medical"] } as any);
  const app = express();
  app.use(express.json());
  // Actual cookie-backed fixture authentication. This app is test-only:
  // production auth, configuration, and database records remain untouched.
  app.use(session({ secret: randomUUID(), resave: false, saveUninitialized: false }));
  app.post("/api/fixture/login", (req, res) => {
    (req.session as any).fixtureUser = true;
    res.json({ signedIn: true });
  });
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!(req.session as any).fixtureUser) return void res.sendStatus(401);
    req.user = { claims: { sub: "fixture-staff" }, dbUser: { id: "fixture-staff" } } as any;
    next();
  };
  app.get("/api/wizards/:id", requireAuth, (req, res) => {
    const row = state.rows.get(req.params.id);
    const plugin = wizardPluginRegistry.get(row.type)!;
    res.json({ ...row, manifest: wizardPluginRegistry.computeManifest(plugin, row) });
  });
  app.get("/api/helps/lookup", requireAuth, (req, res) => res.json(findSystemHelpsForPath(String(req.query.path))));
  app.get("/api/options/worker-relation-type", requireAuth, (_req, res) => res.json(state.relationOptions));
  app.get("/api/options/gender", requireAuth, (_req, res) => res.json([
    { id: "gender-nota", name: "Specify Gender", nota: true },
  ]));
  registerWizardDispatcherRoutes(app, requireAuth);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${origin}/api/fixture/login`, { method: "POST" });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});
beforeEach(() => {
  state.rows.clear(); state.events = []; state.admin = false; state.failSave = false;
  state.failNavigation = false; state.release = undefined; state.holdSave = undefined;
  state.matched = false;
});
afterEach(() => state.release?.());
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("real enrollment dispatcher and manifest contract", () => {
  it.each(plugins)("opts in only the affected steps for $id", plugin => {
    const row = seed(plugin, "signature");
    const manifest = wizardPluginRegistry.computeManifest(plugin, row as any);
    for (const step of manifest.steps) {
      expect(!!step.submitOnNext).toBe(["benefits", "effective_date", "signature"].includes(step.id));
    }
  });

  it("requires authentication and refuses incomplete, ineligible, and conflicting benefits", async () => {
    seed();
    expect((await send("benefits/submit", { input: { benefitIds: ["medical"] } }, false)).status).toBe(401);
    for (const benefitIds of [[], ["not-eligible"], ["medical", "medical-alt"]]) {
      expect((await post("benefits/submit", { benefitIds })).status).toBe(500);
    }
    expect(state.events).toEqual([]);
    expect((await post("benefits/submit", { benefitIds: ["medical-alt"] })).status).toBe(200);
    expect(state.rows.get("enrollment-fixture").data.benefitIds).toEqual(["medical-alt"]);
    expect(state.rows.get("enrollment-fixture").currentStep).toBe("benefits");
    expect((await send("navigate", { direction: "next", expectedStep: "benefits" })).status).toBe(200);
    expect(state.rows.get("enrollment-fixture").currentStep).toBe("dependents");
    expect((await send("navigate", { direction: "next", expectedStep: "benefits" })).status).toBe(409);
    expect(state.rows.get("enrollment-fixture").currentStep).toBe("dependents");
  });

  it("retains server date schema/default, administrator override, and fixed-date rules", async () => {
    seed(plugins[0], "effective_date");
    expect((await post("effective_date/submit", { startYmd: "bad-date" })).status).toBe(400);
    expect((await post("effective_date/submit", { startYmd: "2099-01-01" })).status).toBe(500);
    expect((await post("effective_date/submit", { startYmd: computeDefaultEffectiveDate() })).status).toBe(200);
    state.admin = true;
    expect((await post("effective_date/submit", { startYmd: "2099-01-01" })).status).toBe(200);
    seed(plugins[1], "effective_date", { forcedStartYmd: "2027-01-01", startYmd: "2027-01-01" });
    expect((await post("effective_date/submit", { startYmd: "2099-01-01" })).status).toBe(200);
    expect(state.rows.get("enrollment-fixture").data.startYmd).toBe("2027-01-01");
  });

  it.each(plugins)("persists shared signatures without posting for $id", async plugin => {
    seed(plugin, "signature");
    expect((await post("signature/submit", { signature: { type: "typed", value: "   " } })).status).toBe(500);
    expect((await post("signature/submit", { signature: { type: "typed", value: "Example Worker" } })).status).toBe(200);
    expect(state.rows.get("enrollment-fixture").status).toBe("draft");
    expect(state.rows.get("enrollment-fixture").currentStep).toBe("signature");
    expect((await send("navigate", { direction: "next", expectedStep: "signature" })).status).toBe(200);
    expect(state.rows.get("enrollment-fixture").currentStep).toBe(plugin.steps[plugin.steps.findIndex(s => s.id === "signature") + 1].id);
  });
});

describe("authenticated Chromium enrollment workflow", () => {
  it("saves before advancing, preserves errors and revisits, reloads persisted inputs, and renders help", async () => {
    seed();
    const vite = await createViteServer({
      configFile: false, envFile: false, root: process.cwd(),
      cacheDir: path.resolve("node_modules/.vite-enrollment-browser"),
      plugins: [react(), {
        name: "enrollment-browser-fixture",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === "/fixture-start") {
              _res.setHeader("Content-Type", "text/html");
              _res.end("<!doctype html><title>Enrollment fixture sign-in</title>");
              return;
            }
            if (req.url?.startsWith("/wizards/") || req.url?.startsWith("/workers/")) req.url = "/tests/wizards/enrollment-browser.html";
            next();
          });
        },
      }],
      resolve: { alias: [
        { find: "@/plugins/wizards/registry", replacement: path.resolve("tests/wizards/enrollment-browser-registry.ts") },
        { find: "@", replacement: path.resolve("client/src") },
        { find: "@shared", replacement: path.resolve("shared") },
      ] },
      optimizeDeps: { entries: [path.resolve("tests/wizards/enrollment-browser.html")], holdUntilCrawlEnd: false },
      server: { host: "127.0.0.1", port: 0, hmr: false,
        proxy: { "/api": origin },
        watch: { ignored: ["**/.local/**", "**/artifacts/**", "**/generated-artifacts/**"] },
      },
    });
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
      await vite.listen();
      const base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
      const executablePath = ["/repl/tools/bin/chromium", "/usr/bin/chromium"].find(existsSync);
      expect(executablePath, "Chromium must be installed for browser verification").toBeTruthy();
      browser = await puppeteer.launch({ executablePath, headless: true, timeout: 60000,
        args: ["--no-sandbox", "--disable-dev-shm-usage"] });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.setDefaultNavigationTimeout(120000);
      await page.setViewport({ width: 1360, height: 1000 });
      await page.goto(`${base}/fixture-start`);
      expect(await page.evaluate(async () => (await fetch("/api/wizards/enrollment-fixture")).status)).toBe(401);
      await page.evaluate(async () => fetch("/api/fixture/login", { method: "POST" }));
      await page.goto(`${base}/wizards/enrollment-fixture`, { waitUntil: "domcontentloaded" });
      const sel = (id: string) => `[data-testid="${id}"]`;
      const next = sel("button-next-step");
      const previous = sel("button-previous-step");
      const active = async (step: string) => page.waitForFunction(
        value => document.querySelector('[data-testid="active-step"]')?.textContent === value, {}, step);
      const disabled = async (selector: string) => page.$eval(selector, node => (node as HTMLButtonElement).disabled);
      await page.waitForSelector(sel("checkbox-benefit-medical"));
      expect(await page.$(sel("badge-currently-elected-medical"))).toBeTruthy();
      await page.click(sel("button-help-more-system:enrollment-next"));
      await page.waitForSelector('[role="dialog"]');
      expect(await page.$eval('[role="dialog"]', node => node.textContent)).toContain("does not post");
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      await page.click(sel("checkbox-benefit-medical"));
      expect(await disabled(next)).toBe(true);
      await page.click(sel("checkbox-benefit-medical-alt"));
      state.failSave = true;
      await page.click(next);
      await page.waitForFunction(() => document.body.textContent?.includes("Fixture persistence unavailable"));
      await active("benefits");
      expect(await page.$eval(sel("checkbox-benefit-medical-alt"), node => node.getAttribute("aria-checked"))).toBe("true");
      state.failSave = false;
      state.holdSave = new Promise(resolve => { state.release = resolve; });
      await page.click(next);
      await page.waitForFunction(() => (document.querySelector('[data-testid="button-next-step"]') as HTMLButtonElement).disabled);
      expect(await disabled(previous)).toBe(true);
      expect(state.rows.get("enrollment-fixture").currentStep).toBe("benefits");
      state.release!(); state.holdSave = undefined;
      await active("dependents");
      expect(state.events.slice(-2)).toEqual(["save", "navigate"]);
      await page.click(previous);
      await active("benefits");
      expect(await page.$eval(sel("checkbox-benefit-medical-alt"), node => node.getAttribute("aria-checked"))).toBe("true");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(sel("checkbox-benefit-medical-alt"));
      expect(await page.$eval(sel("checkbox-benefit-medical-alt"), node => node.getAttribute("aria-checked"))).toBe("true");
      await mkdir("generated-artifacts/enrollment-next", { recursive: true });
      await page.screenshot({ path: "generated-artifacts/enrollment-next/benefits.png", fullPage: true });
      // Set up the next applicable step without editing the real database.
      seed(plugins[1], "effective_date", { forcedStartYmd: "2027-01-01", startYmd: "2027-01-01" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[type="date"]');
      expect(await disabled(next)).toBe(false);
      expect(await page.$eval('input[type="date"]', node => (node as HTMLInputElement).readOnly || (node as HTMLInputElement).disabled)).toBe(true);
      await page.click(next);
      await active("signature");
      await page.type("#typed-signature", "Example Worker");
      await page.click(next);
      await active("review");
      expect(state.rows.get("enrollment-fixture").data.signature.value).toBe("Example Worker");
      await page.click(previous);
      await active("signature");
      await page.waitForSelector(sel("alert-signature-captured"));
      const saveCount = state.events.filter(event => event === "save").length;
      await page.click(next);
      await active("review");
      expect(state.events.filter(event => event === "save")).toHaveLength(saveCount);
      // The browser reloads the saved signature in COBRA too.
      seed(plugins[3], "signature", { signature: { type: "typed", value: "Captured Name", signedAt: new Date().toISOString() } });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(sel("alert-signature-captured"));
      await page.type("#typed-signature", "Replacement Name");
      state.failNavigation = true;
      await page.click(next);
      await page.waitForFunction(() => document.body.textContent?.includes("Your entry was saved"));
      expect(await page.$eval("#typed-signature", node => (node as HTMLInputElement).value)).toBe("Replacement Name");
      expect(state.rows.get("enrollment-fixture").currentStep).toBe("signature");
      state.failNavigation = false;
      await page.click(next);
      await active(plugins[3].steps[plugins[3].steps.findIndex(step => step.id === "signature") + 1].id);
      expect(state.rows.get("enrollment-fixture").status).toBe("draft");
      // Life Event shares the editable date and every signature capture mode.
      seed(plugins[2], "effective_date", { startYmd: computeDefaultEffectiveDate() });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[type="date"]');
      await page.$eval('input[type="date"]', node => {
        const input = node as HTMLInputElement;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(await disabled(next)).toBe(true);
      const defaultDate = computeDefaultEffectiveDate();
      await page.$eval('input[type="date"]', (node, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }, defaultDate);
      await page.click(next);
      await active("signature");
      await page.click(sel("button-signature-mode-drawn"));
      expect(await disabled(next)).toBe(true);
      const canvas = await page.$("canvas");
      const bounds = (await canvas!.boundingBox())!;
      await page.mouse.move(bounds.x + 30, bounds.y + 30);
      await page.mouse.down();
      await page.mouse.move(bounds.x + 130, bounds.y + 70, { steps: 8 });
      await page.mouse.up();
      expect(await disabled(next)).toBe(false);
      await page.screenshot({ path: "generated-artifacts/enrollment-next/drawn-signature.png", fullPage: true });
      await page.click(next);
      await active("review");
      expect(state.rows.get("enrollment-fixture").data.signature.type).toBe("drawn");
      await page.click(previous);
      await active("signature");
      await page.click(sel("button-signature-mode-upload"));
      expect(await disabled(next)).toBe(true);
      await page.$eval("#signature-file", node => {
        const files = new DataTransfer();
        files.items.add(new File(["invalid content"], "signature.txt", { type: "text/plain" }));
        (node as HTMLInputElement).files = files.files;
        node.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.click(next);
      await page.waitForFunction(() => document.body.textContent?.includes("Unsupported file type"));
      await active("signature");
      expect(await page.$(sel("alert-signature-captured"))).toBeNull();
      await page.$eval("#signature-file", node => {
        const files = new DataTransfer();
        files.items.add(new File(["%PDF-1.4\nfixture"], "signature.pdf", { type: "application/pdf" }));
        (node as HTMLInputElement).files = files.files;
        node.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.click(next);
      await active("review");
      expect(state.rows.get("enrollment-fixture").data.signature).toMatchObject({
        type: "upload", fileId: "signature-file", fileName: "signature.pdf",
      });
      await page.click(previous);
      await active("signature");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector(sel("alert-signature-captured"));
      expect(await disabled(next)).toBe(false);
      expect(errors).toEqual([]);
      await page.screenshot({ path: "generated-artifacts/enrollment-next/authenticated-flow.png", fullPage: true });

      // Exercise the shipped dependent form and the real dispatcher with an
      // authenticated cookie. Only persistence/vendor boundaries are doubles.
      const setInput = async (id: string, value: string) => {
        await page.$eval(sel(id), (node, text) => {
          const input = node as HTMLInputElement;
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      };
      const choose = async (label: string) => {
        await page.click(sel("select-relation-type"));
        await page.waitForSelector('[role="option"]');
        const options = await page.$$('[role="option"]');
        for (const option of options) {
          if (await option.evaluate(node => node.textContent) === label) {
            await option.click();
            return;
          }
        }
        throw new Error(`Relationship not offered: ${label}`);
      };
      const [year, monthDay] = [Number(todayYmd().slice(0, 4)), todayYmd().slice(5)];
      const under25 = `${year - 24}-${monthDay}`;
      const age25 = `${year - 25}-${monthDay}`;
      const age26 = `${year - 26}-${monthDay}`;
      const addButton = sel("button-add-dependent");
      for (const plugin of plugins.slice(0, 3)) {
        state.matched = false;
        seed(plugin, "dependents", { eventType: "birth", eventAction: "add" });
        await page.goto(`${base}/wizards/enrollment-fixture`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(sel("input-dependent-dob"));
        await setInput("input-dependent-ssn", "123-45-6789");
        await setInput("input-dependent-dob", under25);
        await page.waitForFunction(() => !(document.querySelector('[data-testid="button-lookup-dependent"]') as HTMLButtonElement).disabled);
        await page.click(sel("button-lookup-dependent"));
        await page.waitForSelector(sel("input-dependent-given"));
        await setInput("input-dependent-given", "Fictional");
        await setInput("input-dependent-family", "Dependent");
        await choose("Parent");
        expect(await page.$(sel("alert-dependent-age-warning"))).toBeNull();
        expect(await disabled(addButton)).toBe(true); // required document
        await page.$eval(sel("input-dependent-document"), node => {
          const files = new DataTransfer();
          files.items.add(new File(["%PDF-1.4\nfictional evidence"], "birth.pdf", { type: "application/pdf" }));
          (node as HTMLInputElement).files = files.files;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForSelector(sel("text-pending-document"));
        await page.waitForFunction(() => !(document.querySelector('[data-testid="button-add-dependent"]') as HTMLButtonElement).disabled);
        await setInput("input-dependent-dob", age25);
        await page.waitForSelector(sel("alert-dependent-age-warning"));
        expect(await disabled(addButton)).toBe(true); // changed identity requires recheck
        await page.click(sel("button-lookup-dependent"));
        await page.waitForFunction(() => !(document.querySelector('[data-testid="button-add-dependent"]') as HTMLButtonElement).disabled);
        expect(await page.$eval(sel("alert-dependent-age-warning"), node => node.textContent)).toContain(String(year + 1));

        await setInput("input-dependent-dob", age26);
        await page.waitForSelector(sel("alert-dependent-age-error"));
        expect(await disabled(addButton)).toBe(true);
        expect(await page.$eval(sel("input-dependent-given"), node => (node as HTMLInputElement).value)).toBe("Fictional");
        expect(await page.$eval(sel("select-relation-type"), node => node.textContent)).toContain("Parent");
        await page.click(sel("select-relation-type"));
        await page.waitForSelector('[role="option"]');
        expect(await page.$$eval('[role="option"]', nodes => nodes.filter(
          node => node.getAttribute("aria-disabled") === "true").length)).toBe(5);
        await page.keyboard.press("Escape");

        // UI bypass: neither client-supplied labels nor made-up IDs authorize
        // writes or wizard data changes. Test both matched and new workers.
        for (const matched of [false, true]) {
          state.matched = matched; state.dependentDob = age26;
          for (const relationTypeId of ["configured-0", "forged-spouse"]) {
            state.events = [];
            const writesBefore = [storage.workers.createWorker, storage.workers.updateWorkerContactGender,
              storage.workers.updateWorkerContactBirthDate, storage.workerRelations.create]
              .map(fn => vi.mocked(fn).mock.calls.length);
            const refused = await post("dependents/submit", { action: "add", ssn: "123-45-6789",
              birthDate: age26, given: "Fictional", family: "Dependent", relationTypeId,
              relationshipName: "Spouse", documentFileId: "signature-file", gender: "gender-nota" });
            expect(refused.status).toBe(500);
            expect(state.events).toEqual([]);
            expect([storage.workers.createWorker, storage.workers.updateWorkerContactGender,
              storage.workers.updateWorkerContactBirthDate, storage.workerRelations.create]
              .map(fn => vi.mocked(fn).mock.calls.length)).toEqual(writesBefore);
            expect(state.rows.get("enrollment-fixture").data.dependents ?? []).toEqual([]);
          }
        }
        // The same retained entry can be corrected to an allowed adult choice.
        state.matched = true;
        await choose("Spouse");
        await page.waitForSelector(sel("alert-dependent-age-error"), { hidden: true });
        await page.click(sel("button-lookup-dependent"));
        await page.waitForFunction(() => !(document.querySelector('[data-testid="button-add-dependent"]') as HTMLButtonElement).disabled);
        await page.click(addButton);
        await page.waitForSelector(sel("row-dependent-dependent-relation"));
        expect(state.rows.get("enrollment-fixture").data.dependents[0]).toMatchObject({
          matchedExisting: true, birthDate: age26, relationTypeId: "configured-9",
        });
        await page.click(sel("button-remove-dependent-dependent-relation"));
        await page.waitForSelector(sel("row-dependent-dependent-relation"), { hidden: true });
        expect(state.rows.get("enrollment-fixture").data.dependents).toEqual([]);

        // A warning does not prevent a real new-child add.
        state.matched = false;
        await setInput("input-dependent-ssn", "123-45-6789");
        await setInput("input-dependent-dob", age25);
        await page.click(sel("button-lookup-dependent"));
        await page.waitForSelector(sel("input-dependent-given"));
        await setInput("input-dependent-given", "Fictional");
        await setInput("input-dependent-family", "Child");
        await choose("Parent of Handicapped Child");
        await page.$eval(sel("input-dependent-document"), node => {
          const files = new DataTransfer();
          files.items.add(new File(["%PDF-1.4\nfictional evidence"], "birth.pdf", { type: "application/pdf" }));
          (node as HTMLInputElement).files = files.files;
          node.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.waitForFunction(() => !(document.querySelector('[data-testid="button-add-dependent"]') as HTMLButtonElement).disabled);
        await page.click(addButton);
        await page.waitForSelector(sel("row-dependent-dependent-relation"));
        expect(state.rows.get("enrollment-fixture").data.dependents[0]).toMatchObject({
          matchedExisting: false, birthDate: age25, relationTypeId: "configured-2",
        });
      }
      await page.click(sel("button-help-more-system:enrollment-next"));
      await page.waitForSelector('[role="dialog"]');
      expect(await page.$eval('[role="dialog"]', node => node.textContent)).toContain("26th birthday");
      expect(await page.$eval('[role="dialog"]', node => node.textContent)).toContain("Responsible Party");
      await page.$eval('[role="dialog"]', node => {
        const paragraphs = Array.from(node.querySelectorAll("p"));
        paragraphs.find(paragraph => paragraph.textContent?.includes("Starting on the dependent's 26th birthday"))
          ?.scrollIntoView({ block: "center" });
      });
      await page.screenshot({ path: "generated-artifacts/enrollment-next/dependent-age-help.png" });
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      expect(errors).toEqual([]);
      // Exercise worker-page help with authenticated fixture cookies and the
      // actual HelpDisplay. No application authentication bypass is added.
      const helpFixture = state.rows.get("enrollment-fixture");
      for (const [path, helpId, text] of [
        ["/workers/fixture/elections/current", "system:elections-current", "own linked worker"],
        ["/workers/fixture/elections/list", "system:elections-current", "New Election"],
        ["/workers/fixture/sitespecific/bao/cobra", "system:bao-cobra-lifecycle", "Worker self-service"],
      ]) {
        const recordId = path.split("/").at(-1)!;
        state.rows.set(recordId, { ...helpFixture, id: recordId });
        await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(sel(`button-help-more-${helpId}`));
        await page.click(sel(`button-help-more-${helpId}`));
        await page.waitForSelector('[role="dialog"]');
        expect(await page.$eval('[role="dialog"]', node => node.textContent)).toContain(text);
      }
    } catch (error) {
      console.error("Enrollment browser verification failed:", error);
      throw error;
    } finally {
      state.release?.();
      await browser?.close();
      await Promise.race([vite.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
  }, 180000);
});
