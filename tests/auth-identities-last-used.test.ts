import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
}));

const { createAuthIdentitiesStorage } = await import("../server/storage/auth-identities");

describe("auth identity last-used stamps", () => {
  afterEach(() => {
    mocks.getClient.mockReset();
  });

  it("does not make a sign-in look like an identity mutation", async () => {
    const sets: Record<string, unknown>[] = [];
    const client = {
      update: vi.fn(() => ({
        set: vi.fn((values: Record<string, unknown>) => {
          sets.push(values);
          return {
            where: vi.fn(async () => undefined),
          };
        }),
      })),
    };
    mocks.getClient.mockReturnValue(client);

    await createAuthIdentitiesStorage().updateLastUsed("identity-1");

    expect(sets).toHaveLength(1);
    expect(sets[0]).toEqual({ lastUsedAt: expect.any(Date) });
    expect(sets[0]).not.toHaveProperty("updatedAt");
  });
});