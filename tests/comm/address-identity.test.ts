import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => ({ select: () => ({ from: () => ({ where: async () => fixture.rows }) }) }),
  onAfterCommit: vi.fn(), runInTransaction: vi.fn(), runOutsideTransaction: vi.fn(),
}));
vi.mock("../../server/storage/middleware/logging", () => ({ withStorageLogging: (impl: unknown) => impl }));
vi.mock("../../server/storage/system/entity-metadata", () => ({ entityMetadataStorage: {} }));
vi.mock("../../server/storage/trust/worker-benefit-role-history-invalidation", () => ({
  affectedWorkerBenefitRoleHistoryWorkers: vi.fn(), enqueueWorkerBenefitRoleHistoryInvalidations: vi.fn(),
}));
import { createAddressStorage } from "../../server/storage/contacts";

describe("immutable two-line address identity", () => {
  const storage = createAddressStorage();
  it("never matches different units and treats omitted/null/blank as the same empty line", async () => {
    fixture.rows = [
      { id: "a", isActive: true, street: "12 Fictional St", street2: "Unit 4B", city: "Example", state: "CA", postalCode: "90001", country: "US" },
      { id: "b", isActive: true, street: "12 Fictional St", street2: null, city: "Example", state: "CA", postalCode: "90001", country: "US" },
    ];
    const match = (unit?: string | null) => storage.findMatchingAddress("c", "12 Fictional St", "Example", "CA", "90001", "US", unit);
    expect((await match(" Unit 4B "))?.id).toBe("a");
    expect(await match("Unit 4C")).toBeUndefined();
    for (const blank of [undefined, null, "", " "]) expect((await match(blank))?.id).toBe("b");
  });
  it("rejects line-two updates just like line-one updates", async () => {
    fixture.rows = [{ id: "a", street: "12 Fictional St", street2: "Unit 4B" }];
    await expect(storage.updateContactPostal("a", { street2: "Unit 4C" })).rejects.toThrow("immutable");
  });
  it("creates a new record for a changed unit and matches an identical import replay", async () => {
    const original = { id: "old", contactId: "c", isActive: true, isPrimary: true, source: "import",
      street: "12 Fictional St", street2: "Unit 4B", city: "Example", state: "CA", postalCode: "90001", country: "US" };
    fixture.rows = [original];
    const addresses = createAddressStorage();
    vi.spyOn(addresses, "getContactPostalByContact").mockImplementation(async () => fixture.rows);
    const create = vi.spyOn(addresses, "createContactPostal").mockImplementation(async data => {
      const row = { ...data, id: "new" } as any;
      fixture.rows.push(row);
      return row;
    });
    const input = { street: original.street, street2: "Unit 4C", city: original.city,
      state: original.state, postalCode: original.postalCode, country: original.country };
    expect((await addresses.createOrMatchAddress("c", input, "import")).isNew).toBe(true);
    expect(await addresses.createOrMatchAddress("c", input, "import")).toMatchObject({ isNew: false, changed: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect(original.street2).toBe("Unit 4B");
  });
});
