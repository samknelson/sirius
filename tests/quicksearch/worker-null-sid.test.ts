import { describe, expect, it, vi } from "vitest";

import { workerQuicksearchPlugin } from "../../server/plugins/quicksearch/plugins/worker";

describe("worker quicksearch null Sirius IDs", () => {
  it("labels a worker without a Sirius ID without exposing a null-like value", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: "worker-without-sid",
        siriusId: null,
        displayName: "Shell Worker",
        matchedName: true,
        matchedSiriusId: false,
        matchedWorkerId: false,
        matchedPhone: false,
        matchedSsn: false,
      },
    ]);

    const results = await workerQuicksearchPlugin.search({
      query: "shell",
      limit: 8,
      user: {} as never,
      settings: {},
      configId: "quicksearch-config",
      storage: { readOnly: { query } } as never,
    });

    expect(results).toEqual([
      {
        id: "worker-without-sid",
        title: "Shell Worker",
        subtitle: "No Sirius ID",
        matchedOn: "Name",
      },
    ]);
    expect(results[0].subtitle).not.toContain("null");
  });

  it("uses Worker when both the name and Sirius ID are absent", async () => {
    const query = vi.fn().mockResolvedValue([
      {
        id: "unnamed-worker",
        siriusId: null,
        displayName: null,
        matchedName: true,
        matchedSiriusId: false,
        matchedWorkerId: false,
        matchedPhone: false,
        matchedSsn: false,
      },
    ]);

    const results = await workerQuicksearchPlugin.search({
      query: "unknown",
      limit: 8,
      user: {} as never,
      settings: {},
      configId: "quicksearch-config",
      storage: { readOnly: { query } } as never,
    });

    expect(results[0]).toMatchObject({
      title: "Worker",
      subtitle: "No Sirius ID",
    });
  });
});