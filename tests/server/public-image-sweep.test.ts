import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  remove: vi.fn(), update: vi.fn(), listPage: vi.fn(),
  providerDelete: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { files: {
  listPage: state.listPage, update: state.update, delete: state.remove,
} } }));
vi.mock("../../server/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("../../server/services/files/registry", () => ({
  getFileSystemProvider: () => ({
    stat: async () => ({ size: 999, mimeType: "changed" }),
    list: async () => ({ entries: [] }),
    delete: state.providerDelete,
  }),
}));
vi.mock("../../server/services/entity-files/registry", () => ({
  getEntityFileContext: () => ({ publishedAsset: true }),
}));
import { sweepFileSystem } from "../../server/services/files/sweep";

describe("published images in filesystem cleanup", () => {
  it("skips immutable refresh and advances past retained pending-delete records", async () => {
    state.listPage.mockImplementation(async (filter, options) => {
      if (!filter.status) return { rows: [{ id: "live", entityType: "published-image", status: "live", storagePath: "live.png", size: 1 }] };
      if (!options.cursor) return { rows: [{ id: "retained", entityType: "published-image", storagePath: "retained.png" }], cursor: "retained" };
      return { rows: [{ id: "orphan", entityType: "orphaned_file", storagePath: "orphan.png" }] };
    });
    const result = await sweepFileSystem("public", { dryRun: false, deleteOrphans: true, graceDays: 1, pageSize: 1 });
    expect(result.errors).toBe(0);
    expect(result.orphansDeleted).toBe(1);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.remove).toHaveBeenCalledExactlyOnceWith("orphan");
    expect(state.providerDelete).toHaveBeenCalledExactlyOnceWith("orphan.png");
    expect(state.listPage).toHaveBeenCalledTimes(3);
  });
});
