import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getEnvironmentVariable } from "../../server/config/env-registry";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), components: null as Record<string, boolean> | null }));
vi.mock("../../server/storage/transaction-context", () => ({ getClient: () => ({ execute: mocks.execute }), onAfterCommit: vi.fn() }));
vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: (id: string) => mocks.components?.[id] ?? (mocks.components === null) }));
vi.mock("../../server/services/event-bus", () => ({ eventBus: {}, EventType: {} }));
vi.mock("../../server/storage/system/entity-metadata-order", () => ({ provenanceCreatedDate: vi.fn() }));
vi.mock("../../server/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { workerCommsDefinitionSchema, type BenefitPeriod, type WorkerCommsDefinition } from "../../shared/worker-comms-compliance";
import { createWorkerCommsComplianceStorage } from "../../server/storage/worker-comms-compliance";

const databaseUrl = getEnvironmentVariable("DATABASE_URL");
const localDevDatabase = databaseUrl && ["helium", "localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname);
describe.skipIf(!localDevDatabase || getEnvironmentVariable("NODE_ENV") === "production")("benefit-history SQL integration", () => {
  it("runs options and report SQL against the real development schema without writing data", async () => {
    const { db } = await import("../../server/storage/db");
    await db.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET LOCAL statement_timeout = '20s'`);
      const result = await tx.execute(sql`SELECT value FROM variables WHERE name = 'components'`);
      mocks.components = (result.rows[0]?.value ?? {}) as Record<string, boolean>;
      mocks.execute.mockImplementation(query => tx.execute(query));
      const storage = createWorkerCommsComplianceStorage();
      const options = await storage.options();
      const definition = { ...workerCommsDefinitionSchema.parse({
        name: "Compatibility probe", population: {}, commTagId: "__nonexistent_compatibility_tag__", statuses: ["delivered"],
      }), id: "compatibility" };
      const report = await storage.report(definition, "all", 1, 1);
      expect(report.counts.with + report.counts.without).toBe(report.counts.population);
      expect(report.counts.with).toBe(0);
      expect(options.tags).toBeInstanceOf(Array);
    });
    mocks.components = null;
  });
  it("matches real month rows and keeps report counts, evidence and bulk recipients aligned", async () => {
    const { db, pool } = await import("../../server/storage/db");
    const rollback = new Error("rollback isolated fixture");
    try {
      await db.transaction(async tx => {
        // Temporary tables shadow app tables only on this transaction's own
        // connection; no fixtures, logs or provenance reach persistent data.
        for (const ddl of [
          "contacts(id text, display_name text)",
          "workers(id text, contact_id text, sirius_id int)",
          "trust_wmb(worker_id text, benefit_id text, year int, month int)",
          "comm(id text, contact_id text, status text, medium text, sent timestamp)",
          "comm_tags(comm_id text, comm_tag_id text)",
        ]) await tx.execute(sql.raw(`CREATE TEMP TABLE ${ddl} ON COMMIT DROP`));
        await tx.execute(sql`INSERT INTO workers VALUES
          ('old','c-old',1),('range','c-range',2),('future','c-future',3),('recent','c-recent',4),
          ('wrong','c-wrong',5),('boundary','c-boundary',6),('outside','c-outside',7),('current','c-current',8)`);
        await tx.execute(sql`INSERT INTO contacts SELECT contact_id,id FROM workers`);
        await tx.execute(sql`INSERT INTO trust_wmb VALUES
          ('old','legal',2024,1),('range','legal',2025,1),('range','legal',2025,12),
          ('future','legal',2027,1),('recent','legal',2026,9),('wrong','other',2025,8),
          ('boundary','legal',2026,5),('outside','legal',2026,4),('current','legal',2026,10)`);
        await tx.execute(sql`INSERT INTO comm VALUES
          ('e-range','c-range','offline','postal','2026-10-10'),('e-recent','c-recent','offline','postal','2026-10-10')`);
        await tx.execute(sql`INSERT INTO comm_tags VALUES ('e-range','spd'),('e-recent','spd')`);
        mocks.execute.mockImplementation(query => tx.execute(query));
        const storage = createWorkerCommsComplianceStorage();
        const makeDefinition = (benefitPeriod?: BenefitPeriod, benefitIds = ["legal"]): WorkerCommsDefinition => ({
          ...workerCommsDefinitionSchema.parse({ name: "SPD", population: { benefitIds, benefitPeriod },
            commTagId: "spd", statuses: ["offline"], sentFrom: "2026-10-01", sentThrough: "2026-10-31" }), id: "test",
        });
        for (const [period, expected, matched] of [
          [undefined, ["current"], []],
          [{ mode: "ever" }, ["old", "range", "recent", "boundary", "outside", "current"], ["range", "recent"]],
          [{ mode: "lookback", months: 6 }, ["recent", "boundary", "current"], ["recent"]],
          [{ mode: "lookback", months: 1 }, ["current"], []],
          [{ mode: "range", from: "2025-01-01", through: "2025-12-31" }, ["range"], ["range"]],
          [{ mode: "range", from: "2025-01-15", through: "2025-01-31" }, ["range"], ["range"]],
        ] as [BenefitPeriod | undefined, string[], string[]][]) {
          const definition = makeDefinition(period);
          const report = await storage.report(definition, "all", 1, 100, "2026-10");
          expect(report.rows.map(row => row.workerId).sort()).toEqual([...expected].sort());
          expect(report.counts).toEqual({ population: expected.length, with: matched.length, without: expected.length - matched.length });
          const all = await storage.contacts(definition, "all", "2026-10");
          const withComm = await storage.contacts(definition, "with", "2026-10");
          const without = await storage.contacts(definition, "without", "2026-10");
          expect(all.sort()).toEqual(expected.map(id => `c-${id}`).sort());
          expect(withComm.sort()).toEqual(matched.map(id => `c-${id}`).sort());
          expect(without.sort()).toEqual(expected.filter(id => !matched.includes(id)).map(id => `c-${id}`).sort());
        }
        const multiple = await storage.report(makeDefinition({ mode: "range", from: "2025-01-01", through: "2025-12-31" }, ["legal", "other"]), "all", 1, 100, "2026-10");
        expect(multiple.rows.map(row => row.workerId).sort()).toEqual(["range", "wrong"]);
        const unrestricted = await storage.report(makeDefinition({ mode: "lookback", months: 1 }, []), "all", 1, 100, "2026-10");
        expect(unrestricted.counts.population).toBe(8);
        expect(unrestricted.benefitPeriod?.mode).toBe("all");
        throw rollback;
      }).catch(error => { if (error !== rollback) throw error; });
    } finally {
      await pool.end();
    }
  });
});
