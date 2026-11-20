import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { readTerminationEvidence } from "../../server/plugins/trust/provider-edi/termination-population";
import { ediReadFixture } from "./fixtures/harness";
import { readTerminationQuery } from "../../server/plugins/trust/provider-edi/termination-query";
import { CoverageDatabaseError, coverageDatabaseFailure } from "../../server/plugins/trust/provider-edi/coverage-database-error";
import { COVERAGE_LIMITS } from "../../server/plugins/trust/provider-edi/coverage-budget";
import { logger } from "../../server/logger";

describe("termination evidence lookup", () => {
  it("identifies the cancelled read without exposing driver messages or changing the timeout", async () => {
    const driverError = Object.assign(new Error("private SQL and person data"), { code: "57014" });
    const query = vi.fn().mockRejectedValue(driverError);
    const ctx = {
      storage: { readOnly: { query } },
      coverageCorrelation: { wizardId: "wizard", runId: "run" },
    } as unknown as TrustProviderEdiContext;
    const log = vi.spyOn(logger, "error").mockImplementation(() => logger);
    try {
      const error = await readTerminationQuery(ctx, "Reading continuation scan summaries", async () => [])
        .catch(error => error);
      expect(error).toBeInstanceOf(CoverageDatabaseError);
      expect(error.message).toContain("Reading termination evidence / Reading continuation scan summaries");
      expect(error.message).not.toContain("private SQL");
      expect(error.diagnostics).toMatchObject({ code: "57014", wizardId: "wizard", runId: "run" });
      expect(query.mock.calls[0][1]).toEqual({ statementTimeoutMs: COVERAGE_LIMITS.queryMs });
      expect(coverageDatabaseFailure(error, "Reading termination evidence", 11113)).toBe(error);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toContain("private SQL");
    } finally {
      log.mockRestore();
    }
  });

  it("preserves successful results and records per-query counts and timing", async () => {
    const rows = [{ id: "private-person-id" }];
    const ctx = {
      storage: { readOnly: { query: vi.fn().mockResolvedValue(rows) } },
    } as unknown as TrustProviderEdiContext;
    const log = vi.fn();
    const budget = { log } as unknown as import("../../server/plugins/trust/provider-edi/coverage-budget").CoverageBudget;
    expect(await readTerminationQuery(ctx, "Selecting termination events", async () => rows, budget)).toBe(rows);
    expect(log).toHaveBeenLastCalledWith("query-end", "Selecting termination events",
      { milliseconds: expect.any(Number), returnedRows: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-person-id");
  });

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
