import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one address that reads any catalog.
 *
 * The framework decides access; this file checks that the decision survives the
 * trip through HTTP intact — that a refusal is spelled as a status a client can
 * act on, that a restricted payload is absent from the wire rather than merely
 * unrendered, and that switching a component off changes the next response.
 */

let currentUser: { id: string } | null = null;
let heldPermissions = new Set<string>();
const permissionLookups: string[] = [];

vi.mock("../../server/services/access-policy-evaluator", () => ({
  buildContext: async () => ({ user: currentUser }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    users: {
      userHasPermission: async (_userId: string, permissionKey: string) => {
        permissionLookups.push(permissionKey);
        return heldPermissions.has(permissionKey);
      },
    },
  },
}));

const {
  clearCatalogComponentSource,
  registerCatalog,
  resetCatalogRegistry,
  setCatalogComponentSource,
} = await import("@shared/catalog");
const { registerCatalogRoutes } = await import("../../server/modules/catalogs");

let baseUrl = "";
let server: http.Server;
let enabledComponents: Record<string, boolean> = {};
let revision = 0;

async function get(path: string): Promise<{ status: number; body: any; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}

function signedOut(): void {
  currentUser = null;
  heldPermissions = new Set();
}

function signedInWith(...permissions: string[]): void {
  currentUser = { id: "user-1" };
  heldPermissions = new Set(permissions);
}

function wireComponents(enabled: Record<string, boolean>): void {
  enabledComponents = enabled;
  clearCatalogComponentSource();
  revision += 1;
  const stable = revision;
  setCatalogComponentSource({
    isEnabled: (component: string) => enabledComponents[component] ?? false,
    getRevision: () => stable,
  });
}

beforeAll(async () => {
  const app = express();
  registerCatalogRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  permissionLookups.length = 0;
  resetCatalogRegistry();
  wireComponents({ widgets: true });

  registerCatalog({
    id: "greetings",
    label: "Greetings",
    description: "Things the sign-in page may say.",
    audience: "signed-out",
    entries: () => [{ id: "hello", name: "Hello" }],
  });

  registerCatalog({
    id: "member-areas",
    label: "Member Areas",
    audience: "signed-in",
    entries: () => [
      { id: "profile", name: "Profile" },
      { id: "widget", name: "Widget", component: "widgets" },
    ],
  });

  registerCatalog({
    id: "wire-formats",
    label: "Wire Formats",
    audience: "gated",
    viewPermission: "admin",
    restrictedPermission: "catalogs.internals",
    entries: () => [
      {
        id: "edi",
        name: "EDI",
        detail: { extension: ".edi" },
        restricted: { defaultEndpoint: "sftp://vendor.example" },
      },
    ],
  });
});

describe("catalog index", () => {
  it("shows a signed-out reader only what declares itself readable signed-out", async () => {
    signedOut();

    const { status, body } = await get("/api/catalogs");

    expect(status).toBe(200);
    expect(body.catalogs.map((c: any) => c.id)).toEqual(["greetings"]);
  });

  it("adds the signed-in catalogs once there is a reader, but not the gated one", async () => {
    signedInWith();

    const { body } = await get("/api/catalogs");

    expect(body.catalogs.map((c: any) => c.id)).toEqual(["greetings", "member-areas"]);
  });

  it("includes a gated catalog for a reader holding its permission", async () => {
    signedInWith("admin");

    const { body } = await get("/api/catalogs");

    expect(body.catalogs.map((c: any) => c.id)).toContain("wire-formats");
    expect(body.catalogs.find((c: any) => c.id === "wire-formats").tier).toBe("public");
  });

  it("reports the restricted tier to a reader who holds the restricted permission", async () => {
    signedInWith("admin", "catalogs.internals");

    const { body } = await get("/api/catalogs");

    expect(body.catalogs.find((c: any) => c.id === "wire-formats").tier).toBe("restricted");
  });

  it("counts what is on offer, so the count matches what the drill-in returns", async () => {
    signedInWith();
    wireComponents({ widgets: false });

    const { body } = await get("/api/catalogs");
    const summary = body.catalogs.find((c: any) => c.id === "member-areas");
    const detail = await get("/api/catalogs/member-areas");

    expect(summary.entryCount).toBe(1);
    expect(detail.body.catalog.entries).toHaveLength(1);
  });
});

describe("single catalog read", () => {
  it("refuses an unknown name rather than answering with an empty catalog", async () => {
    signedInWith("admin");

    const { status, body } = await get("/api/catalogs/no-such-catalog");

    expect(status).toBe(404);
    expect(body.message).toContain("no-such-catalog");
  });

  it("answers a signed-out reader for a catalog that declares itself signed-out", async () => {
    signedOut();

    const { status, body } = await get("/api/catalogs/greetings");

    expect(status).toBe(200);
    expect(body.catalog.entries.map((e: any) => e.id)).toEqual(["hello"]);
    expect(body.catalog.tier).toBe("public");
  });

  it("answers a signed-out reader with 401, not 403, since signing in would help", async () => {
    signedOut();

    expect((await get("/api/catalogs/member-areas")).status).toBe(401);
    expect((await get("/api/catalogs/wire-formats")).status).toBe(401);
  });

  it("answers a signed-in reader lacking the permission with 403", async () => {
    signedInWith();

    const { status } = await get("/api/catalogs/wire-formats");

    expect(status).toBe(403);
  });

  it("omits restricted detail from the wire entirely, rather than sending it hidden", async () => {
    signedInWith("admin");

    const { status, body } = await get("/api/catalogs/wire-formats");
    const wire = JSON.stringify(body);

    expect(status).toBe(200);
    expect(body.catalog.tier).toBe("public");
    expect(body.catalog.entries[0].detail).toEqual({ extension: ".edi" });
    expect(body.catalog.entries[0].restricted).toBeUndefined();
    expect(wire).not.toContain("defaultEndpoint");
    expect(wire).not.toContain("vendor.example");
  });

  it("includes restricted detail for a reader who holds the restricted permission", async () => {
    signedInWith("admin", "catalogs.internals");

    const { body } = await get("/api/catalogs/wire-formats");

    expect(body.catalog.tier).toBe("restricted");
    expect(body.catalog.entries[0].restricted).toEqual({
      defaultEndpoint: "sftp://vendor.example",
    });
  });

  it("reflects a component being switched off on the very next request", async () => {
    signedInWith();

    expect((await get("/api/catalogs/member-areas")).body.catalog.entries).toHaveLength(2);

    wireComponents({ widgets: false });
    expect(
      (await get("/api/catalogs/member-areas")).body.catalog.entries.map((e: any) => e.id),
    ).toEqual(["profile"]);

    wireComponents({ widgets: true });
    expect((await get("/api/catalogs/member-areas")).body.catalog.entries).toHaveLength(2);
  });

  it("loads only the permissions the named catalog asks about", async () => {
    signedInWith("admin");

    await get("/api/catalogs/wire-formats");

    expect(new Set(permissionLookups)).toEqual(new Set(["admin", "catalogs.internals"]));
  });

  it("marks every answer as belonging to one viewer, so nothing shared caches it", async () => {
    signedOut();

    const { headers } = await get("/api/catalogs/greetings");

    expect(headers.get("cache-control")).toBe("private, no-cache");
    expect(headers.get("vary")).toContain("Cookie");
  });
});
