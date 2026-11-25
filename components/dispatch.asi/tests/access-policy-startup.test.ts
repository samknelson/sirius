import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@shared/schema";
import { getPolicy } from "../../../shared/access-policies";
import "../../../shared/access-policies/worker/mine";
import { checkAccess, clearAccessCache, initAccessControl } from "../../../server/services/access-policy-evaluator";
import "../server/startup";

vi.mock("../server/modules/dispatch/worker-asi", () => ({ registerWorkerDispatchAsiRoutes: vi.fn() }));
vi.mock("../../../server/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const user = { id: "user", email: "fixture@example.test", isActive: true } as User;
let permissions: string[], enabled: boolean;
beforeEach(() => {
  permissions = [];
  enabled = true;
  clearAccessCache();
  initAccessControl({
    getUserPermissions: async () => permissions,
    hasPermission: async (_user, permission) => permissions.includes(permission),
    getUser: async () => user,
  }, {
    contacts: { getContactByEmail: async () => ({ id: "contact", email: user.email }) },
    workers: { getWorkerByContactId: async () => ({ id: "own-worker", contactId: "contact" }) },
  }, async component => component !== "dispatch.asi" || enabled);
});

describe("ASI startup policy registration", () => {
  it("registers its modular policy through the actual component startup", () => {
    expect(getPolicy("worker.dispatch.asi")).toBeDefined();
  });
  it.each(["staff", "worker.dispatch.asi"])("allows %s on the authorized worker", async permission => {
    permissions = [permission, "worker"];
    expect(await checkAccess("worker.dispatch.asi", user, "own-worker")).toEqual({ granted: true, reason: expect.any(String) });
  });
  it("denies another worker, missing permission, anonymous and component-off access", async () => {
    permissions = ["worker.dispatch.asi", "worker"];
    expect((await checkAccess("worker.dispatch.asi", user, "other-worker")).granted).toBe(false);
    permissions = [];
    expect((await checkAccess("worker.dispatch.asi", user, "own-worker")).granted).toBe(false);
    expect((await checkAccess("worker.dispatch.asi", null, "own-worker")).granted).toBe(false);
    permissions = ["staff"];
    enabled = false;
    clearAccessCache();
    expect((await checkAccess("worker.dispatch.asi", user, "own-worker")).granted).toBe(false);
  });
});
