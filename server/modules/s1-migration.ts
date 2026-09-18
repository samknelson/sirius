/**
 * S1 → S2 migration dashboard routes (read-only).
 *
 * Pre-flight and results observability for the S1 migration
 * (scripts/s1-migration/RUNBOOK.md). Execution deliberately does NOT live
 * here — the load runs as a CLI one-off task inside the HIPAA boundary with
 * app traffic stopped; this module only reads:
 *   - s1_staging.records / terms / raw_ledger_ar (staging mirror status)
 *   - s1_staging.runs (loader / harness / stage reports incl. rejects, parity)
 *   - s1_staging.id_map (per-entity load progress)
 *   - a handful of aggregate target-table counts (readiness checks)
 * plus the read-only Sirius-ID ownership plan over staged workers — the same
 * pre-write decision the contacts/workers loader enforces. It distinguishes
 * repairable generated allocations from source/mapping blockers and never
 * equates people merely because their numbers match.
 *
 * Everything is aggregates + staging ids (nids); no S1 record-level values
 * are returned. Gated: auth + component `sitespecific.bao.s1migration` +
 * admin access.
 */
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "./../storage/db";
import { storage } from "../storage/database";
import {
  planSiriusIdOwnership,
} from "../storage/workers/sirius-id-ownership-plan";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";
import { projectSiriusIdOwnershipDashboard } from "./s1-migration-dashboard";

export const S1_MIGRATION_COMPONENT_ID = "sitespecific.bao.s1migration";

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] =>
  ((res as { rows?: Row[] }).rows ?? []) as Row[];
const phaseMs = (started: number) => Math.max(0, Math.round(performance.now() - started));

/** Coalesce only work currently in flight; resolved values are never cached. */
export function createInFlightCoalescer<T>() {
  let inFlight: Promise<T> | null = null;
  return (factory: () => Promise<T>): Promise<T> => {
    if (inFlight) return inFlight;
    inFlight = factory().finally(() => { inFlight = null; });
    return inFlight;
  };
}

// This is deliberately a promise, rather than a result cache: requests that
// arrive together share one consistent pre-flight, while a later request
// always observes the current database.
const ownershipPreflight = createInFlightCoalescer<ReturnType<typeof projectSiriusIdOwnershipDashboard>>();

async function regclassPresent(qualified: string): Promise<boolean> {
  const res = await db.execute(
    sql`SELECT to_regclass(${qualified}) IS NOT NULL AS present`,
  );
  return Boolean(rowsOf(res)[0]?.present);
}

/** COUNT(*) of a table, or null when the table doesn't exist (optional
 *  component tables / staging not yet created). Table names are from a
 *  fixed internal list — never user input. */
async function countIfPresent(qualified: string): Promise<number | null> {
  if (!(await regclassPresent(qualified))) return null;
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM ${sql.raw(qualified)}`,
  );
  return Number(rowsOf(res)[0]?.n ?? 0);
}

/**
 * Defense-in-depth redaction for run args/report jsonb before it leaves the
 * server. Reports are aggregate-only by design (counters, reason codes,
 * nid/uid samples), but recordRun accepts arbitrary JSON and some harnesses
 * persist raw argv — so we cannot rely on convention alone. This pass:
 *   - redacts values under credential-ish keys (password/secret/token/dsn/…)
 *   - redacts strings that look like URLs/DSNs, emails, or dashed SSNs
 *   - truncates very long strings (free text has no place in a report)
 *   - caps depth/breadth so a pathological report can't flood the response
 */
const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|credential|dsn|connection|conn_str|authorization|cookie|apikey|api_key|private)/i;
const URLISH_RE = /[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const MAX_STRING = 300;
const MAX_DEPTH = 8;
const MAX_KEYS = 200;
const MAX_ARRAY = 100;

function sanitizeRunJson(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth capped]";
  if (typeof value === "string") {
    if (URLISH_RE.test(value) || EMAIL_RE.test(value) || SSN_RE.test(value)) {
      return "[redacted]";
    }
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => sanitizeRunJson(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[${value.length - MAX_ARRAY} more]`);
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (++n > MAX_KEYS) {
        out["…"] = "[keys capped]";
        break;
      }
      out[k] = SENSITIVE_KEY_RE.test(k) || k === "argv"
        ? "[redacted]"
        : sanitizeRunJson(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function registerS1MigrationRoutes(app: Express, requireAuth: RequestHandler) {
  const gates: RequestHandler[] = [
    requireAuth,
    requireComponent(S1_MIGRATION_COMPONENT_ID),
    requireAccess("admin"),
  ];

  // Staging mirror + target readiness aggregates.
  app.get("/api/s1-migration/status", ...gates, async (_req, res) => {
    const started = performance.now();
    try {
      const statusPhase = performance.now();
      const [stagingPresent, idMapPresent] = await Promise.all([
        regclassPresent("s1_staging.records"),
        regclassPresent("s1_staging.id_map"),
      ]);

      let bundles: Array<{ bundle: string; rows: number; lastExtractedAt: string | null }> = [];
      let termCount: number | null = null;
      let rawLedgerRows: number | null = null;
      let idMap: Array<{ entity: string; loader: string; rows: number; stubs: number }> = [];

      if (stagingPresent) {
        bundles = rowsOf(
          await db.execute(sql`
            SELECT bundle, COUNT(*)::int AS rows, MAX(extracted_at) AS last_extracted_at
            FROM s1_staging.records GROUP BY bundle ORDER BY bundle
          `),
        ).map((r) => ({
          bundle: String(r.bundle),
          rows: Number(r.rows),
          lastExtractedAt: r.last_extracted_at ? String(r.last_extracted_at) : null,
        }));
        [termCount, rawLedgerRows] = await Promise.all([
          countIfPresent("s1_staging.terms"),
          countIfPresent("s1_staging.raw_ledger_ar"),
        ]);
        if (idMapPresent) {
          idMap = rowsOf(
            await db.execute(sql`
              SELECT entity, loader, COUNT(*)::int AS rows, SUM(stub::int)::int AS stubs
              FROM s1_staging.id_map GROUP BY entity, loader ORDER BY entity, loader
            `),
          ).map((r) => ({
            entity: String(r.entity),
            loader: String(r.loader),
            rows: Number(r.rows),
            stubs: Number(r.stubs ?? 0),
          }));
        }
      }

      const targetStarted = performance.now();
      const [policies, trustProviders, trustBenefits, workers, contacts] = await Promise.all([
        countIfPresent("public.policies"),
        countIfPresent("public.trust_providers"),
        countIfPresent("public.trust_benefits"),
        countIfPresent("public.workers"),
        countIfPresent("public.contacts"),
      ]);
      res.json({
        stagingPresent,
        bundles,
        termCount,
        rawLedgerRows,
        idMap,
        target: {
          policies, trustProviders, trustBenefits, workers, contacts,
        },
        timings: {
          statusMs: phaseMs(statusPhase),
          targetMs: phaseMs(targetStarted),
          totalMs: phaseMs(started),
        },
      });
      console.info("s1-migration status timing", {
        statusMs: phaseMs(statusPhase),
        targetMs: phaseMs(targetStarted),
        totalMs: phaseMs(started),
      });
    } catch (e) {
      console.error("s1-migration status failed:", e);
      res.status(500).json({ message: "Failed to read migration status" });
    }
  });

  // Read-only ownership planning for the fatal pre-write gate.  This calls
  // the same id_map-based planner as the CLI diagnostic and contacts/workers
  // loader — a numeric match is never taken as evidence two people are same.
  app.get("/api/s1-migration/collisions", ...gates, async (_req, res) => {
    try {
      const started = performance.now();
      const result = await ownershipPreflight(async () => {
          const snapshotStarted = performance.now();
          const snapshot = await storage.workers.getMigrationSiriusIdOwnershipSnapshot();
          const snapshotMs = phaseMs(snapshotStarted);
          if (!snapshot.stagingPresent) {
            const timings = { snapshotMs, plannerMs: 0, projectionMs: 0, totalMs: phaseMs(started) };
            console.info("s1-migration ownership timing", timings);
            return { ...projectSiriusIdOwnershipDashboard(snapshot, null), timings };
          }
          const plannerStarted = performance.now();
          const plan = planSiriusIdOwnership(snapshot);
          const plannerMs = phaseMs(plannerStarted);
          const projectionStarted = performance.now();
          const projected = projectSiriusIdOwnershipDashboard(snapshot, plan);
          const timings = { snapshotMs, plannerMs, projectionMs: phaseMs(projectionStarted), totalMs: phaseMs(started) };
          console.info("s1-migration ownership timing", timings);
          return { ...projected, timings };
      });
      res.json(result);
    } catch (e) {
      console.error("s1-migration ownership plan failed:", e);
      res.status(500).json({ message: "Failed to read Sirius ID ownership plan" });
    }
  });

  // Run history: stage runs, loader runs (rejects/rejectSamples/verify
  // counters), and parity harness results — whatever recordRun persisted.
  app.get("/api/s1-migration/runs", ...gates, async (req, res) => {
    const started = performance.now();
    try {
      if (!(await regclassPresent("s1_staging.runs"))) {
        return res.json({ stagingPresent: false, runs: [], timings: { databaseMs: phaseMs(started), shapingMs: 0, totalMs: phaseMs(started) } });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const databaseStarted = performance.now();
      const result = await db.execute(sql`
           SELECT id, started_at, finished_at, args, report
           FROM s1_staging.runs ORDER BY id DESC LIMIT ${limit}
         `);
      const databaseMs = phaseMs(databaseStarted);
      const runs = rowsOf(
        result,
      ).map((r) => ({
        id: Number(r.id),
        startedAt: String(r.started_at),
        finishedAt: String(r.finished_at),
        args: sanitizeRunJson(r.args ?? {}) as Record<string, unknown>,
        report: sanitizeRunJson(r.report ?? {}) as Record<string, unknown>,
      }));
      const timings = { databaseMs, shapingMs: Math.max(0, phaseMs(started) - databaseMs), totalMs: phaseMs(started) };
      res.json({ stagingPresent: true, runs, timings });
      console.info("s1-migration runs timing", timings);
    } catch (e) {
      console.error("s1-migration runs failed:", e);
      res.status(500).json({ message: "Failed to read run history" });
    }
  });
}
