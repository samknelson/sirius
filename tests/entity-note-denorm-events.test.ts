import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

const fixture = vi.hoisted(() => ({
  client: undefined as unknown,
  callbacks: [] as (() => void)[],
  emit: vi.fn().mockResolvedValue(undefined),
  rowExists: true,
}));
vi.mock("../server/storage/transaction-context", () => ({
  getClient: () => fixture.client,
  onAfterCommit: (fn: () => void) => fixture.callbacks.push(fn),
}));
vi.mock("../server/storage/middleware/logging", () => ({
  defineLoggingConfig: (config: unknown) => config,
}));
vi.mock("../server/services/event-bus", async importOriginal => ({
  ...await importOriginal<typeof import("../server/services/event-bus")>(),
  eventBus: { emit: fixture.emit },
}));
vi.mock("../server/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../server/storage", () => ({ storage: {} }));
import { createEntityNotesStorage } from "../server/storage/entity-notes";
import { EventType } from "../server/services/event-bus";

beforeEach(() => {
  fixture.callbacks = [];
  fixture.emit.mockClear();
  fixture.rowExists = true;
  fixture.client = drizzle(async () => ({
    rows: fixture.rowExists
      ? [["note", "worker", "worker", "type", "private subject", "private body",
          null, "2026-10-01 12:00:00", null]]
      : [],
  }));
});
const storage = createEntityNotesStorage();
describe("note event integration at the storage boundary", () => {
  it.each(["create", "update", "delete"] as const)("defers %s until commit and emits only the note id", async action => {
    if (action === "create") await storage.create({
      contextId: "worker", entityId: "worker", typeId: "type", subject: "private subject",
    });
    else if (action === "update") await storage.update("note", { body: "private body" });
    else await storage.delete("note");
    expect(fixture.emit).not.toHaveBeenCalled();
    expect(fixture.callbacks).toHaveLength(1);
    fixture.callbacks[0]();
    expect(fixture.emit).toHaveBeenCalledWith(
      action === "delete" ? EventType.ENTITY_NOTE_DELETE_AFTER : EventType.ENTITY_NOTE_SAVE_AFTER,
      { noteId: "note" },
    );
  });
  it("does not emit for a missing update or delete", async () => {
    fixture.rowExists = false;
    await storage.update("missing", { subject: "private" });
    await storage.delete("missing");
    expect(fixture.callbacks).toHaveLength(0);
  });
});
