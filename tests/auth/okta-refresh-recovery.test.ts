import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const getOrCreate = vi.fn();
  return {
    getOrCreate,
    storage: {
      authIdentities: { getOrCreate },
    },
  };
});

vi.mock("../../server/storage", () => ({ storage: h.storage }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  storageLogger: { info: vi.fn() },
}));
const { linkProvisionedOktaIdentity, safeDatabaseDiagnostic } =
  await import("../../server/auth/providers/okta");

describe("Okta identity recovery after a database refresh", () => {
  beforeEach(() => h.getOrCreate.mockReset());

  it("reuses the identity won by concurrent or repeated callbacks", async () => {
    const identity = {
      id: "identity-1",
      userId: "user-1",
      providerType: "okta",
      externalId: "okta-subject-1",
    };
    h.getOrCreate
      .mockResolvedValueOnce({ identity, created: true })
      .mockResolvedValueOnce({ identity, created: false });

    const args = {
      userId: "user-1",
      externalId: "okta-subject-1",
      email: "person@example.invalid",
    };
    await expect(linkProvisionedOktaIdentity(args)).resolves.toBe(identity);
    await expect(linkProvisionedOktaIdentity(args)).resolves.toBe(identity);
    expect(h.getOrCreate).toHaveBeenCalledTimes(2);
  });

  it("refuses a provider identity that belongs to another user", async () => {
    h.getOrCreate.mockResolvedValue({
      identity: { id: "identity-1", userId: "user-2" },
      created: false,
    });
    await expect(
      linkProvisionedOktaIdentity({
        userId: "user-1",
        externalId: "okta-subject-1",
        email: "person@example.invalid",
      }),
    ).rejects.toThrow("already linked to another user");
  });

  it("logs only safe database identifiers", () => {
    const diagnostic = safeDatabaseDiagnostic({
      name: "error",
      code: "23502",
      table: "auth_identities",
      column: "created_at",
      constraint: "auth_identity_timestamp",
      detail: "Failing row contains person@example.invalid",
      query: "insert into auth_identities values (...)",
      token: "secret",
    });
    expect(diagnostic).toEqual({
      name: "error",
      code: "23502",
      table: "auth_identities",
      column: "created_at",
      constraint: "auth_identity_timestamp",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("example.invalid");
  });
});