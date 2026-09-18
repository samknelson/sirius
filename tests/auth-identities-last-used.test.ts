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

describe("auth identity atomic claims", () => {
  afterEach(() => {
    mocks.getClient.mockReset();
  });

  it("returns the concurrent winner when the insert conflicts", async () => {
    const winner = {
      id: "identity-1",
      userId: "user-1",
      providerType: "okta",
      externalId: "subject-1",
    };
    const returning = vi.fn(async () => []);
    const onConflictDoNothing = vi.fn(() => ({ returning }));
    const values = vi.fn(() => ({ onConflictDoNothing }));
    const client = {
      insert: vi.fn(() => ({ values })),
      query: {
        authIdentities: {
          findFirst: vi.fn(async () => winner),
        },
      },
    };
    mocks.getClient.mockReturnValue(client);

    await expect(
      createAuthIdentitiesStorage().getOrCreate({
        userId: "user-1",
        providerType: "okta",
        externalId: "subject-1",
      }),
    ).resolves.toEqual({ identity: winner, created: false });
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
  });
});