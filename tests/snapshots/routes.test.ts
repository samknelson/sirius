import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listByEntity: vi.fn(),
  get: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    snapshots: {
      listByEntity: mocks.listByEntity,
      get: mocks.get,
    },
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../server/services/component-cache", () => ({
  isComponentEnabledSync: () => true,
}));

vi.mock("../../server/modules/edls/snapshot-decode", () => ({
  decodeEdlsSheetSnapshot: vi.fn(() => ({ sheet: {}, crews: [], assignments: [] })),
}));

const { registerSnapshotsRoutes } = await import("../../server/modules/snapshots");

const SNAPSHOT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHEET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  const app = express();
  registerSnapshotsRoutes(app, (_req: Request, _res: Response, next: NextFunction) => next());
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
  mocks.listByEntity.mockReset();
  mocks.get.mockReset();
});

describe("snapshot revision metadata responses", () => {
  it("includes only the captured revision in the existing list response", async () => {
    mocks.listByEntity.mockResolvedValue([
      {
        id: SNAPSHOT_ID,
        entityType: "edls_sheet",
        entityId: SHEET_ID,
        revision: { seq: 1810, rev: 3 },
        capturedAt: null,
        capturedByName: null,
        label: "status: draft → lock",
      },
    ]);

    const response = await fetch(`${baseUrl}/api/snapshots/edls_sheet/${SHEET_ID}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: SNAPSHOT_ID,
        revision: { seq: 1810, rev: 3 },
      }),
    ]);
  });

  it("returns null revision metadata for an older bundle on the existing detail route", async () => {
    mocks.get.mockResolvedValue({
      id: SNAPSHOT_ID,
      entityType: "edls_sheet",
      entityId: SHEET_ID,
      data: { version: 1, data: {} },
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
      capturedByName: "Editor",
      label: null,
    });

    const response = await fetch(
      `${baseUrl}/api/snapshots/edls_sheet/${SHEET_ID}/${SNAPSHOT_ID}`,
    );

    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBeNull();
  });
});