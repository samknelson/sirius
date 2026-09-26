import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
  deleteWorker: vi.fn(),
  getEffectiveUser: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    users: {
      userHasPermission: mocks.userHasPermission,
    },
    workers: {
      deleteWorker: mocks.deleteWorker,
    },
  },
}));

vi.mock("../server/modules/masquerade", () => ({
  getEffectiveUser: mocks.getEffectiveUser,
}));

const {
  requirePermission,
  requirePermissionOrAdmin,
} = await import("../server/middleware/require-permission");
const { registerWorkerDeleteRoute } = await import("../server/modules/workers/delete");

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app = express();
  registerWorkerDeleteRoute(
    app,
    (req, _res, next) => {
      req.user = { claims: { sub: "external-user" } } as Express.User;
      next();
    },
    requirePermissionOrAdmin,
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

describe("worker DELETE route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveUser.mockResolvedValue({ dbUser: { id: "user-1" } });
    mocks.deleteWorker.mockResolvedValue(true);
  });

  async function deleteWithPermissions(...permissions: string[]) {
    mocks.userHasPermission.mockImplementation(
      async (_userId: string, key: string) => permissions.includes(key),
    );
    return fetch(`${baseUrl}/api/workers/worker-1`, { method: "DELETE" });
  }

  it("allows a user granted worker.delete", async () => {
    const response = await deleteWithPermissions("worker.delete");

    expect(response.status).toBe(204);
    expect(mocks.userHasPermission).toHaveBeenCalledWith("user-1", "worker.delete");
    expect(mocks.deleteWorker).toHaveBeenCalledWith("worker-1");
  });

  it("allows an administrator without checking worker.delete", async () => {
    const response = await deleteWithPermissions("admin");

    expect(response.status).toBe(204);
    expect(mocks.userHasPermission).toHaveBeenCalledWith("user-1", "admin");
    expect(mocks.userHasPermission).not.toHaveBeenCalledWith("user-1", "worker.delete");
    expect(mocks.deleteWorker).toHaveBeenCalledWith("worker-1");
  });

  it("refuses staff and unrelated permissions", async () => {
    const response = await deleteWithPermissions("staff", "bookmark");

    expect(response.status).toBe(403);
    expect(mocks.deleteWorker).not.toHaveBeenCalled();
  });

  it("refuses a user with no relevant permission", async () => {
    const response = await deleteWithPermissions();

    expect(response.status).toBe(403);
    expect(mocks.deleteWorker).not.toHaveBeenCalled();
  });

  it("keeps the default middleware exact for unrelated routes", async () => {
    mocks.userHasPermission.mockImplementation(
      async (_userId: string, key: string) => key === "admin",
    );
    const req = {
      user: { claims: { sub: "external-user" } },
    } as unknown as express.Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as express.Response;
    const next = vi.fn();

    await requirePermission("staff")(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.userHasPermission).not.toHaveBeenCalledWith("user-1", "admin");
  });
});
