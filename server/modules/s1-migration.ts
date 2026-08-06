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
 * plus the sirius_id collision pre-scan over staged workers — the same fatal
 * gate the contacts/workers loader enforces (collisions are distinct people;
 * never merged; fund triage required).
 *
 * Everything is aggregates + staging ids (nids); no S1 record-level values
 * are returned. Gated: auth + component `sitespecific.bao.s1migration` +
 * admin access.
 */
import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "./../storage/db";
import { requireAccess } from "../services/access-policy-evaluator";
import { requireComponent } from "./components";

export const S1_MIGRATION_COMPONENT_ID = "sitespecific.bao.s1migration";

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] =>
  ((res as { rows?: Row[] }).rows ?? []) as Row[];

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
 * Staged field_sirius_id extraction, mirroring the loader's rules
 * (strOf collapses {value,...} objects and [ {value,...} ] arrays; only
 * /^\d+$/ values count as numeric).
 */
const stagedFsidCte = sql`
  WITH w AS (
    SELECT nid,
           NULLIF(TRIM(COALESCE(
             fields->'field_sirius_id'->>'value',
             fields->'field_sirius_id'->0->>'value'
           )), '') AS raw
    FROM s1_staging.records
    WHERE bundle = 'sirius_worker'
  ),
  n AS (
    SELECT nid, raw,
           CASE WHEN raw ~ '^[0-9]+$' THEN raw::bigint END AS fsid
    FROM w
  )
`;

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
    try {
      const stagingPresent = await regclassPresent("s1_staging.records");

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
        termCount = await countIfPresent("s1_staging.terms");
        rawLedgerRows = await countIfPresent("s1_staging.raw_ledger_ar");
        if (await regclassPresent("s1_staging.id_map")) {
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

      res.json({
        stagingPresent,
        bundles,
        termCount,
        rawLedgerRows,
        idMap,
        target: {
          policies: await countIfPresent("public.policies"),
          trustProviders: await countIfPresent("public.trust_providers"),
          trustBenefits: await countIfPresent("public.trust_benefits"),
          workers: await countIfPresent("public.workers"),
          contacts: await countIfPresent("public.contacts"),
        },
      });
    } catch (e) {
      console.error("s1-migration status failed:", e);
      res.status(500).json({ message: "Failed to read migration status" });
    }
  });

  // The fatal-gate pre-scan: cross-worker sirius_id collisions in staged
  // data, plus values already owned by a DIFFERENT S2 worker row. Mirrors
  // load-contacts-workers' abort conditions so operators see the stop
  // BEFORE burning the freeze window.
  app.get("/api/s1-migration/collisions", ...gates, async (_req, res) => {
    try {
      if (!(await regclassPresent("s1_staging.records"))) {
        return res.json({
          stagingPresent: false,
          stagedWorkers: 0,
          duplicates: [],
          ownershipConflicts: [],
          missingSiriusId: 0,
          nonNumericSiriusId: 0,
        });
      }

      const counts = rowsOf(
        await db.execute(sql`
          ${stagedFsidCte}
          SELECT COUNT(*)::int AS staged,
                 COUNT(*) FILTER (WHERE raw IS NULL)::int AS missing,
                 COUNT(*) FILTER (WHERE raw IS NOT NULL AND fsid IS NULL)::int AS non_numeric
          FROM n
        `),
      )[0] ?? {};

      const duplicates = rowsOf(
        await db.execute(sql`
          ${stagedFsidCte}
          SELECT fsid, array_agg(nid ORDER BY nid) AS nids
          FROM n WHERE fsid IS NOT NULL
          GROUP BY fsid HAVING COUNT(*) > 1
          ORDER BY fsid LIMIT 200
        `),
      ).map((r) => ({
        siriusId: Number(r.fsid),
        nids: (r.nids as unknown[]).map(Number),
      }));

      const idMapPresent = await regclassPresent("s1_staging.id_map");
      const workersPresent = await regclassPresent("public.workers");
      const ownershipConflicts =
        idMapPresent && workersPresent
          ? rowsOf(
              await db.execute(sql`
                ${stagedFsidCte}
                SELECT n.nid, n.fsid, wk.id AS owner_worker_id
                FROM n
                JOIN workers wk ON wk.sirius_id = n.fsid
                LEFT JOIN s1_staging.id_map m
                  ON m.entity = 'worker' AND m.s1_id = n.nid
                WHERE n.fsid IS NOT NULL
                  AND (m.s2_id IS NULL OR m.s2_id <> wk.id::text)
                ORDER BY n.fsid LIMIT 200
              `),
            ).map((r) => ({
              nid: Number(r.nid),
              siriusId: Number(r.fsid),
              ownerWorkerId: String(r.owner_worker_id),
            }))
          : [];

      res.json({
        stagingPresent: true,
        stagedWorkers: Number(counts.staged ?? 0),
        duplicates,
        ownershipConflicts,
        missingSiriusId: Number(counts.missing ?? 0),
        nonNumericSiriusId: Number(counts.non_numeric ?? 0),
      });
    } catch (e) {
      console.error("s1-migration collisions failed:", e);
      res.status(500).json({ message: "Failed to run collision pre-scan" });
    }
  });

  // Run history: stage runs, loader runs (rejects/rejectSamples/verify
  // counters), and parity harness results — whatever recordRun persisted.
  app.get("/api/s1-migration/runs", ...gates, async (req, res) => {
    try {
      if (!(await regclassPresent("s1_staging.runs"))) {
        return res.json({ stagingPresent: false, runs: [] });
      }
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const runs = rowsOf(
        await db.execute(sql`
          SELECT id, started_at, finished_at, args, report
          FROM s1_staging.runs ORDER BY id DESC LIMIT ${limit}
        `),
      ).map((r) => ({
        id: Number(r.id),
        startedAt: String(r.started_at),
        finishedAt: String(r.finished_at),
        args: sanitizeRunJson(r.args ?? {}) as Record<string, unknown>,
        report: sanitizeRunJson(r.report ?? {}) as Record<string, unknown>,
      }));
      res.json({ stagingPresent: true, runs });
    } catch (e) {
      console.error("s1-migration runs failed:", e);
      res.status(500).json({ message: "Failed to read run history" });
    }
  });
}
