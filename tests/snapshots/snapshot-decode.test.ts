import { describe, expect, it } from "vitest";
import { decodeEdlsSheetSnapshot } from "../../server/modules/edls/snapshot-decode";

describe("snapshot decoding compatibility", () => {
  it("decodes a legacy bundle that has no metadata sibling", () => {
    expect(
      decodeEdlsSheetSnapshot({
        version: 1,
        data: {
          id: "sheet-1",
          status: "lock",
          crews: [],
        },
      }),
    ).toEqual({
      sheet: {
        id: "sheet-1",
        status: "lock",
      },
      crews: [],
      assignments: [],
    });
  });
});