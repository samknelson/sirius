/**
 * N21 loader — sirius_log MSR call-reason rows → comm + comm_interaction.
 * Closes N21 (Option A, 06 §N21): S2 gets a structured member-interaction
 * record (reason × channel) and the hand-built MSR call-reason rows in S1's
 * `sirius_log` (~12k rows) migrate into it. Everything else about
 * `sirius_log` keeps its Q29 disposition (SMS types → T26, remainder cold
 * archive).
 *
 * Scope: staged `sirius_log` rows whose normalized (TRIM/LOWER)
 * `field_sirius_type` is in the MSR reason map below. All other types are
 * out of scope and silently skipped (they are NOT rejects — they belong to
 * other dispositions).
 *
 * Resolution:
 *   - reason: normalized type → seeded options_call_reason.sirius_id
 *     (aliases like "kaiser issues" fold into "mlk issues"); resolved at
 *     start, fail loud if a seeded reason is missing.
 *   - channel: normalized `field_sirius_category` → interaction channel;
 *     unmapped categories reject as `category_unmapped`.
 *   - contact: `field_sirius_log_handler` targets (multi) through
 *     s1_staging.id_map entity "contact" — first resolvable target wins;
 *     none resolvable rejects as `handler_unresolved`, no handler at all as
 *     `handler_missing`.
 *   - notes: field_sirius_summary + field_sirius_notes (concatenated).
 *   - timestamp: node `created` epoch → comm.sent.
 *   - provenance: original type/category/nid preserved in
 *     comm_interaction.data.s1.
 *
 * Idempotent via id_map entity "call_log" (nid → comm id); mapped rows are
 * skipped on rerun.
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report).
 *
 * Pass --migration-mode to run every write inside a charge-plugin-suppressed
 * scope (loader convention); notification suppression always applies.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-call-logs.ts [--dry-run] [--allow-rejects r1,r2] [--migration-mode]
 *
 * Output is AGGREGATES ONLY (plus S1 nids, which are opaque ids). Note and
 * summary content is NEVER logged.
 */
import { db } from "../../server/storage/db";
// IMPORTANT: initialize the storage barrel BEFORE importing ./comm directly —
// importing comm.ts first creates a partial-init cycle (database.ts reads
// commLoggingConfig mid-initialization → TDZ ReferenceError at module load).
import "../../server/storage/database";
import { sql } from "drizzle-orm";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping } from "./lib/idmap";
import { RejectLog, strOf, throttleStorageOpLogs } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import { createCommInteractionStorage } from "../../server/storage/comm";

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "n21-call-logs";
const ID_MAP_ENTITY = "call_log";

function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

/** All reasons are row-skipping (fatal) — the verify pass skips exactly these. */
const FATAL_REASONS = [
  "handler_missing",
  "handler_unresolved",
  "category_missing",
  "category_unmapped",
  "create_failed",
] as const;

/**
 * Normalized (TRIM/LOWER) S1 `field_sirius_type` → seeded
 * options_call_reason.sirius_id. Aliases (N21 ruling) fold into the primary
 * sirius_id. NOTE: "disney  issues" carries S1's literal double space.
 */
const TYPE_TO_REASON_SIRIUS_ID: Record<string, string> = {
  "enrollment": "enrollment",
  "enrollment followup": "enrollment followup",
  "mlk issues": "mlk issues",
  "kaiser issues": "mlk issues",
  "disney  issues": "mlk issues",
  "dental insurance problems": "mlk issues",
  "dyntl": "mlk issues",
  "life insurance": "mlk issues",
  "id card not received": "id card not received",
  "appeal denial": "appeal denial",
  "delta appeal": "appeal denial",
  "other": "other",
};

/** Normalized (TRIM/LOWER) S1 `field_sirius_category` → interaction channel. */
const CATEGORY_TO_CHANNEL: Record<string, string> = {
  "call from member": "call_from_member",
  "call to member": "call_to_member",
  "office visit": "office_visit",
  "helpline call from member": "helpline",
  "hotline call from member": "hotline",
  "visit": "office_visit",
  "walk in": "walk_in",
  "walk-in": "walk_in",
  "walkin": "walk_in",
};

function norm(s: string | null): string | null {
  if (s == null) return null;
  const t = s.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** All entityreference target nids of a (possibly multi-value) field. */
function targetNidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  for (const s of arr) {
    if (typeof s === "number") out.push(s);
    else if (typeof s === "string" && /^\d+$/.test(s)) out.push(Number(s));
    else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const cand = o.target_id ?? o.value;
      if (typeof cand === "number") out.push(cand);
      else if (typeof cand === "string" && /^\d+$/.test(cand)) out.push(Number(cand));
    }
  }
  return out;
}

interface StagedLogRow {
  nid: number;
  created: number | null;
  fields: Record<string, unknown>;
}

/** Like loadStaged, but keeps node.created (the original interaction time). */
async function loadStagedLogs(): Promise<StagedLogRow[]> {
  const res = await db.execute(sql`
    SELECT nid, created, fields FROM s1_staging.records WHERE bundle = 'sirius_log' ORDER BY nid
  `);
  return (
    res as unknown as {
      rows: Array<{ nid: string | number; created: string | number | null; fields: unknown }>;
    }
  ).rows.map((r) => ({
    nid: Number(r.nid),
    created: r.created == null ? null : Number(r.created),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  }));
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  if (MIGRATION_MODE) {
    console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  }

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();

  // ---- resolve seeded reasons up front; fail loudly on missing seeds ----
  const reasonRes = await db.execute(sql`SELECT id, sirius_id FROM options_call_reason WHERE sirius_id IS NOT NULL`);
  const reasonIdBySiriusId = new Map(
    (reasonRes as unknown as { rows: Array<{ id: string; sirius_id: string }> }).rows.map((r) => [r.sirius_id, r.id]),
  );
  const neededSiriusIds = [...new Set(Object.values(TYPE_TO_REASON_SIRIUS_ID))];
  const missingSeeds = neededSiriusIds.filter((s) => !reasonIdBySiriusId.has(s));
  if (missingSeeds.length > 0) {
    throw new Error(
      `ABORTING: options_call_reason is missing seeded sirius_id(s): ${missingSeeds.join(", ")}. ` +
        `Run migrations (core 1117) first. Nothing was written.`,
    );
  }

  // throttle per-row storage-op logging + heartbeat (aggregates only) — from
  // process start: the staged log load below is the long pole at prod volume
  // and must emit liveness, not silence.
  throttleStorageOpLogs();
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const allRows = await loadStagedLogs();
  report.stagedLogs = allRows.length;

  // ---- scope: MSR call-reason types only ----
  const rows = allRows.filter((r) => {
    const t = norm(strOf(r.fields, "field_sirius_type"));
    return t != null && t in TYPE_TO_REASON_SIRIUS_ID;
  });
  report.inScope = rows.length;
  progress.setTotal(rows.length);

  const idMap = await getMappings(ID_MAP_ENTITY, rows.map((r) => r.nid));
  const handlerNids = new Set<number>();
  for (const r of rows) for (const n of targetNidsOf(r.fields, "field_sirius_log_handler")) handlerNids.add(n);
  const contactMap = await getMappings("contact", [...handlerNids]);

  const interactions = createCommInteractionStorage();

  const stats = { alreadyMapped: 0, created: 0 };
  const byReason: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  /** nid → created comm id (verify pass). */
  const expected = new Map<number, string>();

  progress.phase(null); // row loop
  for (const r of rows) {
    progress.add(1);
    if (idMap.has(r.nid)) {
      stats.alreadyMapped++;
      continue;
    }

    const type = norm(strOf(r.fields, "field_sirius_type"))!;
    const reasonSiriusId = TYPE_TO_REASON_SIRIUS_ID[type];
    const callReasonId = reasonIdBySiriusId.get(reasonSiriusId)!;

    const rawCategory = strOf(r.fields, "field_sirius_category");
    const category = norm(rawCategory);
    if (category == null) {
      rejects.add("category_missing", { nid: r.nid, type }, r.nid);
      continue;
    }
    const channel = CATEGORY_TO_CHANNEL[category];
    if (!channel) {
      rejects.add("category_unmapped", { nid: r.nid, type, category }, r.nid);
      continue;
    }

    const handlers = targetNidsOf(r.fields, "field_sirius_log_handler");
    if (handlers.length === 0) {
      rejects.add("handler_missing", { nid: r.nid, type }, r.nid);
      continue;
    }
    const contactHit = handlers.map((n) => contactMap.get(n)).find((m) => m != null);
    if (!contactHit) {
      rejects.add("handler_unresolved", { nid: r.nid, type, handlers }, r.nid);
      continue;
    }

    const summary = strOf(r.fields, "field_sirius_summary");
    const notes = strOf(r.fields, "field_sirius_notes");
    const combinedNotes = [summary, notes].filter(Boolean).join("\n\n") || null;
    const occurredAt = r.created != null ? new Date(r.created * 1000) : null;

    byReason[reasonSiriusId] = (byReason[reasonSiriusId] ?? 0) + 1;
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;

    if (DRY_RUN) {
      stats.created++;
      continue;
    }

    try {
      const { comm } = await loaderScope(() =>
        interactions.createInteractionWithComm({
          contactId: contactHit.s2Id,
          channel,
          callReasonId,
          notes: combinedNotes,
          occurredAt,
          data: { s1: { nid: r.nid, type, category: rawCategory } },
          commData: { s1Loader: LOADER },
        }),
      );
      await putMapping(ID_MAP_ENTITY, r.nid, comm.id, { stub: false, loader: LOADER });
      expected.set(r.nid, comm.id);
      stats.created++;
    } catch {
      // SANITIZED: never log raw error text here — notes/summary content may
      // be embedded in driver messages.
      rejects.add("create_failed", { nid: r.nid, type }, r.nid);
    }
  }

  // ---------------- verify pass ----------------
  progress.phase("verify", rows.length);
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vMap = await getMappings(ID_MAP_ENTITY, rows.map((r) => r.nid));
    for (const r of rows) {
      progress.add(1);
      if (rejects.hasAnyIn(r.nid, FATAL_REASONS)) continue;
      const m = vMap.get(r.nid);
      if (!m) {
        console.error(`VERIFY: call_log nid ${r.nid} has no id_map entry`);
        verifyFailures++;
        continue;
      }
      const res = await db.execute(sql`
        SELECT c.id, ci.id AS interaction_id FROM comm c
        LEFT JOIN comm_interaction ci ON ci.comm_id = c.id
        WHERE c.id = ${m.s2Id} AND c.medium = 'interaction'
      `);
      const hit = (res as unknown as { rows: Array<{ id: string; interaction_id: string | null }> }).rows[0];
      if (!hit || !hit.interaction_id) {
        console.error(`VERIFY: call_log nid ${r.nid} maps to missing/incomplete comm ${m.s2Id}`);
        verifyFailures++;
      }
    }
  }

  progress.stop();

  report.stats = stats;
  report.byReason = byReason;
  report.byChannel = byChannel;
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, allowedRejects: ALLOWED_REJECTS }, report);

  if (verifyFailures > 0) process.exit(1);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
