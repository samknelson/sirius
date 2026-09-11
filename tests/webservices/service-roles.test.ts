import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearCatalogComponentSource,
  readCatalog,
  resetCatalogRegistry,
  setCatalogComponentSource,
} from "@shared/catalog";
import { getRawProcessEnv, isEnvironmentVariableRegistered } from "../../server/config/env-registry";
import { registerSystemServiceRolesCatalog } from "../../server/modules/system-service-roles-catalog";
import { bootStatus } from "../../server/services/boot-status";
import {
  bootStatusGate,
  registerBootStatusRoutes,
} from "../../server/services/boot-status-http";
import {
  classifyRequestTraffic,
  installServiceRoleOwnershipGuard,
  resolveServiceRoles,
} from "../../server/services/service-roles";

const env = getRawProcessEnv();
const originalServiceRole = env.SERVICE_ROLE;

afterEach(() => {
  if (originalServiceRole === undefined) delete env.SERVICE_ROLE;
  else env.SERVICE_ROLE = originalServiceRole;
  resetCatalogRegistry();
  clearCatalogComponentSource();
});

function withServiceRole(value: string | undefined) {
  if (value === undefined) delete env.SERVICE_ROLE;
  else env.SERVICE_ROLE = value;
  return resolveServiceRoles();
}

async function listen(app: express.Express): Promise<{
  origin: string;
  close(): Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("service roles", () => {
  it("is registered and defaults to all catalog-declared roles", () => {
    expect(isEnvironmentVariableRegistered("SERVICE_ROLE")).toBe(true);
    expect(withServiceRole(undefined).ids).toEqual(["static", "api-ws", "api-user"]);
  });

  it("trims additive role values and rejects malformed configuration", () => {
    expect(withServiceRole(" static, api-ws ").ids).toEqual(["static", "api-ws"]);
    expect(() => withServiceRole("static,,api-ws")).toThrow(/member 2 is empty/);
    expect(() => withServiceRole("static,static")).toThrow(/duplicate role/i);
    expect(() => withServiceRole("static,unknown")).toThrow(/not a recognized role/);
  });

  it("classifies the web-service path by segment rather than textual prefix", () => {
    expect(classifyRequestTraffic("/api/ws")).toBe("api-ws");
    expect(classifyRequestTraffic("/api/ws/ping/ping")).toBe("api-ws");
    expect(classifyRequestTraffic("/api/wsfoo")).toBe("api-user");
    expect(classifyRequestTraffic("/api")).toBe("api-user");
    expect(classifyRequestTraffic("/dispatch/jobs")).toBe("static");
  });

  it("publishes the same role declaration through the catalog framework", () => {
    setCatalogComponentSource({
      isEnabled: () => true,
      getRevision: () => 1,
    });
    registerSystemServiceRolesCatalog();
    const result = readCatalog("system-service-roles", {
      authenticated: true,
      hasPermission: () => false,
    });

    expect(result.ok && result.catalog.entries).toEqual([
      expect.objectContaining({ id: "static", detail: { routeScope: "Every request outside /api." } }),
      expect.objectContaining({ id: "api-ws", detail: { routeScope: "/api/ws and its descendants only." } }),
      expect.objectContaining({
        id: "api-user",
        detail: { routeScope: "Every /api request other than /api/ws and its descendants." },
      }),
    ]);
  });

  it("returns a JSON ownership refusal before a static fallback can claim another role", async () => {
    const app = express();
    installServiceRoleOwnershipGuard(app, withServiceRole("static"));
    app.use("*", (_req, res) => res.type("html").send("<html>SPA</html>"));
    const server = await listen(app);
    try {
      const refused = await fetch(`${server.origin}/api/ws/ping/ping`);
      expect(refused.status).toBe(503);
      expect(refused.headers.get("content-type")).toContain("application/json");
      await expect(refused.json()).resolves.toMatchObject({
        code: "SERVICE_ROLE_NOT_ASSIGNED",
        requiredRole: "api-ws",
      });

      const served = await fetch(`${server.origin}/dashboard`);
      expect(served.status).toBe(200);
      expect(await served.text()).toContain("SPA");
    } finally {
      await server.close();
    }
  });

  it("exposes web-service boot status as JSON only on the web-service role", async () => {
    const originalPhase = bootStatus.phase;
    const app = express();
    const roles = withServiceRole("api-ws");
    registerBootStatusRoutes(app, roles);
    installServiceRoleOwnershipGuard(app, roles);
    app.use((req, res, next) => bootStatusGate(req, res, next, roles.ids));
    const server = await listen(app);
    try {
      const status = await fetch(`${server.origin}/api/ws/boot-status`, {
        headers: { accept: "text/html" },
      });
      expect(status.status).toBe(200);
      expect(status.headers.get("content-type")).toContain("application/json");
      await expect(status.json()).resolves.toMatchObject({
        serviceRoles: ["api-ws"],
        path: "/api/ws/boot-status",
      });

      const wrongRoleDuringBoot = await fetch(`${server.origin}/api/boot-status`);
      expect(wrongRoleDuringBoot.status).toBe(503);
      await expect(wrongRoleDuringBoot.json()).resolves.toMatchObject({
        code: "SERVICE_ROLE_NOT_ASSIGNED",
        requiredRole: "api-user",
      });

      bootStatus.phase = "ready";
      const refused = await fetch(`${server.origin}/api/boot-status`);
      expect(refused.status).toBe(503);
      await expect(refused.json()).resolves.toMatchObject({
        code: "SERVICE_ROLE_NOT_ASSIGNED",
        requiredRole: "api-user",
      });
    } finally {
      bootStatus.phase = originalPhase;
      await server.close();
    }
  });
});