import { beforeEach, describe, expect, it, vi } from "vitest";

const tables = {
  contacts: { name: "contacts", id: "contacts.id" },
  comm: { name: "comm", id: "comm.id", contactId: "comm.contact_id" },
  contactPostal: { name: "contact_postal", id: "contact_postal.id", contactId: "contact_postal.contact_id" },
  edlsAssignments: { name: "assignments", id: "assignments.id" },
  edlsCrews: { name: "crews", id: "crews.id" },
  edlsSheets: { name: "sheets", id: "sheets.id" },
  grievanceWorkers: { name: "grievance_workers", id: "grievance_workers.id" },
  phoneNumbers: { name: "contact_phone", id: "contact_phone.id", contactId: "contact_phone.contact_id" },
  workerEdls: { name: "worker_edls", id: "worker_edls.id" },
  workers: { name: "workers", id: "workers.id", contactId: "workers.contact_id" },
};

const initialRows: Record<string, Array<Record<string, string>>> = {
  workers: [
    { id: "worker-1", contactId: "contact-1" },
    { id: "worker-2", contactId: "contact-2" },
  ],
  sheets: [{ id: "sheet-1" }],
  crews: [{ id: "crew-1" }, { id: "crew-2" }],
  assignments: [{ id: "assignment-1" }, { id: "assignment-2" }, { id: "assignment-3" }],
  worker_edls: [{ id: "worker-edls-1" }],
  grievance_workers: [{ id: "grievance-worker-1" }],
  contacts: [
    { id: "contact-1", displayName: "Sensitive Contact One" },
    { id: "contact-2", displayName: "Sensitive Contact Two" },
  ],
  comm: [{ contactId: "contact-1" }],
  contact_postal: [{ id: "postal-1" }],
  contact_phone: [{ id: "phone-1" }],
};
let rows: Record<string, Array<Record<string, string>>> = {};

const afterCommit = vi.fn();
const runInTransaction = vi.fn(async (fn: () => Promise<unknown>) => fn());
const emit = vi.fn(async () => {});
let failAt: string | null = null;
let failure: Error | null = null;

const client = {
  select: vi.fn((selection: Record<string, unknown> = {}) => ({
    from: (table: { name: string }) => {
      if (Object.keys(selection).length === 1 && "contactId" in selection) {
        return { where: async () => rows[table.name] ?? [] };
      }
      const result = Promise.resolve(
        "count" in selection
          ? [{ count: rows[table.name]?.length ?? 0 }]
          : rows[table.name] ?? [],
      );
      return Object.assign(result, {
        where: async () => rows[table.name] ?? [],
      });
    },
  })),
  delete: vi.fn((table: { name: string }) => {
    const returning = async () => {
      if (failAt === table.name) throw failure ?? new Error("forced reset failure");
      if (table.name === "contacts") return [{ id: "contact-2" }];
      return rows[table.name] ?? [];
    };
    return {
      returning,
      where: () => ({ returning }),
    };
  }),
  update: vi.fn((table: { name: string }) => ({
    set: () => ({
      where: () => ({
        returning: async () => table.name === "contacts" ? [{ id: "contact-1" }] : [],
      }),
    }),
  })),
};

vi.mock("../../shared/schema", () => tables);
vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => client,
  onAfterCommit: afterCommit,
  runInTransaction,
}));
vi.mock("../../server/services/event-bus", () => ({
  eventBus: { emit },
  EventType: { WORKER_DELETE_AFTER: "WORKER_DELETE_AFTER" },
}));

const { createFreemanEdlsFullResetStorage } = await import(
  "../../server/storage/sitespecific/freeman/edls-full-reset"
);

beforeEach(() => {
  vi.clearAllMocks();
  delete (client as typeof client & { execute?: unknown }).execute;
  failAt = null;
  failure = null;
  rows = structuredClone(initialRows);
});

describe("Freeman EDLS full reset storage", () => {
  it("reports live preflight counts", async () => {
    const storage = createFreemanEdlsFullResetStorage();
    await expect(storage.getCounts()).resolves.toEqual({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
    });
  });

  it("deletes the complete hierarchy and blockers in one transaction", async () => {
    const storage = createFreemanEdlsFullResetStorage();
    await expect(storage.execute({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
    })).resolves.toEqual({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
      workerEdls: 1,
      grievanceAssociations: 1,
      contactsDeleted: 1,
      contactsAnonymized: 1,
      contactsPreserved: 0,
    });

    expect(runInTransaction).toHaveBeenCalledTimes(1);
    expect(client.delete.mock.calls.map(([table]) => table.name)).toEqual([
      "assignments",
      "crews",
      "sheets",
      "worker_edls",
      "grievance_workers",
      "workers",
      "contact_postal",
      "contact_phone",
      "contacts",
    ]);
    expect(afterCommit).toHaveBeenCalledTimes(1);

    const callback = afterCommit.mock.calls[0][0];
    callback();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith("WORKER_DELETE_AFTER", { workerId: "worker-1" });
    expect(emit).toHaveBeenCalledWith("WORKER_DELETE_AFTER", { workerId: "worker-2" });
  });

  it("does not schedule worker cleanup effects when the transaction fails", async () => {
    failAt = "workers";
    const storage = createFreemanEdlsFullResetStorage();

    await expect(storage.execute({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
    })).rejects.toMatchObject({
      name: "FreemanEdlsFullResetUnexpectedError",
      stage: "delete_workers",
    });
    expect(afterCommit).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("uses savepoint probes to identify the exact failing record", async () => {
    (client as typeof client & { execute?: (query: unknown) => Promise<{ rows: never[] }> }).execute =
      vi.fn(async () => ({ rows: [] }));
    failAt = "assignments";
    failure = new Error("storage mutation wrapper", {
      cause: Object.assign(new Error("assignment deletion trigger refused this row"), {
        code: "P0001",
        severity: "ERROR",
        table: "assignments",
        detail: "The assignment is retained by a site trigger.",
      }),
    });
    const storage = createFreemanEdlsFullResetStorage();

    let thrown: unknown;
    try {
      await storage.execute({
        workers: 2,
        sheets: 1,
        crews: 2,
        assignments: 3,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: "FreemanEdlsFullResetUnexpectedError",
      stage: "delete_assignments",
      failedRecord: {
        table: "edls_assignments",
        id: "assignment-1",
      },
      diagnostics: expect.objectContaining({
        code: "P0001",
        severity: "ERROR",
        table: "assignments",
      }),
    });
    const serialized = JSON.stringify(thrown);
    expect(serialized).not.toContain("snapshot");
    expect(serialized).not.toContain("assignment deletion trigger refused this row");
    expect(serialized).not.toContain("The assignment is retained by a site trigger.");
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("projects worker failures to identifiers without names or relationships", async () => {
    (client as typeof client & { execute?: (query: unknown) => Promise<{ rows: never[] }> }).execute =
      vi.fn(async () => ({ rows: [] }));
    failAt = "workers";
    failure = Object.assign(new Error("secret worker detail"), { code: "XX000" });
    const storage = createFreemanEdlsFullResetStorage();

    let thrown: unknown;
    try {
      await storage.execute({
        workers: 2,
        sheets: 1,
        crews: 2,
        assignments: 3,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "FreemanEdlsFullResetUnexpectedError",
      stage: "delete_workers",
      failedRecord: {
        table: "workers",
        id: "worker-1",
        worker: { id: "worker-1", contactId: "contact-1" },
      },
    });
    const serialized = JSON.stringify(thrown);
    expect(serialized).not.toContain("Sensitive Contact");
    expect(serialized).not.toContain("relationships");
    expect(serialized).not.toContain("secret worker detail");
  });

  it("classifies worker relationship blockers from lightweight clients", async () => {
    failAt = "workers";
    failure = Object.assign(new Error("secret row detail"), {
      code: "23503",
      constraint: "hidden_worker_relation",
    });
    const storage = createFreemanEdlsFullResetStorage();

    await expect(storage.execute({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
    })).rejects.toMatchObject({
      name: "FreemanEdlsFullResetRelationshipError",
      entity: "worker",
      stage: "delete_workers",
    });
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("classifies contact relationship blockers from lightweight clients", async () => {
    failAt = "contacts";
    failure = Object.assign(new Error("secret contact detail"), {
      code: "23503",
      constraint: "hidden_contact_relation",
    });
    const storage = createFreemanEdlsFullResetStorage();

    await expect(storage.execute({
      workers: 2,
      sheets: 1,
      crews: 2,
      assignments: 3,
    })).rejects.toMatchObject({
      name: "FreemanEdlsFullResetRelationshipError",
      entity: "contact",
      stage: "delete_contacts",
    });
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("refuses stale expected counts before deleting anything", async () => {
    const storage = createFreemanEdlsFullResetStorage();

    await expect(storage.execute({
      workers: 99,
      sheets: 1,
      crews: 2,
      assignments: 3,
    })).rejects.toThrow("counts changed");
    expect(client.delete).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it("is idempotent for an empty database and preserves unrelated contacts", async () => {
    rows = {
      workers: [],
      sheets: [],
      crews: [],
      assignments: [],
      worker_edls: [],
      grievance_workers: [],
      contacts: [{ id: "unrelated-contact" }],
      comm: [],
      contact_postal: [],
      contact_phone: [],
    };
    const storage = createFreemanEdlsFullResetStorage();

    await expect(storage.execute({
      workers: 0,
      sheets: 0,
      crews: 0,
      assignments: 0,
    })).resolves.toEqual({
      workers: 0,
      sheets: 0,
      crews: 0,
      assignments: 0,
      workerEdls: 0,
      grievanceAssociations: 0,
      contactsDeleted: 0,
      contactsAnonymized: 0,
      contactsPreserved: 0,
    });
    expect(client.delete.mock.calls.map(([table]) => table.name)).not.toContain("contacts");
  });
});