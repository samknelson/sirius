import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admin: true,
  enabled: true,
  user: vi.fn(),
  page: vi.fn(),
  permissions: [] as string[],
  components: [] as string[],
}));
vi.mock("../../server/storage", () => ({ storage: {
  users: { getUser: mocks.user }, sessionHistory: { getUserPage: mocks.page },
} }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  clearAccessCache: vi.fn(),
  requireAccess: (permission: string) => {
    mocks.permissions.push(permission);
    return (_req: Request, res: Response, next: NextFunction) =>
      mocks.admin ? next() : res.status(403).json({ message: "Access denied" });
  },
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: (component: string) => {
    mocks.components.push(component);
    return (_req: Request, res: Response, next: NextFunction) =>
      mocks.enabled ? next() : res.status(403).json({ error: "component_disabled" });
  },
}));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn() }));
vi.mock("../../server/services/clerk-provisioning", () => ({ checkClerkConflict: vi.fn(), provisionClerkAccount: vi.fn() }));
vi.mock("../../server/modules/system/timezone", () => ({ buildTimeZoneContext: vi.fn(), getTimeZonePolicy: vi.fn() }));
import { registerUserRoutes } from "../../server/modules/users";

let server: http.Server;
let url: string;
beforeAll(async () => {
  const app = express();
  registerUserRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/users/target/session_history`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  mocks.admin = mocks.enabled = true;
  mocks.user.mockReset().mockResolvedValue({ id: "target" });
  mocks.page.mockReset().mockResolvedValue({ entries: [], total: 0, page: 1, pageSize: 25, totalPages: 0 });
});

describe("user session history API", () => {
  it.each([[false, true], [true, false], [false, false]])("refuses gates before touching history (admin=%s, component=%s)", async (admin, enabled) => {
    mocks.admin = admin;
    mocks.enabled = enabled;
    expect((await fetch(url)).status).toBe(403);
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.components).toContain("system.session_history");
    expect(mocks.permissions).toContain("admin");
  });
  it("returns the normal not-found response without a history read", async () => {
    mocks.user.mockResolvedValue(undefined);
    const response = await fetch(url);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "User not found" });
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it.each(["page=0", "page=-1", "page=1.5", "page=2x", "page=1e2", "page=", "page=1&page=2", "page[x]=1", "page=999999999999999999999", "pageSize=101", "pageSize=0"])(
    "rejects malformed paging %s before storage", async query => {
      expect((await fetch(`${url}?${query}`)).status).toBe(400);
      expect(mocks.page).not.toHaveBeenCalled();
    },
  );
  it("passes the named user and paging to the dedicated storage and disables caching", async () => {
    const response = await fetch(`${url}?page=2&pageSize=100`);
    expect(response.status).toBe(200);
    expect(mocks.page).toHaveBeenCalledWith("target", { page: 2, pageSize: 100 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });
  it("does not relay database error credentials", async () => {
    mocks.page.mockRejectedValue(new Error("sid=synthetic-secret"));
    const response = await fetch(url);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("synthetic-secret");
  });
});
