import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createUserStorage } from "../server/storage/users";
import { permissionRegistry } from "../shared/permissions";

const mocks = vi.hoisted(() => ({
  storage: { users: undefined as ReturnType<typeof createUserStorage> | undefined },
}));

vi.mock("../server/storage", () => ({
  storage: mocks.storage,
}));

vi.mock("../server/services/access-policy-evaluator", () => ({
  clearAccessCache: vi.fn(),
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../server/modules/masquerade", () => ({
  getEffectiveUser: vi.fn(),
}));

vi.mock("../server/services/clerk-provisioning", () => ({
  checkClerkConflict: vi.fn(),
  provisionClerkAccount: vi.fn(),
}));

const { registerUserRoutes } = await import("../server/modules/users");

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  mocks.storage.users = createUserStorage();

  const app = express();
  registerUserRoutes(
    app,
    (_req, _res, next) => next(),
    () => (_req, _res, next) => next(),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  permissionRegistry.clear();
});

describe("admin permissions API", () => {
  it("initializes the core catalog before returning permissions", async () => {
    const response = await fetch(`${baseUrl}/api/admin/permissions`);

    expect(response.status).toBe(200);
    expect(await response.json()).toContainEqual({
      key: "metadata.view",
      description: "View record history metadata and provenance",
      module: "core",
    });
    expect(permissionRegistry.isRegistryInitialized()).toBe(true);
  });
});