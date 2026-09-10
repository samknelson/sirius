import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiRequest } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("../client/src/lib/queryClient", () => ({
  apiRequest,
}));

import { runMetadataBackfill } from "../client/src/pages/admin/metadata-backfill";

describe("record-history backfill UI request", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("uses the parsed request-helper result without parsing it again", async () => {
    const result = {
      contextId: "workers",
      written: 12,
      alreadyPresent: 0,
      skipped: 0,
      missing: 3,
    };
    apiRequest.mockResolvedValue(result);

    await expect(runMetadataBackfill("workers")).resolves.toEqual(result);
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/entity-metadata/backfill", {
      contextId: "workers",
      limit: 1000,
    });
  });
});