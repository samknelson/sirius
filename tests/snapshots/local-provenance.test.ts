import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  getRequestContext: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
}));

vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: mocks.getRequestContext,
}));

const { createSnapshotsStorage } = await import("../../server/storage/system/snapshots");

describe("snapshot local capture provenance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.getClient.mockReset();
    mocks.getRequestContext.mockReset();
  });

  it("freezes the signed-in actor display name on the snapshot row", async () => {
    const insertedValues: Record<string, unknown>[] = [];
    const client = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [
            { firstName: "Sam", lastName: "Nelson", email: "sam@example.test" },
          ]),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            returning: vi.fn(async () => [{ id: "snapshot-1", ...values }]),
          };
        }),
      })),
    };
    mocks.getClient.mockReturnValue(client);
    mocks.getRequestContext.mockReturnValue({ userId: "user-1" });

    const row = await createSnapshotsStorage().create({
      entityType: "edls_sheet",
      entityId: "sheet-1",
      label: "status: draft → lock",
      data: { version: 1, data: {} },
    });

    expect(insertedValues[0]).toMatchObject({
      authorId: "user-1",
      authorName: "Sam Nelson",
    });
    expect(row.authorName).toBe("Sam Nelson");
  });
});