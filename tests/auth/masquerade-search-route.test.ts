import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  getUser: vi.fn(),
  getUserData: vi.fn(),
  updateUserData: vi.fn(),
  resolveDbUser: vi.fn(),
  requireAccess: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: { users: {
    searchUsers: mocks.searchUsers, getUser: mocks.getUser,
    getUserData: mocks.getUserData, updateUserData: mocks.updateUserData,
  } },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: mocks.requireAccess,
}));
vi.mock("../../server/logger", () => ({ storageLogger: { info: vi.fn() } }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => null }));
vi.mock("../../server/auth/helpers", () => ({ resolveDbUser: mocks.resolveDbUser }));

import { registerMasqueradeRoutes } from "../../server/modules/masquerade";

let server: Server;
let baseUrl: string;
beforeEach(async () => {
  mocks.searchUsers.mockReset();
  mocks.getUser.mockReset();
  mocks.getUserData.mockReset().mockResolvedValue({});
  mocks.updateUserData.mockReset().mockResolvedValue(undefined);
  mocks.resolveDbUser.mockReset().mockResolvedValue({
    id: "admin", email: "admin@example.com", firstName: "Admin", lastName: "User",
  });
  mocks.requireAccess.mockReset().mockImplementation((policy: string) => (req: any, res: any, next: any) => {
    // Model the relevant masquerade policy: permission OR admin, not staff.
    if (policy !== "masquerade" || !req.headers["x-test-permissions"]?.split(",").some(
      (permission: string) => permission === "masquerade" || permission === "admin",
    )) return res.status(403).json({ message: "Forbidden" });
    next();
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { claims: { sub: "admin" } } as any;
    req.session = {
      save: (done: (error?: Error) => void) => done(),
    } as any;
    next();
  });
  registerMasqueradeRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

describe("masquerade active target policy", () => {
  const headers = { "x-test-permissions": "masquerade", "content-type": "application/json" };
  const target = { id: "target", email: "target@example.com", firstName: "Target", lastName: "User", isActive: true };

  it("rejects direct start requests for deactivated users without saving session or history", async () => {
    mocks.getUser.mockResolvedValue({ ...target, isActive: false });
    const response = await fetch(`${baseUrl}/api/auth/masquerade/start`, {
      method: "POST", headers, body: JSON.stringify({ userId: target.id }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: "Cannot masquerade as a deactivated user" });
    expect(mocks.getUserData).not.toHaveBeenCalled();
    expect(mocks.updateUserData).not.toHaveBeenCalled();
  });

  it("still starts an active target and records it in recents", async () => {
    mocks.getUser.mockResolvedValue(target);
    const response = await fetch(`${baseUrl}/api/auth/masquerade/start`, {
      method: "POST", headers, body: JSON.stringify({ userId: target.id }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).masqueradingAs.id).toBe(target.id);
    expect(mocks.updateUserData).toHaveBeenCalledWith("admin", expect.objectContaining({
      recentMasquerades: [expect.objectContaining({ userId: target.id })],
    }));
  });

  it("returns only current active targets in recents, with refreshed profile fields", async () => {
    mocks.getUserData.mockResolvedValue({ recentMasquerades: [
      { userId: "target", email: "old@example.com", firstName: "Old", lastName: null, timestamp: "2026-01-01" },
      { userId: "inactive", email: "inactive@example.com", timestamp: "2026-01-02" },
      { userId: "deleted", email: "deleted@example.com", timestamp: "2026-01-03" },
    ] });
    mocks.getUser.mockImplementation(async (id: string) =>
      id === "target" ? target : id === "inactive" ? { ...target, id, isActive: false } : null);
    const response = await fetch(`${baseUrl}/api/auth/masquerade/recent`, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recentMasquerades: [{
      userId: "target", email: "target@example.com", firstName: "Target", lastName: "User", timestamp: "2026-01-01",
    }] });
    expect(mocks.updateUserData).not.toHaveBeenCalled();
  });
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