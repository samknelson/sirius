import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveRecordGoIdentifier, authorizeRecordGoUser, getMetadataRecordContext } = vi.hoisted(
  () => ({
    resolveRecordGoIdentifier: vi.fn(),
    authorizeRecordGoUser: vi.fn(),
    getMetadataRecordContext: vi.fn(),
  }),
);

vi.mock("../../server/services/record-go", () => ({
  resolveRecordGoIdentifier,
}));
vi.mock("../../server/services/record-go-access", () => ({
  authorizeRecordGoUser,
}));
vi.mock("../../server/storage/entity-metadata-record-tables", () => ({
  getMetadataRecordContext,
}));

const { goQuicksearchPlugin } = await import(
  "../../server/plugins/quicksearch/plugins/go"
);

const user = { id: "user-id" } as any;
const metadata = {
  seq: 123,
  rev: 4,
  contextId: "workers",
  entityId: "worker-id",
  created: { date: null, personName: null },
  modified: { date: null, personName: null },
  subrecordModified: { date: null, personName: null },
};

function context(query: string) {
  return {
    query,
    limit: 8,
    user,
    settings: {},
    configId: "config-id",
    storage: {} as any,
  };
}

describe("Go Quicksearch plugin", () => {
  beforeEach(() => {
    resolveRecordGoIdentifier.mockReset();
    authorizeRecordGoUser.mockReset().mockResolvedValue(true);
    getMetadataRecordContext.mockReset().mockReturnValue({
      contextId: "workers",
      label: "Workers",
    });
  });

  it.each(["11111111-1111-4111-8111-111111111111", "123", "000.0123::9999"])(
    "delegates %s to the resolver and returns the exact destination",
    async (query) => {
      const resolution = {
        kind: "resolved" as const,
        metadata,
        href: "/workers/worker-id",
      };
      resolveRecordGoIdentifier.mockResolvedValue(resolution);

      await expect(goQuicksearchPlugin.search(context(query))).resolves.toEqual([
        {
          id: "worker-id",
          title: "Workers",
          subtitle: "000.0123::0004",
          href: "/workers/worker-id",
          matchedOn: "Record identifier",
        },
      ]);
      expect(resolveRecordGoIdentifier).toHaveBeenCalledWith(query);
      expect(authorizeRecordGoUser).toHaveBeenCalledWith(user, resolution);
    },
  );

  it.each([
    "not-an-id",
    "000.0123::",
    "unknown-uuid",
  ])("returns no result for a non-resolved identifier: %s", async (query) => {
    resolveRecordGoIdentifier.mockResolvedValue({
      kind: "not_found",
      reason: query === "unknown-uuid" ? "unknown" : "unknown",
    });

    await expect(goQuicksearchPlugin.search(context(query))).resolves.toEqual([]);
    expect(authorizeRecordGoUser).not.toHaveBeenCalled();
  });

  it("returns no result when the identifier resolves to a record without a page", async () => {
    resolveRecordGoIdentifier.mockResolvedValue({
      kind: "not_found",
      reason: "no_page",
    });

    await expect(goQuicksearchPlugin.search(context("000.0123"))).resolves.toEqual([]);
    expect(authorizeRecordGoUser).not.toHaveBeenCalled();
  });

  it("returns no result when record-specific authorization denies the caller", async () => {
    const resolution = {
      kind: "resolved" as const,
      metadata,
      href: "/workers/worker-id",
    };
    resolveRecordGoIdentifier.mockResolvedValue(resolution);
    authorizeRecordGoUser.mockResolvedValue(false);

    await expect(goQuicksearchPlugin.search(context("000.0123"))).resolves.toEqual([]);
    expect(authorizeRecordGoUser).toHaveBeenCalledWith(user, resolution);
    expect(getMetadataRecordContext).not.toHaveBeenCalled();
  });
});
