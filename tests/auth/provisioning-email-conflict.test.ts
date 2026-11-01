import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVISIONABLE_PROVIDERS } from "../../server/auth/auth-settings";

const f = vi.hoisted(() => ({
  createUser: vi.fn(), createIdentity: vi.fn(), findIdentity: vi.fn(), getUser: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  users: { createUser: f.createUser, getUser: f.getUser },
  authIdentities: { create: f.createIdentity, getByProviderAndExternalId: f.findIdentity },
} }));
vi.mock("../../server/storage/transaction-context", () => ({
  runInTransaction: (fn: () => unknown) => fn(),
}));
vi.mock("../../server/auth/auth-settings", async importOriginal => ({
  ...await importOriginal<typeof import("../../server/auth/auth-settings")>(),
  getAuthSettings: async () => ({}),
  getProvisioningMode: () => "create",
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({ clearAccessCache: vi.fn() }));
vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn() }, storageLogger: { info: vi.fn() },
}));
import { maybeProvisionUser } from "../../server/auth/provisioning";

beforeEach(() => {
  vi.clearAllMocks();
  f.getUser.mockResolvedValue({ id: "winner", isActive: true });
});

// Family-wide security contract: email ownership alone must never recover a
// failed trusted-provisioning race into another provider subject's account.
describe.each(PROVISIONABLE_PROVIDERS)("%s provisioning email conflict", provider => {
  it("refuses a conflicting email without linking or selecting an email winner", async () => {
    const error = { cause: { code: "23505", constraint: "users_email_normalized_unique" } };
    f.createUser.mockRejectedValue(error);
    f.findIdentity.mockResolvedValue(undefined);
    await expect(maybeProvisionUser(provider, { externalId: "subject", email: "Same@example.com" }))
      .rejects.toBe(error);
    expect(f.findIdentity).toHaveBeenCalledWith(provider, "subject");
    expect(f.createIdentity).not.toHaveBeenCalled();
    expect(f.getUser).not.toHaveBeenCalled();
  });

  it("recovers only the exact provider subject after the other transaction wins", async () => {
    f.createUser.mockRejectedValue({ code: "23505", constraint: "users_email_normalized_unique" });
    const identity = { userId: "winner", externalId: "subject", providerType: provider };
    f.findIdentity.mockResolvedValue(identity);
    await expect(maybeProvisionUser(provider, { externalId: "subject", email: "Same@example.com" }))
      .resolves.toMatchObject({ identity, user: { id: "winner" } });
    expect(f.findIdentity).toHaveBeenCalledWith(provider, "subject");
    expect(f.createIdentity).not.toHaveBeenCalled();
  });

  it("does not reactivate the winner or change its roles", async () => {
    f.createUser.mockRejectedValue({ code: "23505", constraint: "users_email_normalized_unique" });
    f.findIdentity.mockResolvedValue({ userId: "winner" });
    f.getUser.mockResolvedValue({ id: "winner", isActive: false });
    await expect(maybeProvisionUser(provider, { externalId: "subject", email: "Same@example.com" }))
      .resolves.toBeNull();
    expect(f.createIdentity).not.toHaveBeenCalled();
  });
});
