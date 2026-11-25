import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const f = vi.hoisted(() => ({
  settings: vi.fn(), allRoles: vi.fn(), heldRoles: vi.fn(), assign: vi.fn(), unassign: vi.fn(),
  updateIdentity: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), clearCache: vi.fn(),
  findIdentity: vi.fn(), findUser: vi.fn(), findEmail: vi.fn(), createUser: vi.fn(),
  createIdentity: vi.fn(), updateUser: vi.fn(), lastLogin: vi.fn(), lastUsed: vi.fn(),
  verify: undefined as undefined | ((...args: any[]) => void),
}));
vi.mock("../../server/storage", () => ({ storage: {
  variables: { getByName: f.settings },
  users: {
    getAllRoles: f.allRoles, getUserRoles: f.heldRoles,
    assignRoleToUser: f.assign, unassignRoleFromUser: f.unassign,
    getUser: f.findUser, getUserByEmail: f.findEmail, createUser: f.createUser,
    updateUser: f.updateUser, updateUserLastLogin: f.lastLogin,
  },
  authIdentities: {
    getByProviderAndExternalId: f.findIdentity, update: f.updateIdentity,
    updateLastUsed: f.lastUsed, create: f.createIdentity,
  },
} }));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/logger", () => ({
  storageLogger: { info: f.info, error: f.error },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ clearAccessCache: f.clearCache }));
vi.mock("../../server/services/component/cache", () => ({ isComponentEnabledSync: f.debug }));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => undefined }));
vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (key: string) => ({
    SAML_ENTRY_POINT: "https://idp.example.invalid/sso", SAML_ISSUER: "test",
    SAML_CERT: "test-cert", PUBLIC_URL: "https://app.example.invalid",
  } as Record<string, string>)[key],
}));
vi.mock("passport", () => ({
  default: { use: vi.fn(), authenticate: () => () => {} },
}));
vi.mock("@node-saml/passport-saml", () => ({
  Strategy: class {
    constructor(_options: unknown, verify: (...args: any[]) => void) { f.verify = verify; }
  },
}));

import { createProvider } from "../../server/auth/providers/saml";

const user = { id: "user-1", email: "fixture@example.invalid", isActive: true };
const identity = { id: "identity-1", userId: user.id, metadata: {} };
const role = (id: string) => ({ id, name: `${id} role` });
const profile = { nameID: "idp-subject", email: user.email, groups: ["ops", "staff"] };
const mapping = { attribute: "groups", value: "ops", roleId: "grant" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.resetAllMocks();
  f.settings.mockResolvedValue({ value: { samlRoleMappings: [mapping] } });
  f.allRoles.mockResolvedValue(["grant", "local", "managed", "old"].map(role));
  f.heldRoles.mockResolvedValue([]);
  f.findIdentity.mockResolvedValue(identity);
  f.findUser.mockResolvedValue(user);
  f.findEmail.mockResolvedValue(user);
  f.updateUser.mockResolvedValue(user);
  f.createUser.mockResolvedValue(user);
  f.createIdentity.mockResolvedValue(identity);
  f.debug.mockReturnValue(true);
});
afterEach(tick);

async function login(attributes: Record<string, unknown> = profile) {
  const provider = createProvider({ type: "saml", enabled: true });
  provider.getLoginHandler()({} as Request, {} as Response, vi.fn());
  const xml = "<Response>diagnostic fixture</Response>";
  const raw = Buffer.from(xml).toString("base64");
  const result = await new Promise<{ error: unknown; user: any }>((resolve) => {
    f.verify!({ body: { SAMLResponse: raw } }, attributes, (error: unknown, user: unknown) => resolve({ error, user }));
  });
  await tick();
  return {
    ...result, raw, xml,
    capture: f.info.mock.calls.find((args) => args[1]?.module === "saml_debug")?.[1],
  };
}

describe("SAML role mapping capture", () => {
  it("explains every rule and revocation in the existing full assertion capture", async () => {
    f.settings.mockResolvedValue({ value: { samlRoleMappings: [
      mapping,
      { ...mapping, roleId: "local", value: null },
      { attribute: "department", value: "IT", roleId: "managed" },
      { ...mapping, roleId: "unknown" },
      { ...mapping, attribute: "absent" },
      { ...mapping, attribute: "empty", value: null },
      { ...mapping, value: "wrong-case" },
    ] } });
    f.findIdentity.mockResolvedValue({ ...identity, metadata: { managedRoleIds: ["managed", "old"] } });
    f.heldRoles.mockResolvedValue(["local", "managed", "old"].map(role));
    const result = await login({ ...profile, department: "IT", empty: "" });
    expect(result.error).toBeNull();
    expect(result.user.dbUser.id).toBe(user.id);
    expect(result.capture).toMatchObject({
      samlResponseBase64: result.raw, samlResponseXml: result.xml,
      profileAttributes: { ...profile, department: "IT", empty: "" },
      matchedUserId: user.id,
      roleReconciliation: {
        outcome: "changed", identityId: identity.id,
        granted: [{ roleId: "grant", role: "grant role" }],
        revoked: [{ roleId: "old", role: "old role" }],
        managedRoleIdsAfter: ["grant", "managed"],
        rolesAfter: ["local", "managed", "grant"].map((id) => ({ roleId: id, role: `${id} role` })),
      },
    });
    const rules = result.capture.roleReconciliation.mappings;
    expect(rules.map((rule: any) => rule.result)).toEqual([
      "granted", "already_held_locally", "already_managed", "unknown_role",
      "missing_attribute", "empty_attribute", "value_mismatch",
    ]);
    expect(rules[0]).toMatchObject({ actualValue: ["ops", "staff"], expectedValue: "ops", matched: true });
    expect(f.assign).toHaveBeenCalledExactlyOnceWith({ userId: user.id, roleId: "grant" });
    expect(f.unassign).toHaveBeenCalledExactlyOnceWith(user.id, "old");
    expect(f.updateIdentity).toHaveBeenLastCalledWith(identity.id, { metadata: { managedRoleIds: ["grant", "managed"] } });
    expect(f.info.mock.calls.filter((args) => args[1]?.module === "auth" && args[1]?.operation === "role_reconcile")).toHaveLength(1);
    // Detailed assertions stay in the admin capture, not staff-visible entity logs.
    expect(result.capture.entity_id).toBeUndefined();
    expect(result.capture.host_entity_id).toBeUndefined();
  });

  it.each(["no_mappings", "no_changes"])("captures %s rather than silently skipping the explanation", async outcome => {
    if (outcome === "no_mappings") f.settings.mockResolvedValue({ value: { samlRoleMappings: [] } });
    else f.heldRoles.mockResolvedValue([role("grant")]);
    const result = await login({ ...profile, groups: "ops" });
    expect(result.capture.roleReconciliation.outcome).toBe(outcome);
    expect(f.assign).not.toHaveBeenCalled();
    expect(f.unassign).not.toHaveBeenCalled();
    expect(f.info.mock.calls.some((args) => args[1]?.operation === "role_reconcile")).toBe(false);
  });

  it("does not persist verbose diagnostics with debug disabled, but still grants roles", async () => {
    f.debug.mockReturnValue(false);
    const result = await login();
    expect(result.error).toBeNull();
    expect(result.capture).toBeUndefined();
    expect(f.assign).toHaveBeenCalledOnce();
    expect(f.info.mock.calls.some((args) => args[1]?.operation === "role_reconcile")).toBe(true);
  });

  it("still authenticates if writing the debug capture fails", async () => {
    f.info.mockImplementation((_message, details) => {
      if (details?.module === "saml_debug") throw new Error("diagnostic transport unavailable");
    });
    const result = await login();
    expect(result.error).toBeNull();
    expect(result.user.dbUser.id).toBe(user.id);
    expect(f.assign).toHaveBeenCalledOnce();
  });

  it("captures a reconciliation failure without making it a sign-in failure", async () => {
    f.assign.mockRejectedValue(new Error("role assignment unavailable"));
    const result = await login();
    expect(result.error).toBeNull();
    expect(result.capture.roleReconciliation).toMatchObject({
      outcome: "error", error: { name: "Error", message: "role assignment unavailable" },
    });
  });

  it.each(["linked-user", "new-user"])("includes the explanation on the %s path", async path => {
    f.findIdentity.mockResolvedValue(undefined);
    if (path === "new-user") {
      f.findEmail.mockResolvedValue(undefined);
      f.settings.mockResolvedValue({ value: { provisioning: { saml: "create" }, samlRoleMappings: [mapping] } });
    }
    const result = await login();
    expect(result.error).toBeNull();
    expect(result.capture.roleReconciliation.outcome).toBe("changed");
    expect(f.assign).toHaveBeenCalledOnce();
  });
});
