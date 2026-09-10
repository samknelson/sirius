import { describe, expect, it } from "vitest";
import { snapshotMetadataFromView } from "../../server/storage/system/entity-metadata";

describe("snapshot record-history metadata", () => {
  it("serializes the exact persisted revision and stamps without Date objects", () => {
    const metadata = snapshotMetadataFromView(
      {
        seq: 42,
        rev: 7,
        contextId: "edls_sheet",
        entityId: "sheet-1",
        created: {
          date: new Date("2099-05-01T12:00:00.000Z"),
          personName: "Creator",
        },
        modified: {
          date: new Date("2099-05-15T12:00:00.000Z"),
          personName: "Previous editor",
        },
        subrecordModified: {
          date: null,
          personName: null,
        },
      },
    );

    expect(metadata).toEqual({
      seq: 42,
      rev: 7,
      contextId: "edls_sheet",
      entityId: "sheet-1",
      created: { date: "2099-05-01T12:00:00.000Z", personName: "Creator" },
      modified: { date: "2099-05-15T12:00:00.000Z", personName: "Previous editor" },
      subrecordModified: { date: null, personName: null },
    });
    expect(() => JSON.stringify(metadata)).not.toThrow();
  });
});