import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../server/storage", () => ({
  storage: { variables: {
    getByName: async (name: string) => saved.has(name) ? { value: structuredClone(saved.get(name)) } : undefined,
    setByName: async (name: string, value: unknown) => { saved.set(name, structuredClone(value)); return { name, value }; },
  } },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    expect(policy).toBe("admin");
    if (req.headers["x-test-role"] !== "admin") return res.status(403).json({ message: "Forbidden" });
    next();
  },
}));
vi.mock("../../server/services/comm/letter-pdf", () => ({
  renderLetterPdf: vi.fn(async () => Buffer.from("%PDF-fixture")),
}));

import { getEmailDefaults, getPostalDefaults, prepareEmailContent, validateEmailDefaults, validatePostalDefaults } from "../../server/services/comm/message-defaults";
import { registerMessageDefaultsRoutes } from "../../server/modules/message-defaults";
import { renderLetterPdf } from "../../server/services/comm/letter-pdf";
import { htmlToPlainText } from "@shared/utils/html";
import { findSystemHelpsForPath } from "../../server/help/system";

describe("site-wide message defaults", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerMessageDefaultsRoutes(app, "email");
    registerMessageDefaultsRoutes(app, "postal");
    server = await new Promise<Server>((resolve) => { const running = app.listen(0, "127.0.0.1", () => resolve(running)); });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { saved.clear(); vi.clearAllMocks(); });
  const call = (medium: string, method = "GET", value?: unknown, role = "admin", suffix = "") => fetch(`${origin}/api/config/${medium}/message-defaults${suffix}`, {
    method, headers: { "Content-Type": "application/json", "x-test-role": role }, body: value === undefined ? undefined : JSON.stringify(value),
  });

  it("defaults to empty, independently persists both media, and clearing never touches provider/unrelated settings", async () => {
    saved.set("service_config:email", { defaultProvider: "sendgrid", providers: {} });
    saved.set("other", { keep: true });
    expect(await getEmailDefaults()).toEqual({ letterheadHtml: "" });
    expect(await getPostalDefaults()).toEqual({ letterheadHtml: "", footerHtml: "", showPageCount: false });
    expect((await call("email", "PUT", { letterheadHtml: "<b>Email brand</b>" })).status).toBe(200);
    expect((await call("postal", "PUT", { letterheadHtml: "<b>Postal brand</b>", footerHtml: "<p>Footer</p>", showPageCount: true })).status).toBe(200);
    // Provider changes do not change either brand.
    saved.set("service_config:email", { defaultProvider: "local", providers: {} });
    expect(await (await call("email")).json()).toEqual({ letterheadHtml: "<b>Email brand</b>" });
    expect(await (await call("postal")).json()).toEqual({ letterheadHtml: "<b>Postal brand</b>", footerHtml: "<p>Footer</p>", showPageCount: true });
    expect((await call("email", "PUT", { letterheadHtml: "" })).status).toBe(200);
    expect((await getPostalDefaults()).letterheadHtml).toBe("<b>Postal brand</b>");
    expect(saved.get("other")).toEqual({ keep: true });
    expect(saved.get("service_config:email")).toEqual({ defaultProvider: "local", providers: {} });
  });

  it("all read, save, and unsaved preview routes are admin-only and do not mutate on refusal", async () => {
    for (const medium of ["email", "postal"]) {
      for (const [method, suffix] of [["GET", ""], ["PUT", ""], ["POST", "/preview"]]) {
        expect((await call(medium, method, method === "GET" ? undefined : {}, "staff", suffix)).status).toBe(403);
      }
    }
    expect(saved.size).toBe(0);
  });

  it("validates strict bounded fields, rejects tokens, and strips unsafe HTML before saving", async () => {
    for (const value of [{ letterheadHtml: "{{worker}}" }, { letterheadHtml: "x".repeat(50_001) }, { header: "no" }]) {
      expect((await call("email", "PUT", value)).status).toBe(400);
    }
    expect((await call("postal", "PUT", { showPageCount: "true" })).status).toBe(400);
    expect((await call("email", "PUT", { letterheadHtml: '<script>bad()</script><p onclick="bad()" style="position:fixed;color:red">Brand</p>' })).status).toBe(200);
    expect((await getEmailDefaults()).letterheadHtml).toBe('<p style="color:red">Brand</p>');
    expect(() => validatePostalDefaults({ footerHtml: "{{contact}}" })).toThrow();
  });

  it("previews unsaved email/postal content without saving or sending", async () => {
    const response = await call("email", "POST", { letterheadHtml: "<p>Unsaved</p>" }, "admin", "/preview");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preview = await response.json();
    expect(preview.html).toContain("Unsaved");
    expect(preview.text).toBe(htmlToPlainText(preview.html));
    const pdf = await call("postal", "POST", { letterheadHtml: "<p>Postal draft</p>", footerHtml: "<p>Foot</p>", showPageCount: true }, "admin", "/preview");
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect(vi.mocked(renderLetterPdf).mock.calls[0][1]).toMatchObject({
      defaults: { letterheadHtml: "<p>Postal draft</p>", footerHtml: "<p>Foot</p>", showPageCount: true },
      previewGuides: true,
    });
    expect(saved.size).toBe(0);
  });

  it("decorates sanitized HTML and escaped plain text with equivalent alternatives, never mutating source", () => {
    const defaults = validateEmailDefaults({ letterheadHtml: "<p><strong>Brand</strong></p>" });
    const source = { bodyHtml: "<p>Hello</p>", bodyText: "stale" };
    const output = prepareEmailContent(source, defaults);
    expect(output.html?.match(/Brand/g)).toHaveLength(1);
    expect(output.text).toBe(htmlToPlainText(output.html!));
    expect(output.text).not.toContain("stale");
    expect(source).toEqual({ bodyHtml: "<p>Hello</p>", bodyText: "stale" });
    const textOnly = prepareEmailContent({ bodyText: "Hello <worker>\nSecond line & details" }, defaults);
    expect(textOnly.html).toContain("&lt;worker&gt;<br>");
    expect(textOnly.text).toContain("Hello <worker>");
    expect(textOnly.text).toContain("Second line & details");
    expect(prepareEmailContent({ bodyText: "Unchanged" }, { letterheadHtml: "" })).toEqual({ html: undefined, text: "Unchanged" });
    expect(() => prepareEmailContent({ bodyHtml: "" }, defaults)).toThrow("body");
  });

  it("reads each delivery afresh while previous snapshots stay unchanged", async () => {
    saved.set("message_defaults:email", { letterheadHtml: "First" });
    const snapshot = await getEmailDefaults();
    saved.set("message_defaults:email", { letterheadHtml: "Later" });
    expect((await getEmailDefaults()).letterheadHtml).toBe("Later");
    expect(snapshot.letterheadHtml).toBe("First");
  });

  it("registers narrowly matched, sanitized built-in help without touching local help", () => {
    for (const medium of ["email", "postal"]) {
      const help = findSystemHelpsForPath(`/config/${medium}`).find((entry) => entry.id === `system:${medium}-message-defaults`);
      expect(help?.source).toBe("system");
      expect(help?.details).toContain("<h3>How to use this page</h3>");
      expect(help?.details).toContain("queued");
      for (const path of [`/config/${medium}/extra`, "/config/helps", "/workers/123", "/config/email-other"]) {
        expect(findSystemHelpsForPath(path).some((entry) => entry.id === help?.id)).toBe(false);
      }
    }
  });
});
