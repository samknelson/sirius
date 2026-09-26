import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWsTestUrl } from "../../shared/utils/ws-test-url";
import { executeWsTestHttp } from "../../server/modules/webservices/test-request-http";
import { generateCurlCommand } from "../../client/src/pages/config/ws/client-test";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";
import { installServiceRoleOwnershipGuard } from "../../server/services/service-roles";

const { port } = vi.hoisted(() => ({ port: { value: "5000" } }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (name: string) => name === "PORT" ? port.value : undefined,
}));

describe("web service test URL", () => {
  it("constructs only the local path with encoded query parameters", () => {
    expect(buildWsTestUrl("service", "run")).toBe("/api/ws/service/run");
    expect(buildWsTestUrl("service", "run", { page: "two words" }))
      .toBe("/api/ws/service/run?page=two+words");
  });

  it("refuses path traversal through service and operation names", () => {
    expect(() => buildWsTestUrl("..", "run")).toThrow("Invalid web service address");
    expect(() => buildWsTestUrl("service", ".")).toThrow("Invalid web service address");
  });

  it("copies this site's address, method, query, and credentials into cURL", () => {
    const command = generateCurlCommand({
      baseUrl: `https://this.example${buildWsTestUrl("alias", "lookup", { page: "2" })}`,
      method: "POST", path: "", queryParams: "",
      requestBody: '{"test":true}', clientKey: "client-1", clientSecret: "secret-1",
    });
    expect(command).toContain('"https://this.example/api/ws/alias/lookup?page=2"');
    expect(command).toContain('X-WS-Client-ID: client-1');
    expect(command).toContain('X-WS-Client-Secret: secret-1');
    expect(command).toContain("-d '{\"test\":true}'");
  });
});

describe("local-only test transport", () => {
  afterEach(() => { setMaintenanceActive(false); port.value = "5000"; });

  it("refuses even local test requests during maintenance before connecting", async () => {
    setMaintenanceActive(true);
    await expect(executeWsTestHttp("/api/ws/test/run", "GET", {}, undefined))
      .rejects.toThrow("Web service test is unavailable: the site is in maintenance mode");
  });

  it.each(["https://remote.example/api/ws/test/run", "//remote.example/api/ws/test/run",
    "/api/ws/../admin", "/api/admin/test"])("refuses a non-dispatcher path: %s", async (path) => {
    await expect(executeWsTestHttp(path, "GET", {}, undefined))
      .rejects.toThrow("Only local web services can be tested");
  });

  it("reaches the dispatcher on an api-user-only process without opening it to normal traffic", async () => {
    const app = express();
    installServiceRoleOwnershipGuard(app, {
      ids: ["api-user"],
      has: (role) => role === "api-user",
    });
    app.get("/api/ws/:configRef/:operation", (_req, res) => {
      res.status(401).json({ message: "Credential rejected by local dispatcher" });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      port.value = String(address.port);
      const ordinaryRequest = await fetch(`http://127.0.0.1:${port.value}/api/ws/test/inspect`);
      expect(ordinaryRequest.status).toBe(503);
      expect((await ordinaryRequest.json()).code).toBe("SERVICE_ROLE_NOT_ASSIGNED");

      const testRequest = await executeWsTestHttp("/api/ws/test/inspect", "GET", {}, undefined);
      expect(testRequest.status).toBe(401);
      expect(testRequest.data).toEqual({ message: "Credential rejected by local dispatcher" });
    } finally {
      server.close();
    }
  });

  it("calls the local dispatcher, does not follow redirects, and bounds response size", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/ws/test/inspect?page=2") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"message":"Not authorized"}');
      } else if (req.url === "/api/ws/test/redirect") {
        res.writeHead(302, { location: "http://127.0.0.1:1/metadata" });
        res.end();
      } else {
        res.end("x".repeat(1024 * 1024 + 1));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No test port");
      port.value = String(address.port);
      const denied = await executeWsTestHttp("/api/ws/test/inspect?page=2", "GET", {}, undefined);
      expect(denied.status).toBe(401);
      expect(denied.data).toEqual({ message: "Not authorized" });
      const redirected = await executeWsTestHttp("/api/ws/test/redirect", "GET", {}, undefined);
      expect(redirected.status).toBe(302);
      expect(redirected.headers.location).toBe("http://127.0.0.1:1/metadata");
      await expect(executeWsTestHttp("/api/ws/test/large", "GET", {}, undefined))
        .rejects.toThrow("Response is too large");
    } finally {
      server.close();
    }
  });
});