import { beforeEach, expect, it, vi } from "vitest";
import type { User } from "../../shared/schema";

const state = vi.hoisted(() => ({
  email: "former@example.com" as string | null,
  afterCommit: [] as (() => void)[],
  getClient: vi.fn(),
}));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: state.getClient,
  onAfterCommit: (callback: () => void) => state.afterCommit.push(callback),
  runOutsideTransaction: (callback: () => unknown) => callback(),
}));
vi.mock("../../server/storage/middleware/logging", () => ({
  withStorageLogging: (implementation: unknown) => implementation,
}));
vi.mock("../../server/storage/system/entity-metadata", () => ({
  entityMetadataStorage: {},
}));
vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => undefined,
}));
vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));
import "../../shared/access-policies/trust/provider/mine";
import { evaluatePolicy, invalidateAccessCache } from "../../server/services/access-policy-evaluator";
import { createContactStorage, type ContactsStorage } from "../../server/storage/contacts";
import { createTrustProviderContactStorage } from "../../server/storage/trust/provider/contacts";

beforeEach(() => {
  state.email = "former@example.com";
  state.afterCommit = [];
  invalidateAccessCache({});
  state.getClient.mockReturnValue({
    query: { trustProviderContacts: { findFirst: async () => ({ contactId: "contact" }) } },
    update: () => ({
      set: ({ email }: { email: string | null }) => {
        state.email = email;
        return { where: () => ({ returning: async () => [{ id: "contact", email }] }) };
      },
    }),
  });
});

it("revokes a cached provider grant only after its delegated email update commits", async () => {
  const sharedContactStorage = createContactStorage();
  const providerStorage = createTrustProviderContactStorage(sharedContactStorage as ContactsStorage);
  vi.spyOn(providerStorage, "get").mockResolvedValue(null);
  const user = { id: "former-user", email: "former@example.com", isActive: true } as User;
  const fullStorage = {
    contacts: {
      getContactByEmail: async (email: string) => email === state.email ? { id: "contact", email } : undefined,
    },
    trustProviderContacts: {
      getByContactId: async () => [{ providerId: "provider" }],
    },
  };
  const accessStorage = {
    hasPermission: async (_id: string, permission: string) => permission === "trust.provider",
    getUserPermissions: async () => ["trust.provider"],
    getUser: async () => user,
  };
  const check = () => evaluatePolicy(
    user, "trust.provider.mine", fullStorage, accessStorage, async () => true, "provider",
  );
  expect((await check()).granted).toBe(true);
  await providerStorage.updateContactEmail("association", "replacement@example.com");
  expect(state.email).toBe("replacement@example.com");
  expect(state.afterCommit).toHaveLength(1);
  // A transaction must not evict the grant until its changed identity is committed.
  expect((await check()).granted).toBe(true);
  state.afterCommit.forEach(callback => callback());
  expect((await check()).granted).toBe(false);
});
