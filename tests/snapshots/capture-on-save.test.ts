/**
 * When an entity's history entry is written, and what it holds.
 *
 * A snapshot claims to be the state one particular save LEFT, and consumers
 * read those entries back to compare one save against the one before it — the
 * EDLS worker notifier decides who came off a crew that way. Both properties
 * fail silently if capture is a reaction to the save rather than part of it:
 *
 *  - a capture that re-reads the entity after commit can pick up a SECOND
 *    save's state and file it under the first save's label, and
 *  - a capture that has not landed yet looks exactly like a save that never
 *    had one, so the next save's notifier compares against nothing and stays
 *    quiet — permanently, since the next baseline no longer holds the worker.
 *
 * So capture runs inside the saving transaction, reading through the same
 * client, and these tests pin that seam: it captures what that transaction can
 * see, honours the settings switch, and writes nothing for a save nothing
 * records history for.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const created: Array<{ entityType: string; entityId: string; label: string; data: unknown }> = [];
/** What the entity looks like to the transaction doing the capture. */
let exportedBundle: unknown = null;
let exportCalls = 0;
let captureDisabled = false;

vi.mock("../../server/storage", () => ({
  storage: {
    snapshots: {
      async create(row: { entityType: string; entityId: string; label: string; data: unknown }) {
        created.push(row);
        return { id: "snap-created", ...row };
      },
    },
    variables: {
      async getByName() {
        // The variable exists to turn capture OFF; absent means on.
        return captureDisabled
          ? { value: { events: { "edls.sheet.saved": false } } }
          : null;
      },
    },
    users: {
      async getUser() {
        return null;
      },
    },
    edlsSheets: {
      async export() {
        exportCalls++;
        return exportedBundle;
      },
    },
  },
}));

vi.mock("../../server/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../../server/middleware/request-context", () => ({
  getRequestContext: () => null,
}));

const { EventType } = await import("../../server/services/event-bus");
const { captureEntitySnapshot } = await import("../../server/services/snapshots/capture");

const SHEET = { id: "sheet-1", status: "lock", ymd: "2099-06-01" };

function sheetSaved(previousStatus: string | null, newStatus: string) {
  return {
    sheetId: SHEET.id,
    previousStatus,
    newStatus,
    sheet: { ...SHEET, status: newStatus } as never,
  };
}

afterEach(() => {
  created.length = 0;
  exportCalls = 0;
  captureDisabled = false;
  exportedBundle = null;
});

describe("snapshot capture — part of the save, not a reaction to it", () => {
  it("stores what the saving transaction can see", async () => {
    // The export runs under the caller's transaction client, so this is the
    // sheet as this save left it — not as some later save leaves it.
    exportedBundle = {
      version: 1,
      data: { id: SHEET.id, status: "lock", crews: [], changed: "2099-05-01T12:00:00.000Z" },
    };
    await captureEntitySnapshot(EventType.EDLS_SHEET_SAVED, sheetSaved("draft", "lock"));

    expect(created).toHaveLength(1);
    expect(created[0].data).toBe(exportedBundle);
    expect(created[0].entityType).toBe("edls_sheet");
    expect(created[0].label).toBe("status: draft → lock");
  });

  it("records nothing for a save that changed no status", async () => {
    await captureEntitySnapshot(EventType.EDLS_SHEET_SAVED, sheetSaved("lock", "lock"));
    expect(created).toHaveLength(0);
    expect(exportCalls, "and does not pay for an export either").toBe(0);
  });

  it("stays switched off when the settings say so", async () => {
    captureDisabled = true;
    exportedBundle = { version: 1, data: { id: SHEET.id, crews: [] } };
    await captureEntitySnapshot(EventType.EDLS_SHEET_SAVED, sheetSaved("draft", "lock"));
    expect(created).toHaveLength(0);
  });

  it("records nothing for an event nothing captures", async () => {
    await captureEntitySnapshot(EventType.WORKER_SKILL_SAVED, { workerId: "w1" } as never);
    expect(created).toHaveLength(0);
    expect(exportCalls).toBe(0);
  });
});
