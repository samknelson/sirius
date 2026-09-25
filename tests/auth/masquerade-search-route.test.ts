import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  requireAccess: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { users: { searchUsers: mocks.searchUsers } },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: mocks.requireAccess,
}));
vi.mock("../../server/logger", () => ({ storageLogger: { info: vi.fn() } }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => null }));
vi.mock("../../server/auth/helpers", () => ({ resolveDbUser: vi.fn() }));

import { registerMasqueradeRoutes } from "../../server/modules/masquerade";

let server: Server;
let baseUrl: string;
beforeEach(async () => {
  mocks.searchUsers.mockReset();
  mocks.requireAccess.mockReset().mockImplementation((policy: string) => (req: any, res: any, next: any) => {
    // Model the relevant masquerade policy: permission OR admin, not staff.
    if (policy !== "masquerade" || !req.headers["x-test-permissions"]?.split(",").some(
      (permission: string) => permission === "masquerade" || permission === "admin",
    )) return res.status(403).json({ message: "Forbidden" });
    next();
  });
  const app = express();
  registerMasqueradeRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("masquerade target search authorization", () => {
  it("lets a masquerade-only user search eligible targets without staff access", async () => {
    mocks.searchUsers.mockResolvedValue([
      { id: "a", email: "a@example.com", firstName: "A", lastName: "User", isActive: true, passwordHash: "private" },
      { id: "b", email: "b@example.com", firstName: "B", lastName: "User", isActive: false },
    ]);
    const response = await fetch(`${baseUrl}/api/auth/masquerade/search?q=EXAMPLE`, {
      headers: { "x-test-permissions": "masquerade" },
    });
    expect(response.status).toBe(200);
    expect(mocks.requireAccess).toHaveBeenCalledWith("masquerade");
    expect(mocks.searchUsers).toHaveBeenCalledWith("example", undefined, 20);
    expect(await response.json()).toEqual([
      { id: "a", email: "a@example.com", firstName: "A", lastName: "User", isActive: true },
    ]);
  });
  it("rejects users lacking masquerade authorization and avoids unbounded empty searches", async () => {
    const denied = await fetch(`${baseUrl}/api/auth/masquerade/search?q=example`, {
      headers: { "x-test-permissions": "staff" },
    });
    expect(denied.status).toBe(403);
    const empty = await fetch(`${baseUrl}/api/auth/masquerade/search?q=a`, {
      headers: { "x-test-permissions": "masquerade" },
    });
    expect(await empty.json()).toEqual([]);
    expect(mocks.searchUsers).not.toHaveBeenCalled();
  });
});