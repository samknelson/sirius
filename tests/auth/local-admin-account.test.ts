/**
 * The break-glass admin account built from LOCAL_AUTH_EMAIL /
 * LOCAL_AUTH_PASSWORD_HASH.
 *
 * This is the only way back into a deployment whose database already has users
 * (so the interactive first-run screen refuses) and whose operator has neither
 * a shell nor database access. It cannot be exercised by hand on the
 * deployment it exists for, and every one of its failure modes is silent by
 * nature, so the four guarantees, their idempotence, and the three refusals
 * are pinned here.
 *
 * The storage layer and the environment are faked so the reconciler's own
 * decisions are what is under test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  interface FakeUser {
    id: string;
    email: string;
    isActive: boolean;
    accountStatus: string;
  }
  interface FakeRole {
    id: string;
    name: string;
    description: string | null;
  }
  interface FakeIdentity {
    id: string;
    userId: string;
    providerType: string;
    externalId: string;
    email: string;
    passwordHash: string | null;
  }

  const env: Record<string, string | undefined> = {};
  const audit: { message: string; meta: unknown }[] = [];
  const state = {
    users: [] as FakeUser[],
    roles: [] as FakeRole[],
    rolePermissions: new Map<string, Set<string>>(),
    userRoles: new Set<string>(),
    identities: [] as FakeIdentity[],
    writes: 0,
    seq: 0,
  };
  const allPermissionKeys = ["admin", "staff", "users.view", "masquerade"];

  const id = (prefix: string) => `${prefix}-${++state.seq}`;
  const write = <T>(value: T): T => {
    state.writes++;
    return value;
  };

  const storage = {
    users: {
      async getUserByEmail(email: string) {
        return state.users.find(
          (u) => u.email.toLowerCase() === email.toLowerCase(),
        );
      },
      async createUser(data: { email: string; isActive?: boolean; accountStatus?: string }) {
        if (
          state.users.some(
            (u) => u.email.toLowerCase() === data.email.toLowerCase(),
          )
        ) {
          const err: any = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          throw err;
        }
        const user: FakeUser = {
          id: id("user"),
          email: data.email,
          isActive: data.isActive ?? true,
          accountStatus: data.accountStatus ?? "pending",
        };
        state.users.push(user);
        return write(user);
      },
      async updateUser(userId: string, patch: Partial<FakeUser>) {
        const user = state.users.find((u) => u.id === userId);
        if (!user) return undefined;
        Object.assign(user, patch);
        return write(user);
      },
      async getUserRoles(userId: string) {
        return state.roles.filter((r) => state.userRoles.has(`${userId}:${r.id}`));
      },
      async getRolePermissions(roleId: string) {
        return Array.from(state.rolePermissions.get(roleId) ?? []).map((key) => ({
          key,
        }));
      },
      async getRolesWithPermission(key: string) {
        return state.roles.filter((r) => state.rolePermissions.get(r.id)?.has(key));
      },
      async getAllRoles() {
        return [...state.roles];
      },
      async createRole(data: { name: string; description?: string }) {
        if (state.roles.some((r) => r.name === data.name)) {
          const err: any = new Error("duplicate role name");
          err.code = "23505";
          throw err;
        }
        const role: FakeRole = {
          id: id("role"),
          name: data.name,
          description: data.description ?? null,
        };
        state.roles.push(role);
        state.rolePermissions.set(role.id, new Set());
        return write(role);
      },
      async getAllPermissions() {
        return allPermissionKeys.map((key) => ({ key }));
      },
      async assignPermissionsToRoleBulk(roleId: string, keys: string[]) {
        const set = state.rolePermissions.get(roleId) ?? new Set<string>();
        const added = keys.filter((k) => !set.has(k));
        for (const k of added) set.add(k);
        state.rolePermissions.set(roleId, set);
        return added.length > 0 ? write(added) : added;
      },
      async assignRoleToUser({ userId, roleId }: { userId: string; roleId: string }) {
        state.userRoles.add(`${userId}:${roleId}`);
        return write({ userId, roleId });
      },
    },
    authIdentities: {
      async getByProviderAndExternalId(providerType: string, externalId: string) {
        return state.identities.find(
          (i) => i.providerType === providerType && i.externalId === externalId,
        );
      },
      async getByUserIdAndProvider(userId: string, providerType: string) {
        return state.identities.find(
          (i) => i.userId === userId && i.providerType === providerType,
        );
      },
      async upsertLocalPasswordHash(
        userId: string,
        email: string,
        passwordHash: string,
      ) {
        const externalId = email.trim().toLowerCase();
        const existing = state.identities.find(
          (i) => i.userId === userId && i.providerType === "local",
        );
        if (existing) {
          existing.passwordHash = passwordHash;
          existing.externalId = externalId;
          existing.email = externalId;
          return write(existing);
        }
        const created: FakeIdentity = {
          id: id("identity"),
          userId,
          providerType: "local",
          externalId,
          email: externalId,
          passwordHash,
        };
        state.identities.push(created);
        return write(created);
      },
    },
  };

  return { env, state, storage, allPermissionKeys, audit };
});

vi.mock("../../server/logger", () => ({
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  storageLogger: {
    info(message: string, meta: unknown) {
      h.audit.push({ message, meta });
    },
    warn() {},
    error() {},
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  clearAccessCache: () => {},
}));

vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: (name: string) => h.env[name],
}));

vi.mock("../../server/storage", () => ({ storage: h.storage }));

import { ensureLocalAdminAccount } from "../../server/auth/local-seed";

const EMAIL = "operator@example.com";
const HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBB3sO8HH0mZ0F0dGxTZBoUmqK3O9K";
const OTHER_HASH = "$2b$12$b9VELS38qdbkZWeUXSq8X.GOaFCdfxV1X.nbTuVzjqrOFVNNkUG.a";

let consoleOutput: string[] = [];

function configure(overrides: Record<string, string | undefined> = {}) {
  for (const key of Object.keys(h.env)) delete h.env[key];
  Object.assign(
    h.env,
    {
      AUTH_PROVIDER: "local",
      LOCAL_AUTH_EMAIL: EMAIL,
      LOCAL_AUTH_PASSWORD_HASH: HASH,
    },
    overrides,
  );
}

function permissionsOf(userId: string): Set<string> {
  const keys = new Set<string>();
  for (const role of h.state.roles) {
    if (!h.state.userRoles.has(`${userId}:${role.id}`)) continue;
    for (const key of h.state.rolePermissions.get(role.id) ?? []) keys.add(key);
  }
  return keys;
}

function localIdentity(userId: string) {
  return h.state.identities.find(
    (i) => i.userId === userId && i.providerType === "local",
  );
}

beforeEach(() => {
  h.state.users = [];
  h.state.roles = [];
  h.state.rolePermissions = new Map();
  h.state.userRoles = new Set();
  h.state.identities = [];
  h.state.writes = 0;
  h.state.seq = 0;
  configure();

  consoleOutput = [];
  h.audit.length = 0;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(" "));
  });
});

describe("unconfigured", () => {
  it("does nothing and says nothing when either variable is missing", async () => {
    configure({ LOCAL_AUTH_PASSWORD_HASH: undefined });
    const report = await ensureLocalAdminAccount();

    expect(report.ran).toBe(false);
    expect(h.state.writes).toBe(0);
    expect(h.state.users).toHaveLength(0);
    expect(consoleOutput).toHaveLength(0);
  });
});

describe("the four guarantees", () => {
  it("creates the account on an empty database", async () => {
    const report = await ensureLocalAdminAccount();

    expect(report.refusal).toBeNull();
    expect(report.failure).toBeNull();
    expect(report.guarantees.account).toBe("created");

    const user = h.state.users[0];
    expect(user.email).toBe(EMAIL);
    expect(user.isActive).toBe(true);
    expect(permissionsOf(user.id).has("admin")).toBe(true);
    expect(localIdentity(user.id)?.passwordHash).toBe(HASH);
    expect(localIdentity(user.id)?.externalId).toBe(EMAIL);
  });

  it("creates the account on a half-initialized database that already has users", async () => {
    await h.storage.users.createUser({ email: "someone.else@example.com" });
    h.state.writes = 0;

    const report = await ensureLocalAdminAccount();

    expect(report.guarantees.account).toBe("created");
    const user = h.state.users.find((u) => u.email === EMAIL)!;
    expect(user).toBeDefined();
    expect(permissionsOf(user.id).has("admin")).toBe(true);
  });

  it("the role it creates holds every registered permission, like the first-run screen", async () => {
    await ensureLocalAdminAccount();

    const role = h.state.roles[0];
    expect(role.name).toBe("admin");
    expect(Array.from(h.state.rolePermissions.get(role.id) ?? []).sort()).toEqual(
      [...h.allPermissionKeys].sort(),
    );
  });

  it("lowercases the email so it matches the login identifier", async () => {
    configure({ LOCAL_AUTH_EMAIL: "  Operator@Example.COM  " });
    await ensureLocalAdminAccount();

    expect(h.state.users[0].email).toBe(EMAIL);
    expect(h.state.identities[0].externalId).toBe(EMAIL);
  });

  it("attaches to an existing user rather than creating a second one", async () => {
    const existing = await h.storage.users.createUser({ email: EMAIL.toUpperCase() });

    const report = await ensureLocalAdminAccount();

    expect(report.guarantees.account).toBe("already-correct");
    expect(h.state.users).toHaveLength(1);
    expect(report.userId).toBe(existing.id);
  });
});

describe("repairs, one at a time", () => {
  async function provision() {
    await ensureLocalAdminAccount();
    const user = h.state.users.find((u) => u.email === EMAIL)!;
    h.state.writes = 0;
    consoleOutput = [];
    return user;
  }

  it("a second boot with everything correct writes nothing and stays quiet", async () => {
    await provision();

    const report = await ensureLocalAdminAccount();

    expect(h.state.writes).toBe(0);
    expect(consoleOutput).toHaveLength(0);
    expect(report.guarantees).toEqual({
      account: "already-correct",
      active: "already-correct",
      admin: "already-correct",
      password: "already-correct",
    });
  });

  it("reactivates a disabled account and repairs nothing else", async () => {
    const user = await provision();
    user.isActive = false;
    h.state.writes = 0;

    const report = await ensureLocalAdminAccount();

    expect(report.guarantees.active).toBe("repaired");
    expect(report.guarantees.admin).toBe("already-correct");
    expect(report.guarantees.password).toBe("already-correct");
    expect(h.state.users.find((u) => u.id === user.id)!.isActive).toBe(true);
  });

  it("re-grants admin by reusing an existing admin-granting role", async () => {
    const user = await provision();
    const role = h.state.roles[0];
    h.state.userRoles.delete(`${user.id}:${role.id}`);
    h.state.writes = 0;

    const report = await ensureLocalAdminAccount();

    expect(report.guarantees.admin).toBe("repaired");
    expect(h.state.roles).toHaveLength(1);
    expect(permissionsOf(user.id).has("admin")).toBe(true);
  });

  it("takes a reserved role name rather than rewriting a foreign role called admin", async () => {
    const impostor = await h.storage.users.createRole({ name: "admin" });
    await h.storage.users.assignPermissionsToRoleBulk(impostor.id, ["users.view"]);

    await ensureLocalAdminAccount();

    expect(h.state.rolePermissions.get(impostor.id)!.has("admin")).toBe(false);
    const created = h.state.roles.find((r) => r.name === "break-glass-admin");
    expect(created).toBeDefined();
    const user = h.state.users.find((u) => u.email === EMAIL)!;
    expect(permissionsOf(user.id).has("admin")).toBe(true);
  });

  it("applies a changed hash", async () => {
    const user = await provision();
    configure({ LOCAL_AUTH_PASSWORD_HASH: OTHER_HASH });

    const report = await ensureLocalAdminAccount();

    expect(report.guarantees.password).toBe("repaired");
    expect(localIdentity(user.id)!.passwordHash).toBe(OTHER_HASH);
  });

  it("leaves a provisioned account untouched once the variables are removed", async () => {
    const user = await provision();
    configure({ LOCAL_AUTH_EMAIL: undefined, LOCAL_AUTH_PASSWORD_HASH: undefined });

    await ensureLocalAdminAccount();

    expect(h.state.writes).toBe(0);
    expect(localIdentity(user.id)!.passwordHash).toBe(HASH);
    expect(permissionsOf(user.id).has("admin")).toBe(true);
  });
});

describe("refusals", () => {
  it("refuses when local is not listed in AUTH_PROVIDER", async () => {
    configure({ AUTH_PROVIDER: "saml,replit" });

    const report = await ensureLocalAdminAccount();

    expect(report.refusal?.reason).toMatch(/local auth provider is not enabled/);
    expect(report.refusal?.fix).toMatch(/AUTH_PROVIDER/);
    expect(h.state.writes).toBe(0);
    expect(h.state.users).toHaveLength(0);
  });

  it("refuses when the provider is switched off with AUTH_LOCAL_ENABLED=false", async () => {
    configure({ AUTH_LOCAL_ENABLED: "false" });

    const report = await ensureLocalAdminAccount();

    expect(report.refusal).not.toBeNull();
    expect(h.state.writes).toBe(0);
  });

  it.each([
    ["free text", "spaghetti"],
    ["truncated mid-digest", HASH.slice(0, 40)],
    ["prefix only", "$2b$12$"],
    ["an impossible cost", "$2b$99$" + HASH.slice(7)],
    ["a stray trailing character", HASH + "x"],
    ["a shell-expanded hash", "12$C6UzMDM.H6dfI/f/IKcEeO"],
  ])("refuses a hash that is %s", async (_label, value) => {
    configure({ LOCAL_AUTH_PASSWORD_HASH: value });

    const report = await ensureLocalAdminAccount();

    expect(report.refusal?.reason).toMatch(/not a complete bcrypt hash/);
    expect(report.refusal?.fix).toMatch(/generate-password-hash/);
    expect(h.state.writes).toBe(0);
    expect(h.state.users).toHaveLength(0);
  });

  it("refuses when a local credential for that email belongs to another user", async () => {
    const other = await h.storage.users.createUser({ email: "other@example.com" });
    await h.storage.authIdentities.upsertLocalPasswordHash(other.id, EMAIL, OTHER_HASH);
    h.state.writes = 0;

    const report = await ensureLocalAdminAccount();

    expect(report.refusal?.reason).toMatch(/belongs to a different user/);
    // Refused BEFORE anything was written: no account was created for the
    // configured email, nothing was escalated, and every guarantee is
    // untouched — otherwise the report's "nothing was written" is a lie.
    expect(h.state.writes).toBe(0);
    expect(h.state.users.map((u) => u.email)).toEqual(["other@example.com"]);
    expect(h.state.roles).toHaveLength(0);
    expect(report.guarantees).toEqual({
      account: "not-reached",
      active: "not-reached",
      admin: "not-reached",
      password: "not-reached",
    });
    expect(localIdentity(other.id)!.passwordHash).toBe(OTHER_HASH);
    expect(consoleOutput.join("\n")).toContain("Nothing was written");
  });

  it("does not escalate an existing account it then refuses to credential", async () => {
    // The configured email has a user AND a local credential owned by someone
    // else — the account must not be reactivated or made an admin on the way
    // to the refusal.
    const target = await h.storage.users.createUser({ email: EMAIL });
    target.isActive = false;
    const other = await h.storage.users.createUser({ email: "other@example.com" });
    other.id = target.id === other.id ? other.id : other.id;
    h.state.identities.push({
      id: "identity-foreign",
      userId: other.id,
      providerType: "local",
      externalId: EMAIL,
      email: EMAIL,
      passwordHash: OTHER_HASH,
    } as any);
    h.state.writes = 0;

    const report = await ensureLocalAdminAccount();

    expect(report.refusal).not.toBeNull();
    expect(h.state.writes).toBe(0);
    expect(h.state.users.find((u) => u.email === EMAIL)!.isActive).toBe(false);
    expect(permissionsOf(target.id).has("admin")).toBe(false);
  });

  it("reports a refusal on the console so a shell-less operator can see it", async () => {
    configure({ AUTH_PROVIDER: "saml" });
    await ensureLocalAdminAccount();

    const printed = consoleOutput.join("\n");
    expect(printed).toContain("LOCAL ADMIN ACCOUNT");
    expect(printed).toContain("REFUSED");
    expect(printed).toContain("Nothing was written");
  });
});

describe("the in-app audit trail", () => {
  it("records a provisioning run, without the hash", async () => {
    await ensureLocalAdminAccount();

    expect(h.audit).toHaveLength(1);
    const entry = h.audit[0];
    expect(entry.message).toMatch(/provisioned from environment variables/);
    expect(JSON.stringify(entry.meta)).not.toContain(HASH);
    expect(JSON.stringify(entry.meta)).toContain(EMAIL);
  });

  it("records a refusal", async () => {
    configure({ AUTH_PROVIDER: "saml" });
    await ensureLocalAdminAccount();

    expect(h.audit[0].message).toMatch(/REFUSED/);
  });

  it("stays out of the log when a boot changes nothing", async () => {
    await ensureLocalAdminAccount();
    h.audit.length = 0;

    await ensureLocalAdminAccount();

    expect(h.audit).toHaveLength(0);
  });
});

describe("secrecy", () => {
  it("never prints the hash, in any outcome", async () => {
    await ensureLocalAdminAccount();
    configure({ LOCAL_AUTH_PASSWORD_HASH: OTHER_HASH });
    await ensureLocalAdminAccount();
    configure({ LOCAL_AUTH_PASSWORD_HASH: "not-a-hash" });
    await ensureLocalAdminAccount();

    const printed = consoleOutput.join("\n");
    expect(printed).toContain("LOCAL ADMIN ACCOUNT");
    expect(printed).not.toContain(HASH);
    expect(printed).not.toContain(OTHER_HASH);
    // Nothing hash-shaped at all. (The refusal text names the $2a$/$2b$/$2y$
    // prefixes on purpose — that is guidance, not a value.)
    expect(printed).not.toMatch(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{20,}/);
  });
});
