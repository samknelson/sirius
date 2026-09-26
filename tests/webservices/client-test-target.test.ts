import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWsTestUrl, normalizeWsTestBase } from "../../shared/utils/ws-test-url";
import {
  executeWsTestHttp,
  isSafeRemoteAddress,
  resolveRemoteTarget,
} from "../../server/modules/webservices/test-request-http";
import { generateCurlCommand } from "../../client/src/pages/config/ws/client-test";
import { setMaintenanceActive } from "../../server/services/maintenance-flag";

describe("web service test URL", () => {
  it("keeps the relative default but resolves it for a copied terminal command", () => {
    expect(buildWsTestUrl("/api/ws/", "service", "run")).toBe("/api/ws/service/run");
    expect(buildWsTestUrl("/api/ws/", "service", "run", { page: "two words" }, "https://this.example"))
      .toBe("https://this.example/api/ws/service/run?page=two+words");
  });

  it("accepts another origin or an alternate gateway path without duplicating /api/ws/", () => {
    expect(buildWsTestUrl("https://remote.example", "alias", "lookup"))
      .toBe("https://remote.example/api/ws/alias/lookup");
    expect(buildWsTestUrl("https://remote.example/gateway/ws/", "alias", "lookup"))
      .toBe("https://remote.example/gateway/ws/alias/lookup");
    expect(buildWsTestUrl("https://remote.example/api/ws/", "name with space", "lookup"))
      .toBe("https://remote.example/api/ws/name%20with%20space/lookup");
  });

  it("copies the same alternate target, method, query, and credentials into cURL", () => {
    const command = generateCurlCommand({
      baseUrl: buildWsTestUrl("https://remote.example/gateway/ws/", "alias", "lookup", { page: "2" }),
      method: "POST", path: "", queryParams: "",
      requestBody: '{"test":true}', clientKey: "client-1", clientSecret: "secret-1",
    });
    expect(command).toContain('"https://remote.example/gateway/ws/alias/lookup?page=2"');
    expect(command).toContain('X-WS-Client-ID: client-1');
    expect(command).toContain('X-WS-Client-Secret: secret-1');
    expect(command).toContain("-d '{\"test\":true}'");
  });

  it.each([
    "http://user:password@example.com",
    "https://example.com/path?token=secret",
    "https://example.com/#fragment",
    "file:///tmp/data",
    "//example.com/api/ws/",
    "/admin/",
  ])("refuses unsupported base URLs: %s", (base) => {
    expect(() => normalizeWsTestBase(base)).toThrow();
  });
});

describe("outbound target guard", () => {
  afterEach(() => setMaintenanceActive(false));

  it("refuses even local test requests during maintenance before connecting", async () => {
    setMaintenanceActive(true);
    await expect(executeWsTestHttp("http://127.0.0.1:1/api/ws/test/run", "GET", {}, undefined, true))
      .rejects.toThrow("Web service test is unavailable: the site is in maintenance mode");
  });

  it.each(["127.0.0.1", "10.2.3.4", "169.254.169.254", "192.168.1.1",
    "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"])(
    "blocks private and metadata address %s", (address) => {
      expect(isSafeRemoteAddress(address)).toBe(false);
    },
  );

  it("refuses any host that resolves to even one private address", async () => {
    const resolver = vi.fn(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolveRemoteTarget(new URL("https://remote.example/api/ws/"), resolver as any))
      .rejects.toThrow("Private or local targets");
    expect(resolver).toHaveBeenCalledOnce();
    await expect(resolveRemoteTarget(new URL("https://127.0.0.1/api/ws/"), resolver as any))
      .rejects.toThrow("Private or local targets");
    expect(resolver).toHaveBeenCalledOnce();
  });

  it("does not follow a redirect to another host and bounds response size", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/redirect") {
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
      const base = `http://127.0.0.1:${address.port}`;
      const redirected = await executeWsTestHttp(`${base}/redirect`, "GET", {}, undefined, true);
      expect(redirected.status).toBe(302);
      expect(redirected.headers.location).toBe("http://127.0.0.1:1/metadata");
      await expect(executeWsTestHttp(`${base}/large`, "GET", {}, undefined, true))
        .rejects.toThrow("Response is too large");
    } finally {
      server.close();
    }
  });
});