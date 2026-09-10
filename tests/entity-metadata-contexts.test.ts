import { describe, expect, it } from "vitest";
import {
  getMetadataContextForTable,
  getMetadataRecordContext,
  isMetadataRecordContext,
  metadataRecordHref,
} from "../server/storage/entity-metadata-record-tables";

describe("entity metadata context registry", () => {
  it("reverse-resolves a logging table through its declared Drizzle table", () => {
    const context = getMetadataContextForTable("workers");

    expect(context?.contextId).toBe("workers");
    expect(context?.tableName).toBe("workers");
    expect(getMetadataRecordContext(context!.contextId)?.tableName).toBe("workers");
  });

  it("does not offer process-owned tables as metadata contexts", () => {
    expect(isMetadataRecordContext("esigs")).toBe(false);
    expect(getMetadataContextForTable("esigs")).toBeUndefined();
  });

  it("uses the context id for record destinations", () => {
    expect(metadataRecordHref("workers", "record/with spaces")).toBe(
      "/workers/record%2Fwith%20spaces",
    );
    expect(metadataRecordHref("contact_phone", "record-id")).toBeNull();
  });
});