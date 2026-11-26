import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  staff: true,
  get: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  find: vi.fn(),
  create: vi.fn(),
  flood: vi.fn(),
}));
vi.mock("../../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, res: any, next: () => void) =>
    state.enabled ? next() : res.status(403).json({ message: "Component disabled" }),
}));
vi.mock("../../../server/services/access-policy-evaluator", () => ({
  requireAccess: (policy: string) => (_req: unknown, res: any, next: () => void) => {
    expect(policy).toBe("staff");
    return state.staff ? next() : res.status(403).json({ message: "Staff required" });
  },
}));
vi.mock("../../../server/modules/masquerade", () => ({
  getEffectiveUser: async () => ({ dbUser: { id: "effective-user" } }),
}));
vi.mock("../../../server/flood", () => ({
  enforceFloodLimit: state.flood,
  FloodError: class FloodError extends Error {},
}));
vi.mock("../../../server/storage", () => ({
  storage: { bookmarks: {
    getUserBookmarks: state.list, getEnrichedUserBookmarks: state.list,
    getBookmark: state.get, deleteBookmark: state.remove,
    findBookmark: state.find, createBookmark: state.create,
  } },
}));
import { registerBookmarkRoutes } from "../server/modules/bookmarks";
import { bookmarksPlugin } from "../server/plugins/dashboard/plugins/bookmarks";
import "../server/plugins/system/flood/plugins/bookmark";
import { floodPluginRegistry } from "../../../server/plugins/system/flood/registry";

let server: Server;
let base: string;
beforeEach(async () => {
  vi.clearAllMocks();
  state.enabled = true;
  state.staff = true;
  const app = express();
  app.use(express.json());
  registerBookmarkRoutes(app);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

it("refuses every disabled API before reading feature storage", async () => {
  state.enabled = false;
  for (const [method, path] of [
    ["GET", ""], ["GET", "/enriched"], ["GET", "/check?entityType=worker&entityId=w"],
    ["POST", ""], ["DELETE", "/b"], ["DELETE", "/entity/worker/w"],
  ]) {
    expect((await fetch(`${base}/api/bookmarks${path}`, { method })).status).toBe(403);
  }
  for (const fn of [state.list, state.get, state.find, state.create, state.remove, state.flood]) {
    expect(fn).not.toHaveBeenCalled();
  }
});

it("retains staff authority and scopes reads to the effective masqueraded user", async () => {
  state.staff = false;
  expect((await fetch(`${base}/api/bookmarks`)).status).toBe(403);
  expect(state.list).not.toHaveBeenCalled();
  state.staff = true;
  state.list.mockResolvedValue([]);
  expect((await fetch(`${base}/api/bookmarks`)).status).toBe(200);
  expect(state.list).toHaveBeenCalledWith("effective-user");
});

it("does not let the effective user delete somebody else's bookmark", async () => {
  state.get.mockResolvedValue({ id: "b", userId: "another-user" });
  expect((await fetch(`${base}/api/bookmarks/b`, { method: "DELETE" })).status).toBe(403);
  expect(state.remove).not.toHaveBeenCalled();
  state.get.mockResolvedValue({ id: "b", userId: "effective-user" });
  state.remove.mockResolvedValue(true);
  expect((await fetch(`${base}/api/bookmarks/b`, { method: "DELETE" })).status).toBe(204);
  expect(state.remove).toHaveBeenCalledWith("b");
});

it("preserves plugin identifiers, component gates, flood buckets and permission hints", () => {
  expect(bookmarksPlugin).toMatchObject({
    id: "bookmarks", requiredComponent: "bookmark",
    client: { component: "bookmarks:Bookmarks", requiredPermissions: ["bookmark", "admin"] },
  });
  expect(bookmarksPlugin.requiredPolicy).toBeUndefined();
  const flood = floodPluginRegistry.get("bookmark")!;
  expect(flood).toMatchObject({
    singleton: true, requiredComponent: "bookmark",
    defaults: { threshold: 1000, windowSeconds: 360 },
  });
  expect(flood.getIdentifier({ userId: "effective-user" })).toBe("effective-user");
});
