import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { readTerminationEvidence } from "../../server/plugins/trust/provider-edi/termination-population";

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
});
