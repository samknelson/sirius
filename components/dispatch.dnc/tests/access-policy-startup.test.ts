import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@shared/schema";
import { getPolicy } from "../../../shared/access-policies";
import { checkAccess, clearAccessCache, initAccessControl } from "../../../server/services/access-policy-evaluator";
import { register } from "../server/startup";

vi.mock("../server/modules/dispatch/worker-dnc", () => ({ registerWorkerDispatchDncRoutes: vi.fn() }));
vi.mock("../server/modules/dispatch/dnc-config", () => ({ dispatchDncNotificationConfigSchema: {} }));
vi.mock("../../../server/modules/system/variable-registry", () => ({ registerVariableEntry: vi.fn() }));
vi.mock("../../../server/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const user = { id: "user", email: "fixture@example.test", isActive: true } as User;
let permissions: string[], enabled: boolean;
let record = { workerId: "own-worker", employerId: "own-employer", type: "worker" };
const loadDnc = vi.fn(async () => record);
register();
beforeEach(() => {
  permissions = [];
  enabled = true;
  record = { workerId: "own-worker", employerId: "own-employer", type: "worker" };
  clearAccessCache();
  loadDnc.mockClear();
  initAccessControl({
    getUserPermissions: async () => permissions,
    hasPermission: async (_user, permission) => permissions.includes(permission),
    getUser: async () => user,
  }, {
    workerDispatchDnc: { get: loadDnc },
    contacts: { getContactByEmail: async () => ({ id: "contact", email: user.email }) },
    workers: { getWorkerByContactId: async () => ({ id: "own-worker", contactId: "contact" }) },
    employerContacts: { listByEmployer: async () => [{ contactId: "contact" }] },
  }, async () => enabled);
});

describe.each(["worker.dispatch.dnc.view", "worker.dispatch.dnc.edit"])("%s startup registration", policy => {
  it("registers through the component startup and allows staff", async () => {
    expect(getPolicy(policy)).toBeDefined();
    permissions = ["staff"];
    expect(await checkAccess(policy, user, "record")).toEqual({ granted: true, reason: expect.any(String) });
  });
  it("allows the owning worker but refuses another worker or wrong record type", async () => {
    permissions = ["worker"];
    expect((await checkAccess(policy, user, "record")).granted).toBe(true);
    expect((await checkAccess(policy, user, "record", record)).granted).toBe(true);
    expect((await checkAccess(policy, user, undefined, record)).granted).toBe(true);
    expect((await checkAccess(policy, user, "other", { ...record, workerId: "other-worker" })).granted).toBe(false);
    expect((await checkAccess(policy, user, "employer-type", { ...record, type: "employer" })).granted).toBe(false);
  });
  it("allows an associated employer only on employer-type records", async () => {
    permissions = ["employer"];
    expect((await checkAccess(policy, user, "record", { ...record, type: "employer" })).granted).toBe(true);
    expect((await checkAccess(policy, user, "worker-type", record)).granted).toBe(false);
  });
  it("refuses anonymous, unprivileged and component-off access", async () => {
    expect((await checkAccess(policy, null, "record")).granted).toBe(false);
    expect((await checkAccess(policy, user, "record")).granted).toBe(false);
    permissions = ["staff"];
    enabled = false;
    clearAccessCache();
    loadDnc.mockClear();
    expect((await checkAccess(policy, user, "record")).granted).toBe(false);
    expect(loadDnc).not.toHaveBeenCalled();
  });
});
