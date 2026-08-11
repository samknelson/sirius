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
 *     unmapped categories reject as `category_unmapped` (full per-value tally
 *     in the report's `unmappedCategories`). RULING 2026-08-11: category
 *     "issue reported for member" (700 prod rows) maps to the NEW
 *     `issue_reported` channel (added to INTERACTION_CHANNELS) rather than
 *     folding into an existing channel or staying in cold archive.
 *   - contact: `field_sirius_log_handler` targets (multi) through
 *     s1_staging.id_map entity "contact", falling back per-target to entity
 *     "worker" (S1 handler refs also point at sirius_worker nodes — the
 *     worker's S2 contact_id is used). First resolvable target wins; no
 *     handler at all rejects as `handler_missing`. When nothing resolves:
 *     `handler_unresolved` if at least one target exists in
 *     s1_staging.records (staged but unmapped — a real resolution gap),
 *     `handler_dangling` if none do (refs to S1 nodes deleted/absent from
 *     staging). The report's `unresolvedHandlerNids` tallies distinct
 *     unresolved nids by staged bundle plus a notStaged count.
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
import { RejectLog, strOf, throttleStorageOpLogs, LOADER_PAGE_SIZE, stagedCountOf } from "./lib/loader-utils";
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
  "handler_dangling",
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
  // RULING 2026-08-11 (rehearsal triage): all 700 category_unmapped rejects in
  // the first rehearsal carried this one value; it becomes a NEW channel.
  "issue reported for member": "issue_reported",
  // RULING 2026-08-11 (prod triage): 7 "appeal denial" logs carry category
  // "letter" (written correspondence); becomes its own channel.
  "letter": "letter",
  // RULING 2026-08-12 (prod triage): 1 "enrollment" log (nid 17239418) carries
  // category "in person visit"; folds into the existing office_visit channel
  // (same disposition as "visit").
  "in person visit": "office_visit",
  // RULING 2026-08-12 (prod triage): 1 "enrollment" log (nid 17267794) carries
  // category "provider call"; becomes a NEW provider_call channel (no generic
  // call channel exists, and the member-call channels don't fit a provider
  // call).
  "provider call": "provider_call",
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

type RawLogRow = { nid: string | number; created: string | number | null; fields: unknown };

function mapLogRow(r: RawLogRow): StagedLogRow {
  return {
    nid: Number(r.nid),
    created: r.created == null ? null : Number(r.created),
    fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
  };
}

/**
 * Keyset-paged staged read for sirius_log: yields pages of at most `pageSize`
 * StagedLogRows in ascending nid order. Selects `nid, created, fields` (not
 * title/changed like the generic pagedStaged helper, which is why this is a
 * local variant).
 */
async function* pagedStagedLogs(
  pageSize: number = LOADER_PAGE_SIZE,
): AsyncGenerator<StagedLogRow[]> {
  let lastNid = -1;
  for (;;) {
    const res = await db.execute(sql`
      SELECT nid, created, fields FROM s1_staging.records
       WHERE bundle = 'sirius_log' AND nid > ${lastNid}
       ORDER BY nid LIMIT ${pageSize}
    `);
    const rows = (res as unknown as { rows: RawLogRow[] }).rows.map(mapLogRow);
    if (rows.length === 0) return;
    lastNid = rows[rows.length - 1].nid;
    yield rows;
    if (rows.length < pageSize) return;
  }
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

  // throttle per-row storage-op logging + heartbeat (aggregates only)
  throttleStorageOpLogs();

  // fetch total staged count up front so progress has a meaningful total
  const totalStaged = await stagedCountOf("sirius_log");
  const progress = makeProgressLogger(LOADER, totalStaged);
  progress.phase("pre-scan");

  const interactions = createCommInteractionStorage();

  let stagedLogs = 0;
  let inScope = 0;
  const stats = { alreadyMapped: 0, created: 0, handlerViaWorker: 0 };
  const byReason: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  /** nid array for the verify pass (mapped nids only — ~12K max). */
  const mappedNids: number[] = [];
  // ---- triage aggregates (counts only — never note/summary content) ----
  /** Every category_unmapped occurrence tallied by normalized value. */
  const unmappedCategories: Record<string, number> = {};
  /** Distinct unresolved handler nids tallied by their staged bundle... */
  const unresolvedHandlersByBundle: Record<string, number> = {};
  /** ...plus the count of distinct unresolved handler nids not staged at all. */
  let unresolvedHandlersNotStaged = 0;
  const talliedUnresolvedNids = new Set<number>();

  progress.phase(null); // row loop

  for await (const page of pagedStagedLogs()) {
    stagedLogs += page.length;

    // Filter to in-scope rows (MSR call-reason types only)
    const scopedPage = page.filter((r) => {
      const t = norm(strOf(r.fields, "field_sirius_type"));
      return t != null && t in TYPE_TO_REASON_SIRIUS_ID;
    });
    inScope += scopedPage.length;

    if (scopedPage.length === 0) continue;

    // Fetch id_map and handler mappings for this page only.
    // Handler resolution is per-target: id_map("contact") first, then
    // id_map("worker") (worker's S2 contact_id) — S1 handler refs target both
    // sirius_contact and sirius_worker nodes.
    const idMap = await getMappings(ID_MAP_ENTITY, scopedPage.map((r) => r.nid));
    const handlerNids = new Set<number>();
    for (const r of scopedPage) for (const n of targetNidsOf(r.fields, "field_sirius_log_handler")) handlerNids.add(n);
    const contactMap = await getMappings("contact", [...handlerNids]);

    const unresolvedAfterContact = [...handlerNids].filter((n) => !contactMap.has(n));
    const workerMap = await getMappings("worker", unresolvedAfterContact);
    /** handler nid → S2 contact id, via the worker fallback. */
    const workerContactIdByNid = new Map<number, string>();
    if (workerMap.size > 0) {
      const workerS2Ids = [...new Set([...workerMap.values()].map((m) => m.s2Id))];
      const contactIdByWorkerId = new Map<string, string>();
      for (let i = 0; i < workerS2Ids.length; i += 500) {
        const chunk = workerS2Ids.slice(i, i + 500);
        const res = await db.execute(sql`
          SELECT id, contact_id FROM workers
           WHERE id IN (${sql.join(chunk.map((s) => sql`${s}`), sql`, `)})
        `);
        for (const row of (res as unknown as { rows: Array<{ id: string; contact_id: string }> }).rows) {
          contactIdByWorkerId.set(row.id, row.contact_id);
        }
      }
      for (const [nid, m] of workerMap) {
        const cid = contactIdByWorkerId.get(m.s2Id);
        if (cid) workerContactIdByNid.set(nid, cid);
      }
    }

    // Staged-existence lookup for handler nids resolvable via neither map —
    // splits handler_unresolved (staged but unmapped) from handler_dangling
    // (target absent from staging entirely) and feeds the bundle triage tally.
    const stillUnresolved = unresolvedAfterContact.filter((n) => !workerContactIdByNid.has(n));
    const stagedBundlesByNid = new Map<number, string[]>();
    for (let i = 0; i < stillUnresolved.length; i += 500) {
      const chunk = stillUnresolved.slice(i, i + 500);
      const res = await db.execute(sql`
        SELECT nid, bundle FROM s1_staging.records
         WHERE nid IN (${sql.join(chunk.map((n) => sql`${n}`), sql`, `)})
      `);
      for (const row of (res as unknown as { rows: Array<{ nid: string | number; bundle: string }> }).rows) {
        const k = Number(row.nid);
        const arr = stagedBundlesByNid.get(k);
        if (arr) arr.push(row.bundle);
        else stagedBundlesByNid.set(k, [row.bundle]);
      }
    }

    for (const r of scopedPage) {
      progress.add(1);
      if (idMap.has(r.nid)) {
        stats.alreadyMapped++;
        // still track it for the verify pass
        mappedNids.push(r.nid);
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
        unmappedCategories[category] = (unmappedCategories[category] ?? 0) + 1;
        rejects.add("category_unmapped", { nid: r.nid, type, category }, r.nid);
        continue;
      }

      const handlers = targetNidsOf(r.fields, "field_sirius_log_handler");
      if (handlers.length === 0) {
        rejects.add("handler_missing", { nid: r.nid, type }, r.nid);
        continue;
      }
      // First resolvable target wins: contact mapping, else worker fallback.
      let resolvedContactId: string | null = null;
      let viaWorker = false;
      for (const n of handlers) {
        const c = contactMap.get(n);
        if (c) {
          resolvedContactId = c.s2Id;
          break;
        }
        const wc = workerContactIdByNid.get(n);
        if (wc) {
          resolvedContactId = wc;
          viaWorker = true;
          break;
        }
      }
      if (!resolvedContactId) {
        // Triage tally: distinct unresolved handler nids by staged bundle vs
        // not staged at all (aggregate counts only).
        for (const n of handlers) {
          if (talliedUnresolvedNids.has(n)) continue;
          talliedUnresolvedNids.add(n);
          const bundles = stagedBundlesByNid.get(n);
          if (!bundles) unresolvedHandlersNotStaged++;
          else for (const b of bundles) unresolvedHandlersByBundle[b] = (unresolvedHandlersByBundle[b] ?? 0) + 1;
        }
        const anyStaged = handlers.some((n) => stagedBundlesByNid.has(n));
        rejects.add(
          anyStaged ? "handler_unresolved" : "handler_dangling",
          { nid: r.nid, type, handlers },
          r.nid,
        );
        continue;
      }
      if (viaWorker) stats.handlerViaWorker++;

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
            contactId: resolvedContactId,
            channel,
            callReasonId,
            notes: combinedNotes,
            occurredAt,
            data: { s1: { nid: r.nid, type, category: rawCategory } },
            commData: { s1Loader: LOADER },
          }),
        );
        await putMapping(ID_MAP_ENTITY, r.nid, comm.id, { stub: false, loader: LOADER });
        mappedNids.push(r.nid);
        stats.created++;
      } catch {
        // SANITIZED: never log raw error text here — notes/summary content may
        // be embedded in driver messages.
        rejects.add("create_failed", { nid: r.nid, type }, r.nid);
      }
    }
  }

  report.stagedLogs = stagedLogs;
  report.inScope = inScope;

  // ---------------- verify pass ----------------
  progress.phase("verify", mappedNids.length);
  let verifyFailures = 0;
  if (!DRY_RUN) {
    // Re-fetch all mappings for mapped nids (small set, ~12K max)
    const vMap = await getMappings(ID_MAP_ENTITY, mappedNids);
    for (const nid of mappedNids) {
      progress.add(1);
      if (rejects.hasAnyIn(nid, FATAL_REASONS)) continue;
      const m = vMap.get(nid);
      if (!m) {
        console.error(`VERIFY: call_log nid ${nid} has no id_map entry`);
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
        console.error(`VERIFY: call_log nid ${nid} maps to missing/incomplete comm ${m.s2Id}`);
        verifyFailures++;
      }
    }
  }

  progress.stop();

  report.stats = stats;
  report.byReason = byReason;
  report.byChannel = byChannel;
  // Triage aggregates (counts only): every unmapped category by normalized
  // value; distinct unresolved/dangling handler nids by staged bundle plus a
  // not-staged count — future runs are self-explanatory without re-profiling.
  report.unmappedCategories = unmappedCategories;
  report.unresolvedHandlerNids = {
    byStagedBundle: unresolvedHandlersByBundle,
    notStaged: unresolvedHandlersNotStaged,
  };
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
