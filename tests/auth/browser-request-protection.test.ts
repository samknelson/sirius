import express, { type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import multer from "multer";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserRequestProtection } from "../../server/middleware/browser-request-protection";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

const mocks = vi.hoisted(() => ({ assignPermission: vi.fn(), assignRole: vi.fn(), beforeAuth: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: { users: {
  assignPermissionToRole: mocks.assignPermission, assignRoleToUser: mocks.assignRole,
} } }));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  clearAccessCache: vi.fn(),
  requireAccess: () => (req: Request, res: Response, next: NextFunction) =>
    req.headers.cookie === "test-admin=yes" ? next() : res.sendStatus(401),
}));
vi.mock("../../server/modules/components", () => ({ requireComponent: () => (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: vi.fn() }));
vi.mock("../../server/services/clerk-provisioning", () => ({ checkClerkConflict: vi.fn(), provisionClerkAccount: vi.fn() }));
vi.mock("../../server/modules/system/timezone", () => ({ buildTimeZoneContext: vi.fn(), getTimeZonePolicy: vi.fn() }));
import { registerUserRoutes } from "../../server/modules/users";

let server: http.Server;
let base: string;
let mountedCallback = "/custom/saml/acs";
const origin = "https://app.example.test";
beforeAll(async () => {
  const app = express();
  app.use(createBrowserRequestProtection(() => mountedCallback));
  // A canary at the session/provider boundary proves refusal precedes that work.
  app.use((_req, _res, next) => { mocks.beforeAuth(); next(); });
  app.use(express.json(), express.urlencoded({ extended: false }));
  registerUserRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
  app.post("/api/auth/local/login", (_req, res) => res.sendStatus(204));
  app.all("/api/logout", (_req, res) => res.sendStatus(204));
  app.get("/api/dispatches/:id/status-options", (_req, res) => res.sendStatus(204));
  app.post("/api/files", multer().single("file"), (req, res) => res.json({ size: req.file?.size }));
  app.post("/custom/saml/acs", (_req, res) => res.status(400).json({ message: "assertion verification required" }));
  app.post("/api/comm/statuscallback/:id", (_req, res) => res.status(403).json({ message: "provider verification required" }));
  // Like the production dispatcher this independently authenticates, handles
  // exactly two segments, and terminates unknown paths without session fallback.
  app.all("/api/ws/:config/:operation", (req, res) =>
    res.sendStatus(req.get("X-WS-Client-Secret") === "test-secret" ? 204 : 401));
  app.all("*", (_req, res) => res.sendStatus(404));
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });
beforeEach(() => {
  vi.clearAllMocks();
  mountedCallback = "/custom/saml/acs";
  setEnvironmentVariableOverride("PUBLIC_URL", () => origin);
  mocks.assignPermission.mockResolvedValue({ roleId: "role", permissionKey: "admin" });
  mocks.assignRole.mockResolvedValue({ userId: "user", roleId: "role" });
});
afterEach(() => setEnvironmentVariableOverride("PUBLIC_URL", null));

const permissionPath = "/api/admin/roles/role/permissions";
function request(path = permissionPath, headers: Record<string, string> = {}, body: BodyInit = '{"permissionKey":"admin"}', method = "POST") {
  return fetch(base + path, { method, headers: {
    Cookie: "test-admin=yes", "Content-Type": "application/json", ...headers,
  }, body: ["HEAD", "GET"].includes(method) ? undefined : body });
}
function noWork() {
  expect(mocks.beforeAuth).not.toHaveBeenCalled();
  expect(mocks.assignPermission).not.toHaveBeenCalled();
  expect(mocks.assignRole).not.toHaveBeenCalled();
}

describe("browser request provenance before session or mutation work", () => {
  it.each([
    {}, { Origin: "https://attacker.test" }, { Origin: "https://sibling.example.test" },
    { Origin: "null" }, { Origin: "" }, { Origin: origin + "/" },
    { Origin: origin + "?x=1" }, { Origin: origin + "#fragment" },
    { Origin: "https://user@app.example.test" }, { Origin: "not a url" },
    { Origin: origin + ", https://attacker.test" },
    { Origin: "https://attacker.test", Referer: origin + "/config/users" },
    { Origin: "null", Referer: origin + "/" },
    { Referer: "https://attacker.test/" },
    { Referer: "https://user@app.example.test/" },
    { Origin: origin, "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Site": "same-site" },
    { Authorization: "Bearer fake" }, { Authorization: "Basic Zm9vOmJhcg==" },
    { "X-Forwarded-Host": "attacker.test", "X-Forwarded-Proto": "https", Origin: "https://attacker.test" },
  ] as Record<string, string>[])("rejects untrusted provenance: %j", async headers => {
    const response = await request(permissionPath, headers);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_ORIGIN_REFUSED");
    noWork();
  });

  it.each([
    { Origin: origin }, { Referer: origin + "/config/users?tab=roles" },
    { Origin: origin, "Sec-Fetch-Site": "same-origin" },
    { Origin: origin, "Sec-Fetch-Site": "same-site" },
    { Origin: origin, Referer: "https://attacker.test/" },
  ] as Record<string, string>[])("permits proven same-origin JSON: %j", async headers => {
    expect((await request(permissionPath, headers)).status).toBe(201);
    expect(mocks.assignPermission).toHaveBeenCalledWith({ roleId: "role", permissionKey: "admin" });
  });

  it("still requires administrator authorization after origin validation", async () => {
    expect((await request(permissionPath, { Origin: origin, Cookie: "" })).status).toBe(401);
    expect(mocks.assignPermission).not.toHaveBeenCalled();
  });

  it.each([permissionPath, "/api/admin/users/user/roles"])("blocks forged form writes: %s", async path => {
    expect((await request(path, { Origin: "https://attacker.test", "Content-Type": "application/x-www-form-urlencoded" },
      "permissionKey=admin&roleId=role")).status).toBe(403);
    noWork();
  });

  it("permits same-origin role assignment and re-reads canonical PUBLIC_URL", async () => {
    expect((await request("/api/admin/users/user/roles", { Origin: origin }, '{"roleId":"role"}')).status).toBe(201);
    setEnvironmentVariableOverride("PUBLIC_URL", () => "https://changed.example.test");
    expect((await request(permissionPath, { Origin: origin })).status).toBe(403);
    expect((await request(permissionPath, { Origin: "https://changed.example.test" })).status).toBe(201);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("covers unsafe method %s, even without a session", async method => {
    expect((await request("/api/unknown", { Cookie: "" }, undefined, method)).status).toBe(403);
    noWork();
  });

  it.each(["/api/logout", "/api/dispatches/dispatch/status-options"])("protects stateful GET and HEAD: %s", async path => {
    for (const method of ["GET", "HEAD"]) {
      expect((await request(path, {}, undefined, method)).status).toBe(403);
      noWork();
      expect((await request(path, { Referer: origin + "/" }, undefined, method)).status).toBe(204);
      mocks.beforeAuth.mockClear();
    }
  });

  it("allows ordinary read requests without provenance", async () => {
    expect((await request("/api/unknown", {}, undefined, "GET")).status).toBe(404);
    expect(mocks.beforeAuth).toHaveBeenCalledOnce();
  });
});

describe("request body contracts", () => {
  it.each(["application/x-www-form-urlencoded", "text/plain", "multipart/form-data; boundary=test", "application/xml"])(
    "rejects non-JSON bodies on a JSON API: %s", async contentType => {
      expect((await request(permissionPath, { Origin: origin, "Content-Type": contentType }, "permissionKey=admin")).status).toBe(415);
      noWork();
    });

  it("does not require a content type on bodyless actions", async () => {
    expect((await fetch(base + "/api/logout", { method: "POST", headers: { Origin: origin } })).status).toBe(204);
  });

  it("allows multipart uploads only with proven same-origin provenance", async () => {
    const form = new FormData();
    form.set("file", new Blob(["example"]), "example.txt");
    expect((await fetch(base + "/api/files", { method: "POST", body: form })).status).toBe(403);
    noWork();
    const response = await fetch(base + "/api/files", { method: "POST", headers: { Origin: origin }, body: form });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ size: 7 });
  });

  it("protects local login even before a session exists", async () => {
    expect((await request("/api/auth/local/login", { Cookie: "" })).status).toBe(403);
    noWork();
    expect((await request("/api/auth/local/login", { Cookie: "", Origin: origin })).status).toBe(204);
  });
});

describe("narrow independent protocol exceptions", () => {
  it("lets the actual configured SAML POST reach assertion verification, including Express case/slash matching", async () => {
    expect((await request("/CUSTOM/SAML/ACS/", { Origin: "https://idp.test", "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/x-www-form-urlencoded" }, "SAMLResponse=invalid")).status).toBe(400);
    expect(mocks.beforeAuth).toHaveBeenCalledOnce();
  });

  it("does not exempt the default SAML URL when a different route is mounted, siblings, or other methods", async () => {
    for (const [path, method] of [["/api/auth/saml/callback", "POST"], ["/custom/saml/acs/other", "POST"],
      ["/custom/saml/acs", "PUT"]]) {
      expect((await request(path, {}, undefined, method)).status).toBe(403);
      noWork();
    }
  });

  it("leaves callback authentication in control, not the administrator cookie", async () => {
    expect((await request("/api/comm/statuscallback/id", { Origin: "https://vendor.test",
      "Content-Type": "application/x-www-form-urlencoded" }, "status=delivered")).status).toBe(403);
    expect(mocks.beforeAuth).toHaveBeenCalledOnce();
  });

  it("requires independent WS credentials even when the browser has an admin session", async () => {
    expect((await request("/api/ws/config/op")).status).toBe(401);
    expect((await request("/api/ws/config/op", { Cookie: "", "X-WS-Client-Secret": "test-secret" })).status).toBe(204);
    expect(mocks.assignPermission).not.toHaveBeenCalled();
  });

  it.each(["/api/ws", "/api/ws/config/op/extra", "/api/ws-admin/config/op", "/api/comm/statuscallback/id/extra"])(
    "does not exempt neighbouring or malformed paths: %s", async path => {
      expect((await request(path)).status).toBe(403);
      noWork();
    });
});
