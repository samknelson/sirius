import { describe, expect, it } from "vitest";
import { readSiriusIdOwnershipSnapshotWithClient } from "../../server/storage/workers/sirius-id-ownership";

describe("Sirius ID ownership snapshot query boundaries", () => {
  it("selects bounded planner evidence and narrows every mapping phase", async () => {
    const queries: unknown[] = [];
    const client = {
      execute: async (query: unknown) => {
        queries.push(query);
        const n = queries.length;
        if (n <= 2) return { rows: [{ present: true }] };
        if (n === 3) return { rows: [{ nid: 10, raw_sirius_id: "100", raw_contact_nid: "91" }] };
        if (n === 4) return {
          rows: [{
            id: "worker-1", contact_id: "contact-91", sirius_id: 100,
            // A real database response can only contain the selected marker keys.
            data: { migrationShell: true, s1ContactNid: 91, migrationSiriusIdAllocation: { kind: "generated" } },
          }],
        };
        if (n === 5) return {
          rows: [{ entity: "shell-worker", s1_id: 91, s2_id: "worker-1", stub: false, loader: "t15-relationships" }],
        };
        return {
          rows: [{ entity: "contact", s1_id: 91, s2_id: "contact-91", stub: false, loader: "t3t1-contacts-workers" }],
        };
      },
    };

    const snapshot = await readSiriusIdOwnershipSnapshotWithClient(client);
    expect(snapshot.workers[0]).toMatchObject({
      id: "worker-1",
      data: { migrationShell: true, s1ContactNid: 91 },
      shellMappings: [{ sourceNid: 91 }],
    });
    expect(snapshot.contactMappings).toEqual([
      { sourceNid: 91, s2Id: "contact-91", stub: false, loader: "t3t1-contacts-workers" },
    ]);

    // Two catalog checks plus claims, workers, worker/shell mappings, and
    // relevant contact mappings: row volume cannot add query phases.
    expect(queries).toHaveLength(6);
    const queryText = queries.map((query) => JSON.stringify(query)).join("\n");
    expect(queryText).toContain("migrationShell");
    expect(queryText).toContain("migrationSiriusIdAllocation");
    expect(queryText).not.toMatch(/SELECT id, contact_id, sirius_id, data FROM workers/i);
    expect(queryText).toMatch(/worker.*shell-worker/s);
    expect(queryText).toContain("entity = 'contact'");
    expect(queryText).toContain("s2_id");
    expect(queryText).toContain("s1_id");
  });
});