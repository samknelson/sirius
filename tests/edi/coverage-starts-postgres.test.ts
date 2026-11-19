import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { readSegmentConflicts, readSegmentStarts } from "../../server/plugins/trust/provider-edi/coverage-starts";

// Explicit opt-in (EDI_COVERAGE_STARTS_PG=1); starts an isolated local cluster
// with no TCP listener and never reads DATABASE_URL. Requires PostgreSQL
// initdb/pg_ctl on PATH. This is where the start-date rule itself runs: the
// statement aggregates each person's run in the database.
describe.skipIf(process.env.EDI_COVERAGE_STARTS_PG !== "1")("segment start statement on real PostgreSQL", () => {
  let root: string;
  let pool: pg.Pool;
  let started = false;
  const index = (month: number) => 2026 * 12 + month - 1;
  /** One person per case, all in 2026: months as [month, employer, source relation]. */
  const people: Record<string, { restarts: number[]; months: [number, "ordinary" | "cobra", string | null][] }> = {
    continuous: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    gap: { restarts: [1, 7], months: [1, 2, 3, 4, 5, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    source: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", m < 7 ? "relation" : null]) },
    cobra: { restarts: [3], months: [3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, m < 8 ? "ordinary" : "cobra", null]) },
    conflict: { restarts: [3], months: [...[3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null] as [number, "ordinary", null]),
      [6, "cobra", null]] },
    // Conflicting in April, then a dependent source through June: the conflict lies before the segment.
    earlier: { restarts: [3], months: [...[3, 4, 5, 6, 7, 8, 9, 10].map(m => [m, "ordinary", m < 7 ? "relation" : null] as [number, "ordinary", string | null]),
      [4, "cobra", null]] },
    missing: { restarts: [], months: [9, 10].map(m => [m, "ordinary", null]) },
    behind: { restarts: [3], months: [3, 4, 6, 7, 8, 9, 10].map(m => [m, "ordinary", null]) },
    ended: { restarts: [3, 10], months: [3, 4, 5, 6, 7, 8, 10].map(m => [m, "ordinary", null]) },
  };
  const wmbId = (person: string, month: number, employer = "ordinary") => `${person}-${month}-${employer}`;
  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), "edi-starts-pg-"));
    execFileSync("initdb", ["-D", `${root}/data`, "-A", "trust", "-U", "postgres"], { stdio: "ignore" });
    execFileSync("pg_ctl", ["-D", `${root}/data`, "-l", `${root}/postgres.log`, "-o", `-k ${root} -h ''`, "-w", "start"], { stdio: "ignore" });
    started = true;
    pool = new pg.Pool({ host: root, user: "postgres", database: "postgres", max: 2 });
    await pool.query(`
      CREATE TABLE employers (id varchar PRIMARY KEY, sirius_id varchar);
      CREATE TABLE trust_wmb (id varchar PRIMARY KEY, worker_id varchar NOT NULL, benefit_id varchar NOT NULL,
        year integer NOT NULL, month integer NOT NULL, employer_id varchar NOT NULL, source_relation_id varchar);
      CREATE TABLE trust_wmb_events (id serial PRIMARY KEY, worker_id varchar NOT NULL, benefit_id varchar NOT NULL,
        year integer NOT NULL, month integer NOT NULL, event_type varchar NOT NULL);
      INSERT INTO employers VALUES ('ordinary', '100'), ('cobra', '13226164');`);
    for (const [person, { restarts, months }] of Object.entries(people)) {
      for (const [month, employer, source] of months)
        await pool.query("INSERT INTO trust_wmb VALUES ($1, $2, 'benefit', 2026, $3, $4, $5)",
          [wmbId(person, month, employer), person, month, employer, source]);
      for (const month of restarts)
        await pool.query("INSERT INTO trust_wmb_events (worker_id, benefit_id, year, month, event_type) VALUES ($1, 'benefit', 2026, $2, 'restart')", [person, month]);
      // Other benefits and other event types must not move the start.
      await pool.query("INSERT INTO trust_wmb_events (worker_id, benefit_id, year, month, event_type) VALUES ($1, 'benefit', 2026, 9, 'terminate'), ($1, 'other-benefit', 2026, 9, 'restart')", [person]);
    }
    // Coverage older than every run: read by no anchor.
    for (const person of Object.keys(people)) for (const month of [1, 2, 3, 4, 5, 6])
      await pool.query("INSERT INTO trust_wmb VALUES ($1, $2, 'benefit', 2024, $3, 'ordinary', NULL)", [`${person}-old-${month}`, person, month]);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (started) execFileSync("pg_ctl", ["-D", `${root}/data`, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  const read = async (...ids: string[]) => {
    const starts = await readSegmentStarts(drizzle(pool) as never, ids);
    return new Map(starts.map(start => [start.id, start]));
  };

  it("applies the start-date rule to each kind of history", async () => {
    const anchors = {
      continuous: wmbId("continuous", 10), gap: wmbId("gap", 10), source: wmbId("source", 10),
      cobra: wmbId("cobra", 10, "cobra"), conflict: wmbId("conflict", 10), missing: wmbId("missing", 10),
      behind: wmbId("behind", 10), earlier: wmbId("earlier", 10),
    };
    const starts = await read(...Object.values(anchors));
    expect(starts.size).toBe(8);
    expect(starts.get(anchors.continuous)).toMatchObject({ coverageStartYmd: "2026-03-01", isCobra: false, problem: null, conflictMonths: 0, conflictRecords: 0 });
    // A gap: the later restart event is the start.
    expect(starts.get(anchors.gap)).toMatchObject({ coverageStartYmd: "2026-07-01", monthsRead: 4 });
    // Dependent source through June, own coverage from July.
    expect(starts.get(anchors.source)).toMatchObject({ coverageStartYmd: "2026-07-01", isCobra: false });
    // Non-COBRA through July, COBRA from August, no gap.
    expect(starts.get(anchors.cobra)).toMatchObject({ coverageStartYmd: "2026-08-01", isCobra: true });
    // A conflicting historical month holding a record of the member's own class.
    expect(starts.get(anchors.conflict)).toMatchObject({ coverageStartYmd: "2026-03-01", conflictMonths: 1, conflictRecords: 2 });
    // A conflict before the segment start is neither counted nor read.
    expect(starts.get(anchors.earlier)).toMatchObject({ coverageStartYmd: "2026-07-01", conflictMonths: 0, conflictRecords: 0 });
    // Only the conflicting month's records come back, never the rest of the run.
    const conflicts = await readSegmentConflicts(drizzle(pool) as never,
      Object.values(anchors).filter(id => starts.get(id)!.coverageStartYmd)
        .map(id => ({ id, coverageStartYmd: starts.get(id)!.coverageStartYmd! })));
    expect(conflicts.map(c => c.id).sort()).toEqual([wmbId("conflict", 6, "cobra"), wmbId("conflict", 6)]);
    expect(conflicts[0]).toMatchObject({ workerId: "conflict", benefitId: "benefit", year: 2026, month: 6 });
    expect(starts.get(anchors.missing)).toMatchObject({ coverageStartYmd: null, problem: "missing-event" });
    expect(starts.get(anchors.behind)).toMatchObject({ coverageStartYmd: null, problem: "inconsistent-event" });
    // Nothing older than a run start was aggregated, for anyone.
    for (const start of starts.values()) expect(start.monthsBeforeRunStart).toBe(0);
    expect(starts.get(anchors.continuous)!.monthsRead).toBe(8);
  });
  it("anchors a termination candidate on their last covered month, not on later coverage", async () => {
    const starts = await read(wmbId("ended", 8), wmbId("ended", 10));
    expect(starts.get(wmbId("ended", 8))).toMatchObject({ coverageStartYmd: "2026-03-01", monthsRead: 6 });
    expect(starts.get(wmbId("ended", 10))).toMatchObject({ coverageStartYmd: "2026-10-01", monthsRead: 1 });
  });
});
