/**
 * Which tables the entity metadata orphan sweep will delete from.
 *
 * The sweep removes provenance rows whose record is gone, and it finds them by
 * anti-joining `entity_metadata` against the table each row NAMES. That name
 * is data — written by whichever storage logging config produced the row — so
 * the whole safety of the job is this one decision: a table it cannot vouch
 * for must be skipped and reported, never swept.
 *
 * Every way of getting it wrong deletes history silently. Joining against a
 * table whose key is not a record id (a slug, a code) matches nothing, so
 * every one of that table's provenance rows looks orphaned and the lot goes in
 * one run. Treating a missing table as an empty one does the same to a
 * component that is merely switched off. Nothing complains afterwards: the
 * records are fine, only their created/modified stamps are gone, and the next
 * edit quietly writes a fresh row that claims the record was created today.
 */
import { describe, expect, it } from "vitest";

import {
  judgeSweepTable,
  type TableFacts,
} from "../../server/storage/system/entity-metadata-tables";

const RECORD_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER_RECORD_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function facts(overrides: Partial<TableFacts> = {}): TableFacts {
  return {
    exists: true,
    idColumnType: "character varying",
    sampleIds: [RECORD_ID, OTHER_RECORD_ID],
    ...overrides,
  };
}

/** The reason a refusal gave, or a marker when it did not refuse. */
function refusal(tableName: string, tableFacts: TableFacts): string {
  const verdict = judgeSweepTable(tableName, tableFacts);
  return verdict.sweepable ? "SWEPT" : verdict.reason;
}

describe("tables the metadata sweep accepts", () => {
  it("sweeps an ordinary record table keyed by record ids", () => {
    expect(judgeSweepTable("workers", facts())).toEqual({ sweepable: true });
  });

  it("sweeps a table with no rows, whose provenance rows are all orphans", () => {
    // An empty table genuinely owns no records; there is nothing to vouch for
    // beyond its key, and every row naming it has outlived its record.
    expect(judgeSweepTable("workers", facts({ sampleIds: [] }))).toEqual({ sweepable: true });
  });

  it("accepts a real uuid key as well as this schema's varchar one", () => {
    expect(judgeSweepTable("workers", facts({ idColumnType: "uuid" }))).toEqual({
      sweepable: true,
    });
  });
});

describe("tables the metadata sweep refuses", () => {
  it("refuses a table that is not there", () => {
    // A component that manages its own schema has no tables at all while it is
    // off. "The table is missing" is not evidence that the records are gone.
    expect(refusal("grievances", facts({ exists: false }))).not.toBe("SWEPT");
  });

  it("refuses a name that is not a plain identifier, without asking the database", () => {
    for (const name of [
      "users; drop table users",
      'users" --',
      "public.users",
      "Users",
      "user's",
      "",
    ]) {
      expect(refusal(name, facts())).toBe("not a plain table name");
    }
  });

  it("refuses a table with no id column to join on", () => {
    expect(refusal("session", facts({ idColumnType: null }))).not.toBe("SWEPT");
  });

  it("refuses a key that cannot hold a record id", () => {
    expect(refusal("cron_job_runs", facts({ idColumnType: "integer" }))).not.toBe("SWEPT");
  });

  it("refuses a text key that holds something other than record ids", () => {
    // The case that matters most: a table keyed by a slug joins against
    // nothing, so every provenance row naming it looks orphaned.
    expect(
      refusal("components", facts({ sampleIds: ["dispatch", "trust.benefits"] })),
    ).not.toBe("SWEPT");
  });

  it("refuses a key that only mostly holds record ids", () => {
    expect(refusal("workers", facts({ sampleIds: [RECORD_ID, "legacy-7841"] }))).not.toBe(
      "SWEPT",
    );
  });

  it("names the table's own trouble in the reason it reports", () => {
    // The reason is what the run summary shows an operator, so it has to say
    // which refusal happened, not just that one did.
    const reasons = new Set([
      refusal("grievances", facts({ exists: false })),
      refusal("session", facts({ idColumnType: null })),
      refusal("cron_job_runs", facts({ idColumnType: "integer" })),
      refusal("components", facts({ sampleIds: ["dispatch"] })),
    ]);
    expect(reasons.size).toBe(4);
    expect(reasons.has("SWEPT")).toBe(false);
  });
});
