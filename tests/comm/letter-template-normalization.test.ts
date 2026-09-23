import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";

const state = vi.hoisted(() => ({
  row: undefined as any,
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { letterTemplates: {
    get: async () => state.row,
    getAll: async () => state.row ? [state.row] : [],
    create: state.create,
    update: state.update,
  } },
}));
vi.mock("../../server/plugins/tokens/contexts", () => ({
  listTokenContexts: () => [{ id: "test" }],
  resolveTokenContextGate: () => ({ ok: true }),
  tokenContextRootNames: () => ["worker"],
}));
vi.mock("../../server/plugins/tokens", () => ({
  validateTokenExpressionForRoots: () => ({ ok: true }),
}));
import { registerLetterTemplateRoutes } from "../../server/modules/letter-templates";

describe("letter template save and reopen normalization", () => {
  const routes = new Map<string, (...args: any[]) => any>();
  const app = Object.fromEntries(["get", "post", "patch", "delete"].map((method) =>
    [method, (path: string, ...handlers: any[]) => routes.set(`${method} ${path}`, handlers.at(-1))]));
  registerLetterTemplateRoutes(app as unknown as Express, () => (_req, _res, next) => next());
  const imported = '<html><head><style>td { padding: 12px }</style></head><body><table><tr><td>Hello</td></tr></table></body></html>';
  async function call(method: string, path: string, body?: unknown) {
    const res: any = { code: 200, value: undefined };
    res.status = (code: number) => { res.code = code; return res; };
    res.json = (value: unknown) => { res.value = value; return res; };
    await routes.get(`${method} ${path}`)!({ body, params: { id: "one" }, query: {} }, res);
    return res;
  }
  beforeEach(() => {
    state.row = undefined;
    state.create.mockImplementation(async (input) => state.row = { ...input, id: "one" });
    state.update.mockImplementation(async (_id, input) => state.row = { ...state.row, ...input });
  });
  it("persists normalized HTML and returns exactly the same layout on reopen and resave", async () => {
    const created = await call("post", "/api/admin/letter-templates", {
      name: "Imported", medium: "postal", contextIds: ["test"], content: { bodyHtml: imported },
    });
    expect(created.code).toBe(201);
    const html = created.value.content.bodyHtml;
    expect(html).not.toContain("<html");
    expect(html).toMatch(/padding:\s*12px/);
    const reopened = await call("get", "/api/admin/letter-templates/:id");
    expect(reopened.value.content.bodyHtml).toBe(html);
    const saved = await call("patch", "/api/admin/letter-templates/:id", { content: reopened.value.content });
    expect(saved.value.content.bodyHtml).toBe(html);
  });
  it("normalizes legacy imports on both detail and list reads without mutating storage", async () => {
    state.row = { id: "one", medium: "email", content: { bodyHtml: imported } };
    const detail = await call("get", "/api/admin/letter-templates/:id");
    const list = await call("get", "/api/admin/letter-templates");
    expect(detail.value.content.bodyHtml).toEqual(list.value[0].content.bodyHtml);
    expect(detail.value.content.bodyHtml).toMatch(/padding:\s*12px/);
    expect(state.row.content.bodyHtml).toBe(imported);
  });
});