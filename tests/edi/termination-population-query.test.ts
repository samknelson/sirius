import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { readTerminationEvidence } from "../../server/plugins/trust/provider-edi/termination-population";
import { ediReadFixture } from "./fixtures/harness";

describe("termination evidence lookup", () => {
  it("uses indexable calendar ranges for event selection and later-coverage checks", async () => {
    let predicate: unknown;
    const chain = {
      from() { return this; },
      where(value: unknown) { predicate = value; return this; },
      orderBy() { return this; },
      limit() { return this; },
      then(resolve: (rows: unknown[]) => unknown) { return Promise.resolve([]).then(resolve); },
    };
    const db = { select: () => chain };
    const ctx = {
      configData: {}, input: { asOfDate: "2026-01-15" },
      terminationPolicy: { subscribers: true, dependents: false, months: 1 },
      storage: { readOnly: { query: (read: (db: unknown) => unknown) => read(db) } },
    } as unknown as TrustProviderEdiContext;

    await readTerminationEvidence(ctx, ["benefit"]);

    const compiled = new PgDialect().sqlToQuery(predicate as never);
    expect(compiled.sql).toContain("(\"trust_wmb_events\".\"year\", \"trust_wmb_events\".\"month\") BETWEEN");
    expect(compiled.params).toEqual(["benefit", "terminate", 2026, 1, 2026, 1]);
    expect(compiled.sql).toContain("NOT EXISTS");
    expect(compiled.sql).toContain("(later.year, later.month) >=");
    expect(compiled.sql).not.toContain("* 12");
  });

  it("names the source worker NID when a termination has no last-covered evidence", async () => {
    const fixture = ediReadFixture([
      [{ id: "event", workerId: "worker-uuid", benefitId: "benefit", year: 2026, month: 2, data: null }],
      [], // no last-covered WMB row
      [], // no scan decisions needed before the missing-history refusal
      [{ present: true }],
      [{ nid: "4711" }],
    ]);
    fixture.ctx.input = { asOfDate: "2026-02-01" };
    fixture.ctx.terminationPolicy = { subscribers: true, dependents: false, months: 1 };

    await expect(readTerminationEvidence(fixture.ctx, ["benefit"])).rejects.toThrow(
      "Termination event event for worker NID 4711: last-covered WMB evidence is missing for 2026-01-01 (benefit benefit). Repair history before generating.",
    );
    fixture.assertReadsConsumed();
  });

  it("falls back to the internal worker ID if S1 source mappings are unavailable", async () => {
    const fixture = ediReadFixture([
      [{ id: "event", workerId: "worker-uuid", benefitId: "benefit", year: 2026, month: 2, data: null }],
      [],
      [],
      [{ present: false }],
    ]);
    fixture.ctx.input = { asOfDate: "2026-02-01" };
    fixture.ctx.terminationPolicy = { subscribers: true, dependents: false, months: 1 };

    await expect(readTerminationEvidence(fixture.ctx, ["benefit"])).rejects.toThrow(
      "Termination event event for worker NID unavailable (S2 worker worker-uuid)",
    );
    fixture.assertReadsConsumed();
  });
});
