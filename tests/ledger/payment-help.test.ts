import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { IStorage } from "../../server/storage";
import { registerHelpRoutes } from "../../server/modules/helps";
import { findSystemHelpsForPath, getAllSystemHelps, getSystemHelp } from "../../server/help/system";
import { onlineCheckoutHelp, onlinePaymentReceiptHelp, workerPaymentChooserHelp } from "../../server/help/system/online-checkout";
import { workerPaymentMethodsHelp } from "../../server/help/system/worker-payment-methods";
import { likePatternMatches } from "../../server/help/path-match";
import { sanitizeHtml } from "@shared/utils/html";

const authored = [workerPaymentChooserHelp, onlineCheckoutHelp, onlinePaymentReceiptHelp, workerPaymentMethodsHelp];
const ids = new Set(authored.map(entry => entry.id));
const chooser = workerPaymentChooserHelp.id;
const checkout = onlineCheckoutHelp.id;
const receipt = onlinePaymentReceiptHelp.id;
const methods = workerPaymentMethodsHelp.id;
const ea = "a0000000-0000-4000-8000-000000000000";
const session = "b0000000-0000-4000-8000-000000000000";
const matches = (path: string) => findSystemHelpsForPath(path).filter(entry => ids.has(entry.id)).map(entry => entry.id);

describe("online payment help route boundaries", () => {
  it.each([
    ["/workers/fictional/ledger/pay", chooser],
    ["/workers/fictional/ledger/payment-methods", methods],
    [`/pay/${ea}`, checkout],
    [`/pay/receipt/${session}`, receipt],
  ])("offers only the relevant payment entry on %s", (path, id) => {
    expect(matches(path)).toEqual([id]);
  });

  it("covers every generated EA UUID prefix without offering checkout instructions on receipts", () => {
    for (const first of "0123456789abcdef") {
      const uuid = first + ea.slice(1);
      expect(matches(`/pay/${uuid}`)).toEqual([checkout]);
      expect(matches(`/pay/receipt/${uuid}`)).toEqual([receipt]);
    }
    expect(likePatternMatches("/pay/%", `/pay/receipt/${session}`)).toBe(true);
    // Regression: the tempting /pay/% pattern overlaps the real receipt route.
    expect(onlineCheckoutHelp.paths.some(pattern => likePatternMatches(pattern, `/pay/receipt/${session}`))).toBe(false);
    for (const path of [`/pay/receipt/${session}/nested`, `/pay/receipt/pay/${ea}`,
      `/pay/receipt/${session}/workers/fictional/ledger/pay`]) {
      expect(matches(path)).toEqual([receipt]);
    }
  });

  it.each([
    "/workers", "/workers/fictional", "/workers/fictional/ledger/accounts",
    "/workers/fictional/ledger/pay/", "/workers/fictional/ledger/pay/extra",
    "/workers/fictional/ledger/pay-other", "/workers/fictional/ledger/payment-methods/",
    "/workers/fictional/ledger/payment-methods/extra", "/workers/fictional/ledger/payment_methods",
    "/workers/fictional/ledger/sitespecific/bao/echp", "/workers/fictional/benefits/current",
    "/employers/fictional/ledger/payment_methods", "/ea/fictional/payments", "/ledger/payment/fictional",
    "/config/ledger/settings", "/config/helps", "/dashboard", "/__mockup/",
    "/pay", "/pay/receipt", "/pay/receipt-other/example", "/Pay/" + ea,
    "/api/ledger/checkout/worker/fictional/" + ea,
  ])("does not add payment help on a near miss or unrelated path: %s", path => {
    expect(matches(path)).toEqual([]);
  });

  it("explicitly records the existing cross-segment wildcard limitation, not a segment-only fiction", () => {
    expect(matches("/workers/fictional/nested/ledger/pay")).toEqual([chooser]);
    expect(matches("/workers/fictional/nested/ledger/payment-methods")).toEqual([methods]);
    expect(matches(`/pay/${ea}/nested`)).toEqual([checkout]);
    expect(matches(`/pay/receipt/${session}/nested`)).toEqual([receipt]);
    // Even a nested receipt-shaped suffix cannot turn a real receipt into checkout.
    // These malformed paths have no corresponding shipped browser route.
    expect(matches(`/pay/${ea}/receipt/${session}`)).toEqual([checkout]);
    expect(matches(`/pay/${ea}/`)).toEqual([checkout]);
  });
});

describe("online payment help content safety", () => {
  it("registers unique stable IDs and retains the semantic content through the real sanitizer", () => {
    const all = getAllSystemHelps();
    expect(new Set(all.map(entry => entry.id)).size).toBe(all.length);
    for (const entry of authored) {
      const registered = getSystemHelp(entry.id)!;
      expect(all.filter(item => item.id === entry.id)).toHaveLength(1);
      expect(registered.source).toBe("system");
      expect(entry.summary).not.toMatch(/[<>\r\n]/);
      const sanitized = sanitizeHtml(entry.details!, "rich-document");
      expect(registered.details).toBe(sanitized);
      // No heading, step, exact control label or warning was lost.
      expect(sanitized.replace(/\s+/g, " ").trim()).toBe(entry.details!.replace(/\s+/g, " ").trim());
      let previous = -1;
      for (const heading of ["Purpose", "Before you start", "How to use this page", "Results and status meanings", "Limitations and common problems"]) {
        const position = sanitized.indexOf(`<h3>${heading}</h3>`);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
    }
  });

  it("keeps consequential warnings before instructions and checkout-only procedures off receipts", () => {
    const checkoutDetails = getSystemHelp(checkout)!.details!;
    expect(checkoutDetails.indexOf("can charge")).toBeLessThan(checkoutDetails.indexOf("<ol>"));
    expect(checkoutDetails).toContain("for this payment only");
    expect(checkoutDetails).toContain("unknown pending allocation blocks checkout");
    const receiptDetails = getSystemHelp(receipt)!.details!;
    expect(receiptDetails.indexOf("Do not pay again")).toBeLessThan(receiptDetails.indexOf("<ol>"));
    expect(receiptDetails.indexOf("not a refund or reversal")).toBeLessThan(receiptDetails.indexOf("<strong>Abandon this payment</strong>"));
    expect(receiptDetails).toContain("only after the provider confirms cancellation");
    expect(receiptDetails).not.toMatch(/Continue to secure confirmation|Pay selected statements|New credit\/debit card/);
    const methodDetails = getSystemHelp(methods)!.details!;
    expect(methodDetails.indexOf("does not cancel, reverse, or refund")).toBeLessThan(methodDetails.indexOf("<ol>"));
    expect(methodDetails).toContain("can remain listed");
    expect(methodDetails).toContain("does not guarantee the provider has removed it");
  });
});

// Isolated HTTP contract checks, NOT a signed-in app session or provider test.
// Fake auth and local help exist only in this in-memory Express harness.
describe("payment help through the existing help HTTP handlers", () => {
  let server: Server;
  let origin: string;
  const local = { id: "fictional-local-help", paths: ["/workers/%/ledger/pay"],
    summary: "Fictional local procedure", details: "<p>Preserve local guidance.</p>", data: null };
  const original = JSON.stringify(local);
  const helpStorage = {
    getAll: async () => [local],
    findMatchingForPath: async (path: string) => local.paths.some(pattern => likePatternMatches(pattern, path)) ? [local] : [],
  };
  beforeAll(async () => {
    const app = express();
    registerHelpRoutes(app,
      (req, res, next) => req.headers["x-fixture-signed-in"] === "yes" ? next() : void res.status(401).end(),
      () => (_req, res) => { res.status(403).end(); },
      { helps: helpStorage } as unknown as IStorage);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const read = (path: string) => fetch(`${origin}${path}`, { headers: { "x-fixture-signed-in": "yes" } });

  it("requires authentication for listing and lookup", async () => {
    for (const path of ["/api/helps", `/api/helps/lookup?path=${encodeURIComponent(`/pay/${ea}`)}`]) {
      expect((await fetch(origin + path)).status).toBe(401);
    }
  });
  it("lists the sanitized built-ins and preserves a matching local entry alongside them", async () => {
    const listing = await read("/api/helps");
    expect(listing.status).toBe(200);
    const entries = await listing.json();
    expect(entries.filter((entry: { id: string }) => ids.has(entry.id))).toHaveLength(4);
    expect(entries.find((entry: { id: string }) => entry.id === local.id)).toEqual({ ...local, source: "config" });
    const lookup = await read("/api/helps/lookup?path=" + encodeURIComponent("/workers/fictional/ledger/pay"));
    expect((await lookup.json()).map((entry: { id: string }) => entry.id)).toEqual([local.id, chooser]);
    expect(JSON.stringify(local)).toBe(original);
  });
  it("looks up receipt help without checkout procedures through the actual route", async () => {
    const response = await read("/api/helps/lookup?path=" + encodeURIComponent(`/pay/receipt/${session}`));
    expect(response.status).toBe(200);
    const entries = await response.json();
    expect(entries.map((entry: { id: string }) => entry.id)).toEqual([receipt]);
    expect(entries[0].details).not.toContain("Continue to secure confirmation");
  });
});
