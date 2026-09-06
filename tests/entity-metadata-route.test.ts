import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { getMetadata, listMetadata } = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  listMetadata: vi.fn(),
}));

vi.mock("../server/storage/system/entity-metadata", () => ({
  isRecordId: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  entityMetadataStorage: { get: getMetadata },
}));

vi.mock("../server/storage", () => ({
  storage: {
    entityMetadataAdmin: {
      listPeople: vi.fn(),
      list: listMetadata,
      getTableCounts: vi.fn(),
      backfill: vi.fn(),
    },
  },
}));

vi.mock("../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { registerEntityMetadataRoutes } = await import("../server/modules/entity-metadata");

const RECORD_ID = "11111111-1111-4111-8111-111111111111";

let baseUrl = "";
let server: http.Server;
const requestedPermissions: string[] = [];

beforeAll(async () => {
  const app = express();
  registerEntityMetadataRoutes(
    app,
    (_req, _res, next) => next(),
    (permissionKey) => {
      requestedPermissions.push(permissionKey);
      return (req, res, next): void => {
        if (req.header("x-test-deny-permission") === permissionKey) {
          res.status(403).json({ message: `Missing permission: ${permissionKey}` });
          return;
        }
        next();
      };
    },
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
  getMetadata.mockReset().mockResolvedValue(null);
  listMetadata.mockReset();
});

describe("per-record metadata access", () => {
  it("registers and enforces metadata.view", async () => {
    const denied = await fetch(`${baseUrl}/api/entity-metadata/${RECORD_ID}`, {
      headers: { "x-test-deny-permission": "metadata.view" },
    });

    expect(requestedPermissions).toContain("metadata.view");
    expect(denied.status).toBe(403);
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("returns metadata to a user with metadata.view", async () => {
    const metadata = {
      seq: 17,
      rev: 2,
      contextId: "workers",
      entityId: RECORD_ID,
      created: { date: null, personName: null },
      modified: { date: null, personName: null },
      subrecordModified: { date: null, personName: null },
    };
    getMetadata.mockResolvedValue(metadata);

    const response = await fetch(`${baseUrl}/api/entity-metadata/${RECORD_ID}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ metadata });
    expect(getMetadata).toHaveBeenCalledWith(RECORD_ID);
  });
});


describe("admin record history links", () => {
  it("returns a universal encoded Go to record URL for every history row", async () => {
    listMetadata.mockResolvedValue({
      data: [
        {
          seq: 17,
          contextId: "contact_phone",
          entityId: "record/with spaces",
          created: { date: null, personName: null },
          modified: { date: null, personName: null },
          subrecordModified: { date: null, personName: null },
        },
        {
          seq: 18,
          contextId: "workers",
          entityId: "22222222-2222-4222-8222-222222222222",
          created: { date: null, personName: null },
          modified: { date: null, personName: null },
          subrecordModified: { date: null, personName: null },
        },
      ],
      total: 2,
      page: 0,
      limit: 50,
    });

    const response = await fetch(`${baseUrl}/api/admin/entity-metadata/list`);

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([
      expect.objectContaining({
        contextLabel: "Phone Numbers",
        href: "/go/record%2Fwith%20spaces",
      }),
      expect.objectContaining({
        contextLabel: "Workers",
        href: "/go/22222222-2222-4222-8222-222222222222",
      }),
    ]);
  });
});