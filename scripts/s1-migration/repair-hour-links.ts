/**
 * ONE-TIME repair — link already-imported S1 hours-charge ledger rows to
 * their S2 monthly worker_hours rows, and reconcile post-migration duplicate
 * BAO hourly charges (Task 414).
 *
 * WHY THIS EXISTS: early initial loads ran t18-ledger BEFORE t20-hours, so
 * AR rows whose S1 `ledger_reference` targets a `sirius_payperiod` nid could
 * not resolve — they were imported with reference_type='s1-unknown' and the
 * raw nid preserved in data.s1ReferenceNid. The permanent fix is the fleet
 * order payments → hours → ledger plus the t20-maintained id_map `payperiod`
 * crosswalk (nid → worker_hours.id); this command repairs data imported in
 * the old order. It is NOT part of any load or sync fleet and must never be
 * added to one.
 *
 * WHAT IT DOES (three sections, all aggregate-only output — no nids, worker
 * names, or amounts are printed for individual rows):
 *   1. profile   — classify every s1-import AR reference nid by its staged
 *                  bundle, and report the current reference_type mix.
 *   2. link      — for rows whose reference nid is a staged sirius_payperiod:
 *                  resolve via the crosswalk, VALIDATE the target hours row
 *                  against the staged payperiod (worker + employer via
 *                  id_map, start month), then repoint reference_type='hour' /
 *                  reference_id. Unsafe matches are REFUSED and counted
 *                  (unresolved / ambiguous / mismatch), never guessed.
 *   3. duplicates— for hours rows that now carry BOTH linked s1-import
 *                  history AND post-migration native bao-hourly entries on
 *                  the same billed account: re-run the bao-hourly plugin
 *                  (which, since Task 414, counts linked imported history in
 *                  its net total) and post its single correcting adjustment.
 *
 * IDEMPOTENT: already-linked rows count as alreadyLinked and are skipped;
 * the plugin's |delta| < 0.005 no-op makes duplicate reruns money-neutral.
 * Historical rows keep chargePlugin='s1-import' and data.s1ReferenceNid, so
 * they remain identifiable as S1 facts after linking.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/repair-hour-links.ts            # dry run
 *   npx tsx scripts/s1-migration/repair-hour-links.ts --wet      # apply
 *   npx tsx scripts/s1-migration/repair-hour-links.ts --skip-duplicates
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import {
  withNotificationsSuppressed,
} from "../../server/middleware/request-context";
import {
  mergeEnabledChargeConfigs,
  toChargeConfig,
} from "../../server/plugins/ledger/charge/charge-config-resolution";
import { toRepairLedgerInsert } from "./lib/repair-hour-links-persist";
import { baoHourlyChargePlugin } from "../../server/plugins/ledger/charge/plugins/sitespecific-bao-hourly";
import {
  TriggerType,
  type HoursSavedContext,
  type LedgerTransaction,
} from "../../server/plugins/ledger/charge/types";

const WET = process.argv.includes("--wet");
const SKIP_DUPLICATES = process.argv.includes("--skip-duplicates");
const CHARGE_PLUGIN = "s1-import";
const PAGE = 5000;

const rowsOf = <T = Record<string, any>>(r: unknown) =>
  (r as { rows: T[] }).rows;

function asScalarRef(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "number") return v[0];
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** First-7-chars wall-time month, matching t20's yearMonthOf. */
function ymOf(v: unknown): { year: number; month: number } | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}/.test(v)) return null;
  const year = Number(v.slice(0, 4));
  const month = Number(v.slice(5, 7));
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}

// ---------------------------------------------------------------------------
// Section 1 — aggregate profiling (step 1 of the plan): classify s1-import
// AR reference nids by staged bundle; report current reference_type mix.
// ---------------------------------------------------------------------------
async function profile(): Promise<void> {
  console.log("== profile: s1-import AR reference classification (aggregates only) ==");
  const byBundle = rowsOf(await db.execute(sql`
    SELECT coalesce(r.bundle, 'NOT_STAGED') AS bundle,
           l.reference_type, count(*)::int AS n
      FROM ledger l
      LEFT JOIN s1_staging.records r ON r.nid = (l.data->>'s1ReferenceNid')::bigint
     WHERE l.charge_plugin = ${CHARGE_PLUGIN}
       AND l.charge_plugin_key ~ '^ar-[0-9]+$'
       AND l.data->>'s1ReferenceNid' IS NOT NULL
     GROUP BY 1, 2 ORDER BY 1, 2
  `));
  for (const r of byBundle) {
    console.log(`  bundle=${r.bundle} reference_type=${r.reference_type}: ${r.n}`);
  }
  const noRef = rowsOf(await db.execute(sql`
    SELECT count(*)::int AS n FROM ledger
     WHERE charge_plugin = ${CHARGE_PLUGIN} AND charge_plugin_key ~ '^ar-[0-9]+$'
       AND data->>'s1ReferenceNid' IS NULL
  `))[0];
  console.log(`  (no stored reference nid: ${noRef.n})`);
}

// ---------------------------------------------------------------------------
// Section 2 — link pay-period references to worker_hours via the crosswalk.
// ---------------------------------------------------------------------------
interface LinkCounts {
  candidates: number;
  alreadyLinked: number;
  linked: number;
  relinked: number; // was linked to a DIFFERENT hours row — repointed
  unresolved: number; // no crosswalk mapping for the nid
  ambiguous: number; // staged payperiod unusable for validation (can't prove the match)
  refusedMismatch: number; // crosswalk target contradicts staged worker/employer/month
  refusedMissingHours: number; // crosswalk points at a vanished hours row
  updateFailed: number;
}

async function linkSection(): Promise<LinkCounts> {
  console.log(`== link: pay-period references → worker_hours (${WET ? "WET" : "DRY RUN"}) ==`);
  const c: LinkCounts = {
    candidates: 0, alreadyLinked: 0, linked: 0, relinked: 0, unresolved: 0,
    ambiguous: 0, refusedMismatch: 0, refusedMissingHours: 0, updateFailed: 0,
  };

  let lastKey = "";
  for (;;) {
    const page = rowsOf<{
      id: string; k: string; ref_nid: string | number;
      reference_type: string | null; reference_id: string | null;
      fields: unknown;
    }>(await db.execute(sql`
      SELECT l.id, l.charge_plugin_key AS k, (l.data->>'s1ReferenceNid')::bigint AS ref_nid,
             l.reference_type, l.reference_id, r.fields
        FROM ledger l
        JOIN s1_staging.records r
          ON r.nid = (l.data->>'s1ReferenceNid')::bigint AND r.bundle = 'sirius_payperiod'
       WHERE l.charge_plugin = ${CHARGE_PLUGIN}
         AND l.charge_plugin_key ~ '^ar-[0-9]+$'
         AND l.data->>'s1ReferenceNid' IS NOT NULL
         AND l.charge_plugin_key > ${lastKey}
       ORDER BY l.charge_plugin_key LIMIT ${PAGE}
    `));
    if (page.length === 0) break;
    lastKey = page[page.length - 1].k;
    c.candidates += page.length;

    const nids = [...new Set(page.map((r) => Number(r.ref_nid)))];
    const crosswalk = await getMappings("payperiod", nids);

    // Batch-resolve validation context: staged worker/employer nids → S2 ids.
    const workerNids = new Set<number>();
    const employerNids = new Set<number>();
    const parsed = new Map<string, { workerNid: number | null; employerNid: number | null; ym: { year: number; month: number } | null }>();
    for (const row of page) {
      const fields = typeof row.fields === "string" ? JSON.parse(row.fields) : (row.fields as Record<string, unknown>);
      const workerNid = asScalarRef(fields?.["field_sirius_worker"]);
      const employerNid = asScalarRef(fields?.["field_grievance_shop"]);
      const ym = ymOf(fields?.["field_sirius_date_start"]);
      if (workerNid != null) workerNids.add(workerNid);
      if (employerNid != null) employerNids.add(employerNid);
      parsed.set(row.id, { workerNid, employerNid, ym });
    }
    const [workerMap, shellWorkerMap, employerMap] = await Promise.all([
      getMappings("worker", [...workerNids]),
      getMappings("shell-worker", [...workerNids]),
      getMappings("employer", [...employerNids]),
    ]);

    // Batch-load target hours rows.
    const hoursIds = [...new Set([...crosswalk.values()].map((m) => m.s2Id))];
    const hoursById = new Map<string, { worker_id: string; employer_id: string; year: number; month: number }>();
    for (let i = 0; i < hoursIds.length; i += 500) {
      const slice = hoursIds.slice(i, i + 500);
      for (const h of rowsOf<{ id: string; worker_id: string; employer_id: string; year: number; month: number }>(await db.execute(sql`
        SELECT id, worker_id, employer_id, year, month FROM worker_hours
         WHERE id IN (${sql.join(slice.map((id) => sql`${id}`), sql`, `)})
      `))) {
        hoursById.set(h.id, h);
      }
    }

    for (const row of page) {
      const nid = Number(row.ref_nid);
      const hit = crosswalk.get(nid);
      if (!hit) { c.unresolved++; continue; }
      if (row.reference_type === "hour" && row.reference_id === hit.s2Id) {
        c.alreadyLinked++;
        continue;
      }
      const hours = hoursById.get(hit.s2Id);
      if (!hours) { c.refusedMissingHours++; continue; }

      // Safety validation: the staged payperiod's worker, employer, and start
      // month must agree with the crosswalk's target hours row. A payperiod
      // we cannot parse or whose participants don't map is AMBIGUOUS —
      // refused, never guessed.
      const p = parsed.get(row.id)!;
      const s2Worker = p.workerNid != null
        ? (workerMap.get(p.workerNid)?.s2Id ?? shellWorkerMap.get(p.workerNid)?.s2Id)
        : undefined;
      const s2Employer = p.employerNid != null ? employerMap.get(p.employerNid)?.s2Id : undefined;
      if (!s2Worker || !s2Employer || !p.ym) { c.ambiguous++; continue; }
      if (
        hours.worker_id !== s2Worker ||
        hours.employer_id !== s2Employer ||
        hours.year !== p.ym.year ||
        hours.month !== p.ym.month
      ) {
        c.refusedMismatch++;
        continue;
      }

      const repoint = row.reference_type === "hour"; // linked, but to a stale row
      if (WET) {
        try {
          await db.execute(sql`
            UPDATE ledger SET reference_type = 'hour', reference_id = ${hit.s2Id}
             WHERE id = ${row.id} AND charge_plugin = ${CHARGE_PLUGIN}
          `);
        } catch {
          c.updateFailed++;
          continue;
        }
      }
      if (repoint) c.relinked++; else c.linked++;
    }
  }

  console.log(
    `  candidates=${c.candidates} alreadyLinked=${c.alreadyLinked} ` +
    `linked=${c.linked} relinked=${c.relinked} unresolved=${c.unresolved} ` +
    `ambiguous=${c.ambiguous} refusedMismatch=${c.refusedMismatch} ` +
    `refusedMissingHours=${c.refusedMissingHours} updateFailed=${c.updateFailed}` +
    (WET ? "" : "  (dry run — nothing written)"),
  );
  return c;
}

// ---------------------------------------------------------------------------
// Section 3 — duplicate-charge reconciliation. Hours rows carrying BOTH
// linked s1-import history AND native bao-hourly entries on the same billed
// account get ONE auditable correcting adjustment, produced by the plugin
// itself (its net-total reconcile now includes imported history). Reruns:
// the plugin's near-zero-delta no-op means no further money movement.
// ---------------------------------------------------------------------------
interface DupCounts {
  affectedPairs: number;
  adjustmentsPlanned: number;
  adjustmentsCreated: number;
  noopAlreadyReconciled: number;
  pluginFailures: number;
}

async function duplicateSection(): Promise<DupCounts> {
  console.log(`== duplicates: imported + native bao-hourly on the same hours row (${WET ? "WET" : "DRY RUN"}) ==`);
  const c: DupCounts = {
    affectedPairs: 0, adjustmentsPlanned: 0, adjustmentsCreated: 0,
    noopAlreadyReconciled: 0, pluginFailures: 0,
  };

  // Distinct (hours row, config) pairs where linked imported history coexists
  // with native bao-hourly entries billed to the same EA.
  const pairs = rowsOf<{ hours_id: string; config_id: string }>(await db.execute(sql`
    SELECT DISTINCT n.reference_id AS hours_id, n.charge_plugin_config_id AS config_id
      FROM ledger n
      JOIN ledger i
        ON i.reference_type = 'hour' AND i.reference_id = n.reference_id
       AND i.charge_plugin = ${CHARGE_PLUGIN} AND i.ea_id = n.ea_id
     WHERE n.charge_plugin = 'bao-hourly'
       AND n.reference_type IN ('hour', 'hour_adjustment')
       AND n.charge_plugin_config_id IS NOT NULL
  `));
  c.affectedPairs = pairs.length;

  if (pairs.length === 0 || SKIP_DUPLICATES) {
    if (SKIP_DUPLICATES) console.log("  (skipped via --skip-duplicates)");
    else console.log("  no affected pairs");
    return c;
  }

  const hoursIds = [...new Set(pairs.map((p) => p.hours_id))];
  const hoursById = new Map<string, any>();
  for (let i = 0; i < hoursIds.length; i += 500) {
    const slice = hoursIds.slice(i, i + 500);
    for (const h of rowsOf(await db.execute(sql`
      SELECT id, worker_id, employer_id, year, month, day, hours, home, employment_status_id
        FROM worker_hours WHERE id IN (${sql.join(slice.map((id) => sql`${id}`), sql`, `)})
    `))) {
      hoursById.set(h.id, h);
    }
  }

  // Resolve each config through the SAME global/employer merge the executor
  // uses, so a superseded global config is never re-run against an employer
  // that has an override.
  const configCache = new Map<string, Map<string, ReturnType<typeof toChargeConfig>>>();
  const mergedConfigsFor = async (employerId: string) => {
    if (!configCache.has(employerId)) {
      const globals = (await storage.pluginConfigs.search("charge", {
        pluginId: "bao-hourly", enabled: true, scope: "global",
      })).map(toChargeConfig);
      const emps = (await storage.pluginConfigs.search("charge", {
        pluginId: "bao-hourly", enabled: true, scope: "employer", employerId,
      })).map(toChargeConfig);
      const merged = mergeEnabledChargeConfigs(globals, emps);
      configCache.set(employerId, new Map(merged.map((m) => [m.id, m])));
    }
    return configCache.get(employerId)!;
  };

  if (!WET) {
    // The plugin's execute() has side effects beyond its returned
    // transactions (its no-longer-qualifying branch DELETES entries), so a
    // dry run must not invoke it — report the affected pairs only.
    console.log(
      `  affectedPairs=${c.affectedPairs} (dry run — plugin reconcile deferred to --wet; ` +
      `each pair gets at most one correcting adjustment)`,
    );
    return c;
  }

  for (const pair of pairs) {
    const h = hoursById.get(pair.hours_id);
    if (!h) continue; // hours row vanished — nothing safe to reconcile
    const merged = await mergedConfigsFor(h.employer_id);
    const config = merged.get(pair.config_id);
    if (!config) continue; // config disabled/superseded — do not move money

    const context: HoursSavedContext = {
      trigger: TriggerType.HOURS_SAVED,
      hoursId: h.id,
      workerId: h.worker_id,
      employerId: h.employer_id,
      year: h.year,
      month: h.month,
      day: h.day ?? 1,
      hours: h.hours ?? 0,
      employmentStatusId: h.employment_status_id,
      home: !!h.home,
    };

    const result = await baoHourlyChargePlugin.execute(context, config);
    if (!result.success) { c.pluginFailures++; continue; }
    if (result.transactions.length === 0) { c.noopAlreadyReconciled++; continue; }
    c.adjustmentsPlanned += result.transactions.length;

    for (const t of result.transactions as LedgerTransaction[]) {
      const ea = await storage.ledger.ea.getOrCreate(t.entityType, t.entityId, t.accountId);
      // Historical correction: the mapping (lib/repair-hour-links-persist.ts)
      // carries the plugin's transactionDate (the affected work month) as
      // the ledger date — never the repair's execution date.
      await storage.ledger.entries.create(toRepairLedgerInsert(t, ea.id));
      c.adjustmentsCreated++;
    }
  }

  console.log(
    `  affectedPairs=${c.affectedPairs} adjustmentsPlanned=${c.adjustmentsPlanned} ` +
    `adjustmentsCreated=${c.adjustmentsCreated} noopAlreadyReconciled=${c.noopAlreadyReconciled} ` +
    `pluginFailures=${c.pluginFailures}` + (WET ? "" : "  (dry run — nothing written)"),
  );
  return c;
}

async function main() {
  console.log(`repair-hour-links — ${WET ? "WET RUN" : "DRY RUN (pass --wet to apply)"}`);
  await ensureStagingSchema();
  await ensureIdMap();

  await profile();
  const link = await linkSection();
  const dup = await withNotificationsSuppressed(() => duplicateSection());

  const report = { wet: WET, link, duplicates: dup };
  console.log(`REPORT ${JSON.stringify(report)}`);
  if (link.updateFailed > 0 || dup.pluginFailures > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("repair-hour-links failed:", err);
    process.exit(1);
  });
