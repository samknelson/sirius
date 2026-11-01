import express, { type Express } from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";

const fixtures = vi.hoisted(() => ({
  letterTemplates: { create: vi.fn(), update: vi.fn(), get: vi.fn() },
  bulkMessages: { getById: vi.fn() },
  bulkMessagesEmail: { getByBulkId: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("../../server/storage", () => ({ storage: fixtures }));
vi.mock("../../server/plugins/tokens/contexts", () => ({
  listTokenContexts: () => [{ id: "test" }],
  resolveTokenContextGate: () => ({ ok: true }),
  tokenContextRootNames: () => ["user"],
}));
vi.mock("../../server/plugins/tokens", () => ({
  validateTokenExpressionForRoots: (expression: string) =>
    expression.includes("forbidden") ? { ok: false, error: "Unavailable root" } : { ok: true },
}));
vi.mock("../../server/storage/bulk/participants", () => ({
  createBulkParticipantStorage: () => ({}),
}));
vi.mock("../../server/modules/bulk/deliver", () => ({}));
vi.mock("../../server/logger", () => ({ storageLogger: {} }));
vi.mock("../../server/modules/contact-links", () => ({}));
vi.mock("../../server/plugins/tokens/plugins/bulk-participant", () => ({}));
vi.mock("../../server/modules/bulk/token-roots", () => ({}));

import { registerLetterTemplateRoutes } from "../../server/modules/letter-templates";
import { registerBulkMessageRoutes } from "../../server/modules/bulk/messages";

let server: Server;
let baseUrl: string;
const TOKEN = '{{user.field(name="email")}}';
const dirty = '<p>Hello</p><img src=x onerror="evil()" data-token="bait">' +
  '<span data-token="user.field(name=&quot;email&quot;)">old</span>' +
  '<a href="javascript:evil()">bad</a>';

async function request(path: string, method: string, body: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  const allow = (_req: unknown, _res: unknown, next: () => void) => next();
  // Authentication is a fixture in this private test server, never an app bypass.
  registerLetterTemplateRoutes(app, () => allow);
  registerBulkMessageRoutes(app, allow, () => allow, fixtures as unknown as IStorage);
  server = await new Promise<Server>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.resetAllMocks();
  fixtures.letterTemplates.create.mockImplementation(async (value) => ({ id: "template", ...value }));
  fixtures.letterTemplates.update.mockImplementation(async (_id, value) => ({ id: "template", ...value }));
  fixtures.letterTemplates.get.mockResolvedValue({
    id: "template", name: "Existing", medium: "email",
    contextIds: ["test"], content: { subject: "Existing", bodyHtml: "<p>Keep me</p>" },
  });
  fixtures.bulkMessages.getById.mockResolvedValue({ id: "bulk", medium: ["email", "sms"] });
  fixtures.bulkMessagesEmail.create.mockImplementation(async (value) => value);
  fixtures.bulkMessagesEmail.update.mockImplementation(async (_id, value) => value);
  fixtures.bulkMessagesEmail.getByBulkId.mockResolvedValue(null);
});

describe("letter template HTML writes", () => {
  it.each(["POST", "PATCH"])("%s cleans saved HTML and preserves literal subject/data", async (method) => {
    const result = await request(
      "/api/admin/letter-templates" + (method === "PATCH" ? "/template" : ""),
      method,
      {
        name: "Notice", medium: "email", contextIds: ["test"],
        content: { subject: " <b>Literal</b> ", bodyHtml: dirty },
        data: { integration: "<b>unmodified</b>" },
      },
    );
    expect(result.status).toBe(method === "POST" ? 201 : 200);
    expect(result.body.content.bodyHtml).toContain(TOKEN);
    expect(result.body.content.bodyHtml).not.toMatch(/onerror|<img|data-token|javascript:/);
    expect(result.body.content.subject).toBe(" <b>Literal</b> ");
    expect(result.body.data).toEqual({ integration: "<b>unmodified</b>" });
  });

  it("preserves omitted content on a name-only PATCH", async () => {
    const result = await request("/api/admin/letter-templates/template", "PATCH", { name: "Renamed" });
    expect(result.status).toBe(200);
    expect(fixtures.letterTemplates.update.mock.calls[0][1]).toEqual({ name: "Renamed" });
  });

  it("cleans existing content when a medium-only PATCH reclassifies it as HTML", async () => {
    fixtures.letterTemplates.get.mockResolvedValue({
      medium: "sms", contextIds: ["test"], content: { body: "<p>Letter</p><img onerror=evil()>" },
    });
    const result = await request("/api/admin/letter-templates/template", "PATCH", { medium: "postal" });
    expect(result.status).toBe(200);
    expect(result.body.content).toEqual({ body: "<p>Letter</p>" });
  });

  it("resolves an omitted medium from the existing template on content PATCH", async () => {
    const result = await request("/api/admin/letter-templates/template", "PATCH", {
      content: { subject: "Notice", bodyHtml: dirty },
    });
    expect(result.status).toBe(200);
    expect(result.body.content.bodyHtml).toContain(TOKEN);
    expect(result.body.content.bodyHtml).not.toContain("<img");
  });

  it.each(["POST", "PATCH"])("%s validates token roots AFTER legacy conversion", async (method) => {
    const result = await request(
      "/api/admin/letter-templates" + (method === "PATCH" ? "/template" : ""),
      method, {
        name: "Bad", medium: "email", contextIds: ["test"],
        content: { bodyHtml: '<span data-token="forbidden.field">label</span>' },
      },
    );
    expect(result.status).toBe(400);
    expect(fixtures.letterTemplates.create).not.toHaveBeenCalled();
    expect(fixtures.letterTemplates.update).not.toHaveBeenCalled();
  });

  it("keeps SMS text verbatim", async () => {
    const result = await request("/api/admin/letter-templates", "POST", {
      name: "SMS", medium: "sms", contextIds: ["test"],
      content: { body: "<b>literal text</b>" },
    });
    expect(result.status).toBe(201);
    expect(result.body.content.body).toBe("<b>literal text</b>");
  });
});

describe("bulk email HTML writes", () => {
  it.each([false, true])("cleans HTML for an existing record: %s", async (existing) => {
    if (existing) fixtures.bulkMessagesEmail.getByBulkId.mockResolvedValue({ id: "email" });
    const result = await request("/api/bulk-messages/bulk/message?medium=email", "PUT", {
      subject: " <b>Subject</b> ", bodyHtml: dirty, data: { custom: "<b>literal</b>" },
    });
    expect(result.status).toBe(200);
    expect(result.body.record.bodyHtml).toContain(TOKEN);
    expect(result.body.record.bodyHtml).not.toMatch(/<img|onerror|javascript:|data-token/);
    expect(result.body.record.subject).toBe(" <b>Subject</b> ");
    expect(result.body.record.data).toEqual({ custom: "<b>literal</b>" });
  });

  it("does not erase an omitted body on subject-only updates", async () => {
    fixtures.bulkMessagesEmail.getByBulkId.mockResolvedValue({ id: "email", bodyHtml: dirty });
    const result = await request("/api/bulk-messages/bulk/message?medium=email", "PUT", {
      subject: "Revised",
    });
    expect(result.status).toBe(200);
    expect(fixtures.bulkMessagesEmail.update.mock.calls[0][1]).toEqual({ subject: "Revised" });
  });

  it("does not coerce invalid body types into strings", async () => {
    const result = await request("/api/bulk-messages/bulk/message?medium=email", "PUT", {
      subject: "Invalid", bodyHtml: { html: dirty },
    });
    expect(result.status).toBe(400);
    expect(fixtures.bulkMessagesEmail.create).not.toHaveBeenCalled();
  });
});
