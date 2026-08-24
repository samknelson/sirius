/**
 * T3+T1 loader — sirius_contact → contacts (+ contact_phone, contact_postal),
 * sirius_worker → workers (+ worker_ids, contact updates). Milestone 2.
 *
 * Contacts pass (02-mapping §2):
 *   - name parts (T11): field_sirius_name subcolumns map 1:1; display_name =
 *     S1 node title, else trim(given + family)
 *   - email (T12, amended by the shared-email ownership ruling): contacts.email
 *     is UNIQUE (case-insensitive since migration 1125). When multiple staged
 *     contacts share an address (case-insensitive, trimmed, after placeholder
 *     suppression), ownership resolves via the S1 user↔contact association
 *     (raw_user_contact): the contact referenced by the S1 user account whose
 *     mail matches the address keeps the email; every other contact loads
 *     with email=null. No owning account → ALL contacts load with email=null
 *     (fund ruling: deferred until an ownership rule is issued; reported
 *     under report.sharedEmails as the follow-up worklist). More than one
 *     owning account → FATAL reject class `shared_email_multiple_owners`
 *     (does not occur in prod data; guard only) — the pre-scan aborts before
 *     any write unless the class is explicitly allowed via --allow-rejects,
 *     in which case the address is deferred (all null). Re-runs REPAIR
 *     first-wins assignments from older runs: a non-owner holding a shared
 *     address is cleared before the row loop so the owner can claim it.
 *     An address whose only claim is a DB row outside the staged group keeps
 *     today's duplicate_email semantics (reject + null on the staged side).
 *   - phones (T5): strip non-digits → E.164 (+1, len 10 or 11-leading-1);
 *     field_sirius_phone is_primary=true, field_sirius_phone_alt "Alt";
 *     rejects counted. Twilio validation is NOT invoked (bulk mode).
 *     SYNC: phones reconcile as a SET — loader-owned rows (friendly names
 *     "Primary"/"Alt") whose number vanished from S1 are DELETED; rows the
 *     operator added under other names are never touched.
 *   - address (T13): compound merge via createOrMatchAddress (idempotent by
 *     normalized match), source="import" (closest AddressSource to the
 *     spec's 's1-migration'), geo left/top as lon/lat ONLY when the bbox is
 *     degenerate (left=right, top=bottom) — else coordinates are rejected.
 *     SYNC: import-sourced rows that no longer match the (single) staged S1
 *     address are DELETED; rows with any other source are operator-owned.
 *   - stub absorption: if a contact's referencing worker was stubbed by the
 *     hours loader, ADOPT the stub worker's auto-created contact row instead
 *     of creating a duplicate (update name/email in place)
 *
 * Workers pass (02-mapping §1):
 *   - workers.sirius_id ← S1 field_sirius_id (T1 — fund ruling 2026-08-06:
 *     field_sirius_id IS the S2 sirius_id; the S1 nid is a node counter in a
 *     disjoint id space). The nid is preserved as a "Legacy NID" worker_ids
 *     row (type seeded with stable sirius_id "s1-legacy-nid"). Sequence
 *     setval() runs once after the load — the only raw SQL write in this
 *     loader (spec-sanctioned).
 *   - missing/non-numeric field_sirius_id (RULE, documented): the worker
 *     still loads with a SEQUENCE-ASSIGNED sirius_id (above both the staged
 *     field_sirius_id range and the current DB max) + reject-report note
 *     (`sirius_id_assigned`, plus `sirius_id_not_numeric` when a value
 *     existed but failed numeric validation). Never silently defaulted.
 *   - cross-worker field_sirius_id collisions are FATAL (data-integrity
 *     ruling 2026-08-06: colliding sirius_ids belong to DISTINCT PEOPLE —
 *     S1's unlocked ID counter duplicated ~1 in 410 values). A pre-scan
 *     aborts BEFORE any write; no first-wins, no dedupe, no merge, no
 *     --allow-rejects class. A staged value already owned by a different S2
 *     row (cross-run collision) throws mid-loop for the same reason. Both
 *     stop the run for fund triage.
 *   - re-runs REPAIR rows loaded under the old nid-based mapping: a mapped
 *     worker whose sirius_id equals its nid (≠ staged field_sirius_id) is
 *     updated in place, its old "Sirius ID" worker_ids row (value == staged
 *     field_sirius_id) is removed, and a "Legacy NID" row is added.
 *   - contact_id via id_map (contact nid → contacts.id); missing → reject
 *   - ssn (T3): digits-only, must be 9 digits; collisions load ssn=null +
 *     reject (Q36 review queue), except a uniquely claimed incoming SSN may
 *     transfer from an exactly/unambiguously mapped non-stub S1 owner whose
 *     nid is absent from current staging. The transfer is SSN-only and atomic:
 *     both workers, Sirius IDs, mappings, and history remain intact. Masked
 *     snapshot values fail the 9-digit rule and are counted.
 *   - dob/gender → the worker's CONTACT (updateBirthDate/updateGender);
 *     gender tid resolves via id_map term else options_gender name match.
 *     SYNC: dob/gender removal in S1 clears the contact fields (only when a
 *     worker node exists as the source; parse failures keep existing values
 *     and reject instead of clearing).
 *   - worker_ids (06 §4.9, amended 2026-08-06): nid → "Legacy NID",
 *     _id2 → "Union ID", _id3 → "External ID", _aat → "AAT"; NO "Sirius ID"
 *     row anymore (the value lives on workers.sirius_id itself); types
 *     ensured via unified options; (type, value) is UNIQUE — cross-worker
 *     collisions are rejects.
 *     SYNC: the four loader types reconcile as sets — S2 rows of those types
 *     equal the S1 value (S1-wins: changed values replace the old row,
 *     removed values delete it). Rows under any OTHER type are untouched.
 *   - field_sirius_aat_required (T14 Yes/No) → workers.data.aatRequired
 *     (merged into workers.data; other data keys preserved; key removed when
 *     the S1 field disappears)
 *   - contact-style fields directly on the worker bundle are MIRRORS — the
 *     contact node wins (N10); they are not read
 *   - dispatch/member-status/denorm/headshot fields: out of scope here
 *
 * Sync semantics (Task 292/293 — RUNBOOK §10): RECONCILING. Consumed
 * fingerprints: workers use the staged node content_hash directly; contacts
 * use a combined hash of (contact node, referencing worker node — dob/gender
 * source, shared-email plan outcome) so ownership changes reprocess exactly
 * the affected contacts. Unchanged rows skip all storage reads (fast path).
 * The verify pass covers rows PROCESSED this run (fast-path rows were
 * verified when last processed; --force-reconcile re-verifies everything).
 * Deletion sweeps: contacts and workers are HIGH BLAST RADIUS — S1 deletions
 * are report-only findings (`deleted_in_s1`, blocking unless allowed via
 * --allow-findings deleted_in_s1); nothing is auto-deleted. Known limits:
 * a contact/worker email or SSN deferred by a cross-row collision is NOT
 * fingerprint-tracked against the blocker's release — those rows skip
 * fingerprint advance so they retry on every run until clean.
 *
 * Writes go through the storage layer under notification suppression.
 * Idempotent: re-runs resolve via id_map and only write on drift.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-contacts-workers.ts [--dry-run]
 *       [--force-reconcile] [--allow-rejects class1,class2]
 *       [--allow-findings deleted_in_s1]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary. Email addresses are NEVER printed; shared-address report
 * entries carry contact nids only (any member nid resolves the address in S1).
 */
import { db, pool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { runInTransaction } from "../../server/storage/transaction-context";
import {
  ensureStagingSchema,
  recordRun,
  ensureRawUserTables,
  loadRawUserContacts,
  loadRawUserMails,
} from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, markAbsorbed, advanceFingerprints } from "./lib/idmap";
import {
  throttleStorageOpLogs,
  RejectLog,
  loadStaged,
  scalarOf,
  strOf,
  tidOf,
  targetNidOf,
  toE164,
  yesNo,
  toYmd,
  type StagedNode,
} from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  canonicalJson,
  classifyRow,
  combineFingerprints,
  contentHashOf,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
  type SyncFinding,
} from "./lib/sync";
import { nextSiriusId } from "./lib/sirius-id";

const DRY_RUN = process.argv.includes("--dry-run");
/** Reject classes the operator explicitly allows for THIS run (comma-sep).
 * EVERY reject reason present in a run must be allowed or the run fails
 * (standard reject gate). `shared_email_multiple_owners` additionally
 * aborts in the pre-scan (before any write) unless allowed — allowing it
 * defers the affected addresses (all contacts null). sirius_id collisions
 * have NO allow flag by ruling. */
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : [];
})();
const LOADER = "t3t1-contacts-workers";
/** Loader logic version — BUMP whenever transform logic changes so unchanged
 * S1 rows reprocess into the corrected S2 shape on their next run. */
const LOGIC_VERSION = 2;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

// ---------- placeholder email suppression (T12 ruling) ----------
/** Exact addresses (lowercased) that must never be stored in contacts.email.
 * Adding a new placeholder is a one-line change to one of these two sets. */
const PLACEHOLDER_EMAILS = new Set(["fastload@nodomain.com", "no_email@avolta.net"]);
/** Every address at these domains is non-routable and must be suppressed. */
const PLACEHOLDER_DOMAINS = new Set(["nodomain.com"]);

/** Canonical contacts.email value and ownership-map key. */
function normalizeEmailKey(raw: string | null | undefined): string | null {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

/** Returns true when an email address is a non-routable placeholder that must
 * be suppressed before the duplicate-email dedupe check.  Matching is
 * case-insensitive and trim-safe, consistent with the existing dedupe logic. */
function isPlaceholderEmail(email: string): boolean {
  const norm = normalizeEmailKey(email)!;
  if (PLACEHOLDER_EMAILS.has(norm)) return true;
  const atIdx = norm.lastIndexOf("@");
  if (atIdx >= 0 && PLACEHOLDER_DOMAINS.has(norm.slice(atIdx + 1))) return true;
  return false;
}

/** T3: SSN digits-only; must be exactly 9. */
function normalizeSsn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

interface NameParts {
  title: string | null;
  given: string | null;
  middle: string | null;
  family: string | null;
  generational: string | null;
  credentials: string | null;
}

/** T11: field_sirius_name subcolumns (staged as an object keyed by suffix). */
function namePartsOf(fields: Record<string, unknown>): NameParts | null {
  const raw = scalarOf(fields["field_sirius_name"]);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => {
    const v = o[k];
    if (v == null) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  };
  return {
    title: pick("title"),
    given: pick("given"),
    middle: pick("middle"),
    family: pick("family"),
    generational: pick("generational"),
    credentials: pick("credentials"),
  };
}

/** Loader-owned phone rows carry these friendly names — set reconciliation
 * only ever deletes rows named this way; operator-added phones (any other
 * name) are never touched. */
const LOADER_PHONE_NAMES = new Set(["Primary", "Alt"]);

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureRawUserTables(); // raw_user_contact may predate a full staging run

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();

  // throttle per-row storage-op logging + heartbeat (aggregates only:
  // counts/elapsed/rate — never names, SSNs, or row contents) — from process
  // start: the two ~250k-row staged loads below are minutes on the real
  // target and must emit liveness, not silence.
  throttleStorageOpLogs();
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const stagedContacts = await loadStaged("sirius_contact");
  const stagedWorkers = await loadStaged("sirius_worker");
  report.stagedContacts = stagedContacts.length;
  report.stagedWorkers = stagedWorkers.length;
  progress.setTotal(stagedContacts.length + stagedWorkers.length);

  // ---- FATAL pre-scan: cross-worker field_sirius_id collisions ----
  // Data-integrity ruling 2026-08-06 (fund finding: S1's unlocked ID counter
  // duplicated ~1 in 410 sirius_ids; colliding workers are DISTINCT PEOPLE).
  // A collision is NEVER auto-resolved: no first-wins, no dedupe, no merge —
  // merging would combine two people's benefit histories. There is NO
  // --allow-rejects class for this. The scan runs BEFORE any write (contacts
  // included); the run stops here and the fund must re-number one of the
  // colliding members in S1 (or rule a manual assignment) before retrying.
  {
    const byFsid = new Map<number, number[]>(); // fsid → staged worker nids
    for (const w of stagedWorkers) {
      const raw = strOf(w.fields, "field_sirius_id");
      if (raw == null || !/^\d+$/.test(raw)) continue;
      const v = Number(raw);
      byFsid.set(v, [...(byFsid.get(v) ?? []), w.nid]);
    }
    const collisions = [...byFsid.entries()].filter(([, nids]) => nids.length > 1);
    if (collisions.length > 0) {
      console.error(
        `FATAL: ${collisions.length} field_sirius_id value(s) are each claimed by multiple staged workers ` +
          `(${collisions.reduce((n, [, nids]) => n + nids.length, 0)} workers). ` +
          `NOT auto-resolvable — colliding sirius_ids belong to distinct people; ` +
          `no allow flag exists. Nothing was written. Triage with the fund:`,
      );
      for (const [fsid, nids] of collisions.slice(0, 50)) {
        console.error(`  sirius_id ${fsid}: worker nids ${nids.join(", ")}`);
      }
      if (collisions.length > 50) console.error(`  … and ${collisions.length - 50} more`);
      await pool.end();
      process.exit(1);
    }
  }

  // ---- shared-email ownership pre-scan (S1 user↔contact association) ----
  // 1,008 S1 contacts share addresses; first-wins by nid put a child's email
  // on the parent's contact (PHI exposure). S1 records ownership directly:
  // field_data_field_sirius_contact rows with entity_type='user' (staged as
  // raw_user_contact), and no address is associated with more than one S1
  // user account — so wherever a matching account exists, it is
  // authoritative. The users loader resolves logins through the SAME signal,
  // keeping the contact that carries an email and the worker its login
  // resolves to the same person.
  interface SharedEmailPlan {
    winnerNid: number | null;
    rule: "byUserAccount" | "deferredNoOwner" | "deferredMultipleOwners";
    ownerUid?: number;
    memberNids: number[];
    nulled: number; // counted as the row loop applies the plan
  }
  const sharedEmailPlan = new Map<string, SharedEmailPlan>(); // normalized address → plan
  {
    const groups = new Map<string, number[]>(); // normalized address → staged contact nids
    for (const c of stagedContacts) {
      const norm = normalizeEmailKey(strOf(c.fields, "field_sirius_email"));
      if (!norm) continue;
      if (isPlaceholderEmail(norm)) continue; // suppressed separately (T12)
      groups.set(norm, [...(groups.get(norm) ?? []), c.nid]);
    }
    const shared = [...groups.entries()].filter(([, nids]) => nids.length > 1);
    if (shared.length > 0) {
      const assoc = await loadRawUserContacts();
      const contactNidsByUid = new Map<number, number[]>();
      for (const a of assoc) {
        contactNidsByUid.set(a.uid, [...(contactNidsByUid.get(a.uid) ?? []), a.contactNid]);
      }
      const uidsByMail = new Map<string, number[]>();
      for (const u of await loadRawUserMails()) {
        const m = normalizeEmailKey(u.mail);
        if (!m) continue;
        uidsByMail.set(m, [...(uidsByMail.get(m) ?? []), u.uid]);
      }
      for (const [addr, nids] of shared) {
        const nidSet = new Set(nids);
        // owning accounts: mail matches the address AND the account's contact
        // reference points INTO the sharing group
        const owners: Array<{ uid: number; nid: number }> = [];
        for (const uid of uidsByMail.get(addr) ?? []) {
          for (const n of new Set((contactNidsByUid.get(uid) ?? []).filter((n) => nidSet.has(n)))) {
            owners.push({ uid, nid: n });
          }
        }
        if (owners.length === 1) {
          sharedEmailPlan.set(addr, {
            winnerNid: owners[0].nid,
            rule: "byUserAccount",
            ownerUid: owners[0].uid,
            memberNids: nids,
            nulled: 0,
          });
        } else if (owners.length > 1) {
          // Fund ruling: cannot occur in S1 (no address has >1 user account).
          // Guard only — never auto-picked.
          rejects.add(
            "shared_email_multiple_owners",
            { contactNids: nids, uids: owners.map((o) => o.uid) },
          );
          sharedEmailPlan.set(addr, { winnerNid: null, rule: "deferredMultipleOwners", memberNids: nids, nulled: 0 });
        } else {
          sharedEmailPlan.set(addr, { winnerNid: null, rule: "deferredNoOwner", memberNids: nids, nulled: 0 });
        }
      }
      const multi = rejects.counts["shared_email_multiple_owners"] ?? 0;
      if (multi > 0 && !ALLOWED_REJECTS.includes("shared_email_multiple_owners")) {
        console.error(
          `FATAL: ${multi} shared email address(es) are each associated with MORE THAN ONE S1 user ` +
            `account — the fund ruled this cannot occur; triage with the fund before loading. ` +
            `Nothing was written. (Deferring these addresses instead — every sharing contact loads ` +
            `with email=null — requires --allow-rejects shared_email_multiple_owners.)`,
        );
        for (const s of rejects.samples["shared_email_multiple_owners"] ?? []) {
          console.error(`  contact nids ${(s.contactNids as number[]).join(", ")}: uids ${(s.uids as number[]).join(", ")}`);
        }
        await pool.end();
        process.exit(1);
      }
    }
  }
  /** Apply the shared-address plan: the email this contact may carry (null
   * when another contact owns the address, or ownership is deferred).
   * Placeholders never enter the plan, so ordering vs suppression is moot. */
  const applySharedOwnership = (nid: number, email: string | null): string | null => {
    const normalized = normalizeEmailKey(email);
    if (!normalized) return null;
    const plan = sharedEmailPlan.get(normalized);
    if (!plan || plan.winnerNid === nid) return normalized;
    plan.nulled++;
    return null;
  };

  // contact nid → referencing worker nid (for stub absorption)
  const workerNidByContactNid = new Map<number, number>();
  for (const w of stagedWorkers) {
    const cnid = targetNidOf(w.fields, "field_sirius_contact");
    if (cnid != null) {
      if (workerNidByContactNid.has(cnid)) {
        rejects.add("contact_referenced_by_multiple_workers", { contactNid: cnid, workerNid: w.nid });
      } else {
        workerNidByContactNid.set(cnid, w.nid);
      }
    }
  }
  // worker nid → staged worker (contacts pass pre-joins dob/gender at create)
  const stagedWorkerByNid = new Map(stagedWorkers.map((w) => [w.nid, w]));

  const contactMap = await getMappings("contact", stagedContacts.map((c) => c.nid));
  const workerMap = await getMappings("worker", stagedWorkers.map((w) => w.nid));

  // ---- consumed fingerprints (Task 293) ----
  // Worker: the staged node hash directly (single source, SQL-joinable).
  // Contact: combined hash — the contact node, the referencing worker node
  // (dob/gender/nota source), and the shared-email plan OUTCOME for the
  // contact's address (ownership can change via raw_user tables without the
  // contact node changing; folding the plan in reprocesses exactly the
  // affected contacts). Null staged hashes classify "changed" (never skip).
  const contactFpOf = (c: StagedNode): string => {
    const wnid = workerNidByContactNid.get(c.nid);
    const w = wnid != null ? stagedWorkerByNid.get(wnid) : undefined;
    const rawEmail = normalizeEmailKey(strOf(c.fields, "field_sirius_email"));
    const plan = rawEmail ? sharedEmailPlan.get(rawEmail) : undefined;
    return combineFingerprints([
      ["node", c.contentHash],
      ["workerNode", w?.contentHash ?? null],
      ["sharedEmail", plan ? contentHashOf({ rule: plan.rule, winnerNid: plan.winnerNid }) : null],
    ]);
  };

  const summary = emptySummary();
  /** rows skipped by the consumed-fingerprint fast path (subset of summary.unchanged) */
  let fastPathSkips = 0;
  /** fingerprint advances for PRE-EXISTING mappings, applied after verify —
   * NEW mappings are stamped at putMapping time (the S2 write just landed). */
  const pendingContactAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const pendingWorkerAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  /** rows actually processed this run (changed/new) — verify scope */
  const processedContacts: StagedNode[] = [];
  const processedWorkers: StagedNode[] = [];

  // Existing unique-column values (dedupe pre-checks). Direct reads — the
  // storage layer has no "list all emails/ssns" surface; loader-side keyset
  // paging is a documented production TODO (README).
  // email → owning contact id, so re-runs don't count a contact's own
  // already-loaded email as a duplicate
  const emailRes = await db.execute(sql`SELECT id, email FROM contacts WHERE email IS NOT NULL`);
  const emailOwner = new Map<string, string>();
  for (const r of (emailRes as unknown as { rows: Array<{ id: string; email: string }> }).rows) {
    const key = normalizeEmailKey(r.email);
    if (key) emailOwner.set(key, r.id);
  }

  // ---- rerun repair: clear shared addresses held by non-owners ----
  // A prior run's first-wins rule may have written a shared address onto a
  // contact the plan does NOT declare the owner. Clear those BEFORE the row
  // loop so the owner's reconcile can claim the address without tripping the
  // unique index, and drop the map entry so the dedupe check stays exact.
  // Only rows mapped to a nid in the sharing group are touched — a DB row
  // outside the group (operator-created) keeps its email and the staged side
  // rejects duplicate_email as before.
  let sharedEmailsCleared = 0;
  let sharedEmailsClearPlanned = 0;
  const sharedEmailRepairNids = new Set<number>();
  for (const [addr, plan] of sharedEmailPlan) {
    const holderId = emailOwner.get(addr);
    if (!holderId) continue;
    const winnerId = plan.winnerNid != null ? contactMap.get(plan.winnerNid)?.s2Id : undefined;
    if (winnerId != null && holderId === winnerId) continue; // correctly owned — never reassigned
    const memberIds = new Set(
      plan.memberNids.map((n) => contactMap.get(n)?.s2Id).filter((id): id is string => id != null),
    );
    if (!memberIds.has(holderId)) continue; // outside the staged group
    sharedEmailsClearPlanned++;
    if (plan.winnerNid != null) sharedEmailRepairNids.add(plan.winnerNid);
    if (!DRY_RUN) {
      await withNotificationsSuppressed(() => storage.contacts.updateEmail(holderId, null));
      sharedEmailsCleared++;
    }
    // Exact planning state in both modes lets dry-run report the downstream
    // ownership result without mutating either contact.
    emailOwner.delete(addr);
  }
  // SSN ownership is keyed by the actual S2 worker row. Identity is derived
  // only from id_map; workers.sirius_id is never interpreted as an S1 nid.
  const ssnRes = await db.execute(sql`
    SELECT w.id AS worker_id, w.ssn, m.s1_id, m.stub
      FROM workers w
      LEFT JOIN s1_staging.id_map m ON m.entity = 'worker' AND m.s2_id = w.id
     WHERE w.ssn IS NOT NULL
  `);
  interface SsnOwner {
    workerId: string;
    mappings: Array<{ nid: number; stub: boolean }>;
  }
  const ssnOwner = new Map<string, SsnOwner>();
  const workerSsn = new Map<string, string>();
  for (const r of (ssnRes as unknown as {
    rows: Array<{ worker_id: string; ssn: string; s1_id: number | string | null; stub: boolean | null }>;
  }).rows) {
    let owner = ssnOwner.get(r.ssn);
    if (!owner) {
      owner = { workerId: r.worker_id, mappings: [] };
      ssnOwner.set(r.ssn, owner);
      workerSsn.set(r.worker_id, r.ssn);
    }
    if (r.s1_id != null) owner.mappings.push({ nid: Number(r.s1_id), stub: r.stub === true });
  }

  // A uniquely claimed staged SSN may displace a source-missing stale S1
  // duplicate, but only under the exact guarded ruling below.
  const stagedWorkerNids = new Set(stagedWorkers.map((w) => w.nid));
  const incomingNidsBySsn = new Map<string, number[]>();
  for (const w of stagedWorkers) {
    const raw = strOf(w.fields, "field_sirius_ssn");
    const normalized = raw ? normalizeSsn(raw) : null;
    if (normalized) incomingNidsBySsn.set(normalized, [...(incomingNidsBySsn.get(normalized) ?? []), w.nid]);
  }
  interface SsnTransferPlan {
    ssn: string;
    incomingNid: number;
    staleWorkerId: string;
    staleNid: number;
  }
  const ssnTransferByIncomingNid = new Map<number, SsnTransferPlan>();
  for (const [ssn, incomingNids] of incomingNidsBySsn) {
    if (incomingNids.length !== 1) continue;
    const owner = ssnOwner.get(ssn);
    if (!owner) continue;
    const nonStub = owner.mappings.filter((m) => !m.stub);
    // Any absent, stub, or multiple mapping is ambiguous and stays Q36.
    if (owner.mappings.length !== 1 || nonStub.length !== 1) continue;
    const staleNid = nonStub[0].nid;
    if (staleNid === incomingNids[0] || stagedWorkerNids.has(staleNid)) continue;
    ssnTransferByIncomingNid.set(incomingNids[0], {
      ssn,
      incomingNid: incomingNids[0],
      staleWorkerId: owner.workerId,
      staleNid,
    });
  }
  let ssnTransfersPlanned = ssnTransferByIncomingNid.size;
  let ssnTransfersApplied = 0;
  // sirius_id → owning S2 worker id (collision pre-check + assign base), plus
  // the reverse (row → current sirius_id) so rekeys keep both in sync
  const siriusRes = await db.execute(sql`SELECT id, sirius_id FROM workers`);
  const siriusOwner = new Map(
    (siriusRes as unknown as { rows: Array<{ id: string; sirius_id: number | string }> }).rows.map((r) => [
      Number(r.sirius_id),
      r.id,
    ]),
  );
  const rowSirius = new Map(
    (siriusRes as unknown as { rows: Array<{ id: string; sirius_id: number | string }> }).rows.map((r) => [
      r.id,
      Number(r.sirius_id),
    ]),
  );
  // keep ownership maps exact when a row is created or rekeyed — a freed old
  // value (e.g. a repaired nid) must stop looking "owned"
  const rekeyOwnerMaps = (rowId: string, newVal: number) => {
    const old = rowSirius.get(rowId);
    if (old != null && siriusOwner.get(old) === rowId) siriusOwner.delete(old);
    siriusOwner.set(newVal, rowId);
    rowSirius.set(rowId, newVal);
  };
  // workers.data by row id — storage worker reads strip `data`
  // (stripWorkerData), so the aatRequired merge/compare needs a direct read.
  const wdataRes = await db.execute(sql`SELECT id, data FROM workers WHERE data IS NOT NULL`);
  const workerDataById = new Map(
    (wdataRes as unknown as { rows: Array<{ id: string; data: unknown }> }).rows.map((r) => [
      r.id,
      (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown>,
    ]),
  );

  // gender resolution: options_gender by lowered name (term remap fallback)
  const genderRes = await db.execute(sql`SELECT id, name FROM options_gender`);
  const genderByName = new Map(
    (genderRes as unknown as { rows: Array<{ id: string; name: string }> }).rows.map((r) => [r.name.toLowerCase(), r.id]),
  );
  const termMap = await getMappings(
    "term",
    stagedWorkers.map((w) => tidOf(w.fields, "field_sirius_gender")).filter((t): t is number => t != null),
  );
  // tid → staged term name (sirius_gender vocab may not be migrated as options)
  const gtids = Array.from(
    new Set(stagedWorkers.map((w) => tidOf(w.fields, "field_sirius_gender")).filter((t): t is number => t != null)),
  );
  const termNameByTid = new Map<number, string>();
  // chunk to stay far below the 65535 bind-parameter protocol limit
  for (let i = 0; i < gtids.length; i += 10000) {
    const chunk = gtids.slice(i, i + 10000);
    const tres = await db.execute(sql`
      SELECT tid, name FROM s1_staging.terms WHERE tid IN (${sql.join(chunk.map((t) => sql`${t}`), sql`, `)})
    `);
    for (const r of (tres as unknown as { rows: Array<{ tid: string | number; name: string }> }).rows) {
      termNameByTid.set(Number(r.tid), r.name);
    }
  }
  const resolveGenderId = (tid: number | null): string | null => {
    if (tid == null) return null;
    const viaMap = termMap.get(tid);
    if (viaMap) return viaMap.s2Id; // sirius_gender loaded as options terms
    const name = termNameByTid.get(tid);
    if (name) return genderByName.get(name.toLowerCase()) ?? null;
    return null;
  };

  // ---------------- contacts pass ----------------
  const cStats = {
    matched: 0,
    adoptedStubContact: 0,
    created: 0,
    updated: 0,
    phonesCreated: 0,
    phonesRemoved: 0,
    addressesUpserted: 0,
    addressesMatched: 0,
    addressesRemoved: 0,
  };
  // per-address suppression counts (address → count); populated by both the
  // new-contact and existing-contact code paths
  const suppressions = new Map<string, number>();

  /** Reconcile an EXISTING contact row to the staged values (adopted stubs
   * and already-mapped rows — makes crash-interrupted absorption resumable).
   * S1-wins: staged values overwrite, including CLEARING fields whose S1
   * source vanished (email/birthDate/gender) — but a value we could not
   * apply (duplicate email) or could not parse (bad dob, unresolved gender)
   * keeps the existing value and stays a visible reject.
   * Only writes fields that differ; returns count of update calls. */
  const reconcileContact = async (
    contactId: string,
    cNid: number,
    vals: {
      parts: NameParts | null;
      displayName: string;
      email: string | null;
      birthDate: string | null;
      /** false when the dob source exists but failed to parse (keep existing) */
      reconcileBirthDate: boolean;
      genderId: string | null;
      genderNota: string | null;
      /** false when the gender tid exists but did not resolve (keep existing) */
      reconcileGender: boolean;
    },
  ): Promise<number> => {
    let writes = 0;
    const existing = await storage.contacts.getContact(contactId);
    if (!existing) return writes;
    if (vals.parts) {
      const drift =
        (vals.parts.title ?? null) !== (existing.title ?? null) ||
        (vals.parts.given ?? null) !== (existing.given ?? null) ||
        (vals.parts.middle ?? null) !== (existing.middle ?? null) ||
        (vals.parts.family ?? null) !== (existing.family ?? null) ||
        (vals.parts.generational ?? null) !== (existing.generational ?? null) ||
        (vals.parts.credentials ?? null) !== (existing.credentials ?? null);
      if (drift) {
        await withNotificationsSuppressed(() =>
          storage.contacts.updateNameComponents(contactId, {
            title: vals.parts!.title ?? undefined,
            given: vals.parts!.given ?? undefined,
            middle: vals.parts!.middle ?? undefined,
            family: vals.parts!.family ?? undefined,
            generational: vals.parts!.generational ?? undefined,
            credentials: vals.parts!.credentials ?? undefined,
          }),
        );
        writes++;
      }
    } else if (existing.displayName !== vals.displayName) {
      await withNotificationsSuppressed(() => storage.contacts.updateName(contactId, vals.displayName));
      writes++;
    }
    let email = vals.email;
    /** true when the desired email could not be APPLIED (owned elsewhere) —
     * never clear the existing value in that case */
    let keepExistingEmail = false;
    // Suppress placeholder emails before the dedupe check (T12 ruling)
    if (email && isPlaceholderEmail(email)) {
      suppressions.set(email, (suppressions.get(email) ?? 0) + 1);
      email = null;
    }
    if (email && emailOwner.has(email) && emailOwner.get(email) !== contactId) {
      rejects.add("duplicate_email", { nid: cNid }, cNid);
      email = null;
      keepExistingEmail = true;
    }
    // If the existing row carries a stale placeholder value written by a prior
    // run (before suppression existed), treat it as null so the rerun clears it
    // rather than leaving the fake address in place.
    const existingEmailNorm = normalizeEmailKey(existing.email);
    const existingIsPlaceholder = existingEmailNorm != null && isPlaceholderEmail(existingEmailNorm);
    const effectiveExistingEmail = existingIsPlaceholder ? null : existingEmailNorm;
    if (email != null && (effectiveExistingEmail !== email || existing.email !== email)) {
      await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId, email));
      if (effectiveExistingEmail != null && emailOwner.get(effectiveExistingEmail) === contactId) {
        emailOwner.delete(effectiveExistingEmail);
      }
      writes++;
    } else if (
      email == null &&
      ((!keepExistingEmail && effectiveExistingEmail != null) || existingIsPlaceholder)
    ) {
      // S1-wins removal (address gone from S1 / suppressed / deferred) — and
      // stale placeholders are cleared even when the desired value is kept
      // elsewhere (never leave a fake address in place).
      await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId, null));
      if (!keepExistingEmail && effectiveExistingEmail != null && emailOwner.get(effectiveExistingEmail) === contactId) {
        emailOwner.delete(effectiveExistingEmail);
      }
      writes++;
    }
    if (email) emailOwner.set(email, contactId);
    if (vals.reconcileBirthDate && (existing.birthDate ?? null) !== (vals.birthDate ?? null)) {
      await withNotificationsSuppressed(() => storage.contacts.updateBirthDate(contactId, vals.birthDate));
      writes++;
    }
    if (vals.reconcileGender) {
      const genderDrift =
        (existing.gender ?? null) !== (vals.genderId ?? null) ||
        (vals.genderId != null && ((existing.genderNota ?? null) !== (vals.genderNota ?? null)));
      if (genderDrift) {
        await withNotificationsSuppressed(() =>
          storage.contacts.updateGender(contactId, vals.genderId, vals.genderNota),
        );
        writes++;
      }
    }
    return writes;
  };

  progress.phase(null); // contacts row loop
  for (const c of stagedContacts) {
    progress.add(1);
    const mapped = contactMap.get(c.nid);
    const fp = contactFpOf(c);
    // Consumed-fingerprint fast path (Task 292): unchanged rows skip ALL
    // storage reads (contact, phones, addresses).
    if (
      !sharedEmailRepairNids.has(c.nid) &&
      classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged"
    ) {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }
    const parts = namePartsOf(c.fields);
    const displayName =
      c.title?.trim() ||
      [parts?.given, parts?.family].filter(Boolean).join(" ").trim() ||
      null;
    if (!displayName) {
      rejects.add("contact_no_name", { nid: c.nid }, c.nid);
      continue;
    }
    processedContacts.push(c);
    /** writes performed for THIS staged row (summary.updated accounting) */
    let rowWrites = 0;
    /** fresh row created this run (already counted summary.created) */
    let isFreshCreate = false;

    let email = normalizeEmailKey(strOf(c.fields, "field_sirius_email"));
    // shared-address ownership (S1 user association) — non-owners and
    // deferred addresses load with email=null
    email = applySharedOwnership(c.nid, email);

    // worker node pre-join: dob / gender / gender_calc live on the worker (§1)
    const wnid = workerNidByContactNid.get(c.nid);
    const w = wnid != null ? stagedWorkerByNid.get(wnid) : undefined;
    const dobRaw = w ? strOf(w.fields, "field_sirius_dob") : null;
    const birthDate = dobRaw ? toYmd(dobRaw) : null;
    if (dobRaw && !birthDate) rejects.add("worker_bad_dob", { workerNid: wnid, contactNid: c.nid });
    const genderTid = w ? tidOf(w.fields, "field_sirius_gender") : null;
    const genderId = resolveGenderId(genderTid);
    if (genderTid != null && !genderId) rejects.add("worker_gender_unresolved", { workerNid: wnid, tid: genderTid });
    const genderCalc = w ? strOf(w.fields, "field_sirius_gender_nota_calc") : null;
    const genderNota = w ? strOf(w.fields, "field_sirius_gender_nota_val") : null;
    // dob/gender clear ONLY when a worker source exists and the field is
    // genuinely absent — a parse/resolution failure keeps the existing value
    const reconcileBirthDate = w != null && !(dobRaw != null && birthDate == null);
    const reconcileGender = w != null && !(genderTid != null && genderId == null);

    let contactId = mapped?.s2Id;

    if (!contactId) {
      // stub absorption: adopt the stub worker's auto-created contact
      const stubWorker = wnid != null ? workerMap.get(wnid) : undefined;
      if (stubWorker?.stub) {
        const worker = await storage.workers.getWorker(stubWorker.s2Id);
        if (!worker) {
          rejects.add("stub_worker_missing", { workerNid: wnid, s2Id: stubWorker.s2Id });
          continue;
        }
        contactId = worker.contactId;
        cStats.adoptedStubContact++;
        if (!DRY_RUN) {
          const fieldWrites = await reconcileContact(contactId, c.nid, {
            parts,
            displayName,
            email,
            birthDate,
            reconcileBirthDate,
            genderId,
            genderNota,
            reconcileGender,
          });
          cStats.updated += fieldWrites;
          rowWrites += fieldWrites;
        }
      } else {
        // fresh contact
        // Suppress placeholder emails before the dedupe check (T12 ruling)
        if (email && isPlaceholderEmail(email)) {
          suppressions.set(email, (suppressions.get(email) ?? 0) + 1);
          email = null;
        }
        if (email && emailOwner.has(email)) {
          rejects.add("duplicate_email", { nid: c.nid }, c.nid);
          email = null;
        }
        isFreshCreate = true;
        cStats.created++;
        summary.created++;
        if (!DRY_RUN) {
          const created = await withNotificationsSuppressed(() =>
            storage.contacts.createContact({
              title: parts?.title ?? null,
              given: parts?.given ?? null,
              middle: parts?.middle ?? null,
              family: parts?.family ?? null,
              generational: parts?.generational ?? null,
              credentials: parts?.credentials ?? null,
              displayName,
              email,
              birthDate,
              gender: genderId,
              genderNota,
              genderCalc,
            }),
          );
          contactId = created.id;
          if (email) emailOwner.set(email, contactId);
        }
      }
      if (!DRY_RUN && contactId) {
        const winner = await putMapping("contact", c.nid, contactId, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
        if (winner !== contactId) {
          console.error(`RACE: contact nid ${c.nid} already mapped to ${winner}; row ${contactId} may be an orphan`);
          contactId = winner;
        }
      }
    } else {
      // already mapped — reconcile drift (S1-wins full field coverage)
      cStats.matched++;
      if (!DRY_RUN) {
        const fieldWrites = await reconcileContact(contactId, c.nid, {
          parts,
          displayName,
          email,
          birthDate,
          reconcileBirthDate,
          genderId,
          genderNota,
          reconcileGender,
        });
        cStats.updated += fieldWrites;
        rowWrites += fieldWrites;
      }
    }

    // Fingerprint advance for pre-existing mappings — deferred to after
    // verify. Rows with a cross-row-dependent deferral (duplicate email)
    // never advance: they retry every run until the blocker clears.
    const finishRow = () => {
      if (mapped) {
        if (!rejects.has("duplicate_email", c.nid)) {
          pendingContactAdvance.push({ s1Id: c.nid, fingerprint: fp });
        }
        if (rowWrites > 0) summary.updated++;
        else summary.unchanged++; // reconciled, proven drift-free
      } else if (!isFreshCreate) {
        // stub-adopt: new mapping onto an existing row (fingerprint stamped
        // at putMapping) — counts as updated when anything was written
        if (rowWrites > 0) summary.updated++;
        else summary.unchanged++;
      }
    };

    if (DRY_RUN || !contactId) {
      finishRow();
      continue;
    }

    // phones (T5) — SET reconcile per contact: desired = S1 numbers; rows
    // with loader-owned friendly names not in the desired set are deleted
    // (S1-wins); operator-added names are never touched.
    const phoneSpecs: Array<{ key: string; friendly: string; primary: boolean }> = [
      { key: "field_sirius_phone", friendly: "Primary", primary: true },
      { key: "field_sirius_phone_alt", friendly: "Alt", primary: false },
    ];
    const desiredPhones: Array<{ e164: string; friendly: string; primary: boolean }> = [];
    for (const spec of phoneSpecs) {
      const raw = strOf(c.fields, spec.key);
      if (!raw) continue;
      const e164 = toE164(raw);
      if (!e164) {
        rejects.add("phone_invalid", { nid: c.nid, field: spec.key });
        continue;
      }
      desiredPhones.push({ e164, friendly: spec.friendly, primary: spec.primary });
    }
    const desiredNumbers = new Set(desiredPhones.map((d) => d.e164));
    const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
    const remainingPhones: typeof existingPhones = [];
    for (const p of existingPhones) {
      if (LOADER_PHONE_NAMES.has(p.friendlyName ?? "") && !desiredNumbers.has(p.phoneNumber)) {
        await withNotificationsSuppressed(() => storage.contacts.phoneNumbers.deletePhoneNumber(p.id));
        cStats.phonesRemoved++;
        rowWrites++;
      } else {
        remainingPhones.push(p);
      }
    }
    const presentNumbers = new Set(remainingPhones.map((p) => p.phoneNumber));
    for (const d of desiredPhones) {
      if (presentNumbers.has(d.e164)) continue;
      await withNotificationsSuppressed(() =>
        storage.contacts.phoneNumbers.createPhoneNumber({
          contactId: contactId!,
          phoneNumber: d.e164,
          friendlyName: d.friendly,
          isPrimary: d.primary && !remainingPhones.some((p) => p.isPrimary),
        }),
      );
      presentNumbers.add(d.e164);
      cStats.phonesCreated++;
      rowWrites++;
    }

    // address (T13) — SET reconcile: S1 stages at most ONE address; existing
    // import-sourced rows that no longer match it are deleted (S1-wins).
    // Rows with any other source (worker_self/admin/…) are operator-owned.
    // An INCOMPLETE staged address rejects and touches nothing (the source
    // still has an address; we just cannot load it).
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const zip5 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 5);
    const addrRaw = scalarOf(c.fields["field_sirius_address"]);
    let desiredAddr: { street: string; city: string; state: string; postalCode: string; country: string } | null = null;
    let addrIncomplete = false;
    let latitude: number | undefined;
    let longitude: number | undefined;
    let accuracy: string | undefined;
    if (addrRaw && typeof addrRaw === "object") {
      const a = addrRaw as Record<string, unknown>;
      const pick = (k: string) => {
        const v = a[k];
        return v == null ? null : String(v).trim() || null;
      };
      const street = [pick("thoroughfare"), pick("premise")].filter(Boolean).join(" ");
      const city = pick("locality");
      const state = pick("administrative_area");
      const postalCode = pick("postal_code");
      const country = pick("country") ?? "US";
      if (!street || !city || !state || !postalCode) {
        rejects.add("address_incomplete", { nid: c.nid });
        addrIncomplete = true;
      } else {
        desiredAddr = { street, city, state, postalCode, country };
        const geo = scalarOf(c.fields["field_sirius_address_geo"]);
        if (geo && typeof geo === "object") {
          const g = geo as Record<string, unknown>;
          const left = Number(g.left), right = Number(g.right), top = Number(g.top), bottom = Number(g.bottom);
          if (Number.isFinite(left) && Number.isFinite(top) && left === right && top === bottom) {
            longitude = left;
            latitude = top;
          } else {
            rejects.add("geo_bbox_not_degenerate", { nid: c.nid }); // T13 assertion
          }
        }
        accuracy = strOf(c.fields, "field_sirius_address_accuracy") ?? undefined;
      }
    }
    if (!addrIncomplete) {
      const equivalent = (e: { street: string | null; city: string | null; state: string | null; postalCode: string | null }) =>
        desiredAddr != null &&
        norm(e.street) === norm(desiredAddr.street) &&
        norm(e.city) === norm(desiredAddr.city) &&
        norm(e.state) === norm(desiredAddr.state) &&
        zip5(e.postalCode) === zip5(desiredAddr.postalCode);
      // Soft-delete semantics: deleteContactPostal flips isActive=false (rows
      // stay in the table). Reconcile must only consider ACTIVE rows — else the
      // already-check can match a dead row and skip re-creating an address S1
      // still stages, and long-inactive import rows get "removed" again on
      // every run (counter churn that defeats the no-write fast path).
      const existingAddrs = (
        await storage.contacts.addresses.getContactPostalByContact(contactId)
      ).filter((e) => e.isActive);
      // remove import-owned rows that no longer match the staged address
      // (including ALL import rows when S1 no longer stages one)
      for (const e of existingAddrs) {
        if (e.source === "import" && !equivalent(e)) {
          await withNotificationsSuppressed(() => storage.contacts.addresses.deleteContactPostal(e.id));
          cStats.addressesRemoved++;
          rowWrites++;
        }
      }
      if (desiredAddr) {
        // re-run guard: skip storage entirely when an equivalent row already
        // exists (createOrMatchAddress touches updatedAt even on a match)
        const already = existingAddrs.some(
          (e) => equivalent(e) && (latitude == null || e.latitude != null),
        );
        if (already) {
          cStats.addressesMatched++;
        } else {
          await withNotificationsSuppressed(() =>
            storage.contacts.addresses.createOrMatchAddress(
              contactId!,
              desiredAddr,
              "import",
              { latitude, longitude, accuracy },
            ),
          );
          cStats.addressesUpserted++;
          rowWrites++;
        }
      }
    }
    finishRow();
  }
  report.contacts = cStats;
  // Aggregate only: email values never enter output.
  if (suppressions.size > 0) {
    report.placeholderEmailsSuppressed = {
      addresses: suppressions.size,
      contacts: [...suppressions.values()].reduce((sum, count) => sum + count, 0),
    };
  }
  // Shared-address ownership report — one entry per shared address, keyed by
  // contact nids only (addresses are PII and never printed; any member nid
  // resolves the address in S1). deferredNoOwner entries are the follow-up
  // worklist for the fund's ownership ruling.
  if (sharedEmailPlan.size > 0) {
    const entries = [...sharedEmailPlan.values()].map((p) => ({
      rule: p.rule,
      winnerNid: p.winnerNid,
      ...(p.ownerUid != null ? { ownerUid: p.ownerUid } : {}),
      memberNids: p.memberNids,
      nulled: p.nulled,
    }));
    const countBy = (rule: SharedEmailPlan["rule"]) => entries.filter((e) => e.rule === rule).length;
    report.sharedEmails = {
      addresses: sharedEmailPlan.size,
      byUserAccount: countBy("byUserAccount"),
      deferredNoOwner: countBy("deferredNoOwner"),
      deferredMultipleOwners: countBy("deferredMultipleOwners"),
      contactsNulled: entries.reduce((n, e) => n + e.nulled, 0),
      clearedOnRerun: sharedEmailsCleared,
      clearPlanned: sharedEmailsClearPlanned,
      entries,
    };
  }

  // ---------------- workers pass ----------------
  // worker-id types (06 §4.9) via unified options — ensure by name
  const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
  const options = createUnifiedOptionsStorage();
  const LEGACY_NID_SIRIUS_ID = "s1-legacy-nid"; // stable seed so re-runs find the type
  const idTypeByLabel = new Map<string, string>();
  let oldSiriusIdTypeId: string | null = null; // legacy "Sirius ID" type — repair only, never created
  {
    const rows: Array<{ id: string; name: string }> = await options.list("worker-id-type");
    const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
    for (const label of ["Union ID", "External ID", "AAT"]) {
      let id = byName.get(label.toLowerCase());
      if (!id && !DRY_RUN) {
        const created = await withNotificationsSuppressed(() => options.create("worker-id-type", { name: label }));
        id = created.id;
      }
      if (id) idTypeByLabel.set(label, id);
    }
    // "Legacy NID": resolve by stable sirius_id first, then adopt by name
    // (patching the sirius_id in), else create with the stable seed.
    let legacyId = await storage.workerIds.getTypeIdBySiriusId(LEGACY_NID_SIRIUS_ID);
    if (!legacyId) {
      const byNameHit = byName.get("legacy nid");
      if (byNameHit) {
        legacyId = byNameHit;
        if (!DRY_RUN) {
          await withNotificationsSuppressed(() =>
            options.update("worker-id-type", byNameHit, { siriusId: LEGACY_NID_SIRIUS_ID }),
          );
        }
      } else if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          options.create("worker-id-type", { name: "Legacy NID", siriusId: LEGACY_NID_SIRIUS_ID }),
        );
        legacyId = created.id;
      }
    }
    if (legacyId) idTypeByLabel.set("Legacy NID", legacyId);
    oldSiriusIdTypeId = byName.get("sirius id") ?? null;
  }

  const wStats = {
    matched: 0,
    absorbedStubs: 0,
    created: 0,
    updated: 0,
    workerIdsCreated: 0,
    workerIdsRemoved: 0,
    siriusIdAssigned: 0,
    oldMappingRepaired: 0,
    oldSiriusIdRowsRemoved: 0,
    parkedForRekey: 0,
  };
  const finalContactMap = await getMappings("contact", stagedContacts.map((c) => c.nid));

  // ---- sirius_id resolution (T1, ruling 2026-08-06) ----
  const fsidOf = (w: StagedNode): { value: number | null; raw: string | null } => {
    const raw = strOf(w.fields, "field_sirius_id");
    if (raw == null) return { value: null, raw: null };
    return /^\d+$/.test(raw) ? { value: Number(raw), raw } : { value: null, raw };
  };
  // cross-worker staged collisions: first (lowest nid — stagedWorkers is
  // nid-ordered) wins
  const fsidFirstOwner = new Map<number, number>(); // fsid → first nid
  for (const w of stagedWorkers) {
    const { value } = fsidOf(w);
    if (value != null && !fsidFirstOwner.has(value)) fsidFirstOwner.set(value, w.nid);
  }
  // assign counter for missing/invalid field_sirius_id: above BOTH the staged
  // field_sirius_id range and everything already in the DB (nids from an
  // old-mapping load included), so assignment can never collide.
  let nextAssigned = nextSiriusId(fsidFirstOwner.keys(), siriusOwner.keys());

  // ---- collision-safe repair pre-pass (swaps/cycles among old values) ----
  // Plan every already-mapped worker's target sirius_id first; any mapped row
  // whose CURRENT value blocks a DIFFERENT mapped worker's target — while the
  // row itself is scheduled to move elsewhere — is PARKED on a temporary
  // non-conflicting value. Sequential updates in the main loop then can't
  // trip the (sirius_id) unique constraint, and true external ownership
  // (a row that keeps its value) still rejects in the main loop.
  if (!DRY_RUN) {
    const plannedByRow = new Map<string, number>(); // s2 row id → target sirius_id
    for (const w of stagedWorkers) {
      const m = workerMap.get(w.nid);
      if (!m) continue;
      const { value } = fsidOf(w);
      if (value != null && fsidFirstOwner.get(value) === w.nid) plannedByRow.set(m.s2Id, value);
    }
    const targetWanter = new Map<number, string>(); // target value → row that wants it
    for (const [rowId, t] of plannedByRow) targetWanter.set(t, rowId);
    let parkNext = nextAssigned + 1_000_000; // parked values sit far above assigns
    for (const [rowId, cur] of [...rowSirius]) {
      const wanter = targetWanter.get(cur);
      if (!wanter || wanter === rowId) continue; // nobody else wants this value
      const ownTarget = plannedByRow.get(rowId);
      if (ownTarget == null || ownTarget === cur) continue; // true owner — main loop rejects the wanter
      const parked = parkNext++;
      await withNotificationsSuppressed(() =>
        storage.workers.updateWorkerForMigration(rowId, { siriusId: parked }),
      );
      rekeyOwnerMaps(rowId, parked);
      wStats.parkedForRekey++;
    }
  }

  for (const w of stagedWorkers) {
    progress.add(1);
    const mapped = workerMap.get(w.nid);
    const fp = w.contentHash;
    // Consumed-fingerprint fast path — unchanged workers skip all storage
    // reads (worker row, worker_ids). Stub mappings always classify changed.
    // An unchanged source fingerprint must not hide a newly-safe SSN repair:
    // ownership depends on another row disappearing from current staging.
    const ssnTransferPlan = ssnTransferByIncomingNid.get(w.nid);
    if (!ssnTransferPlan && classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips++;
      continue;
    }
    processedWorkers.push(w);
    let rowWrites = 0;
    const cnid = targetNidOf(w.fields, "field_sirius_contact");
    const contactMapping = cnid != null ? finalContactMap.get(cnid) : undefined;
    if (!contactMapping) {
      rejects.add("worker_contact_unresolved", { workerNid: w.nid, contactNid: cnid }, w.nid);
      continue;
    }

    // ssn (T3)
    const ssnRaw = strOf(w.fields, "field_sirius_ssn");
    let ssn: string | null = null;
    let approvedSsnTransfer: SsnTransferPlan | undefined;
    if (ssnRaw) {
      ssn = normalizeSsn(ssnRaw);
      if (!ssn) rejects.add("ssn_not_9_digits", { workerNid: w.nid });
      else {
        const owner = ssnOwner.get(ssn);
        const ownerIsIncoming = mapped != null && owner?.workerId === mapped.s2Id;
        if (owner && !ownerIsIncoming) {
          const transfer = ssnTransferByIncomingNid.get(w.nid);
          if (!transfer || transfer.ssn !== ssn || transfer.staleWorkerId !== owner.workerId) {
            rejects.add("ssn_collision_q36", { workerNid: w.nid }, w.nid);
            ssn = null;
          } else {
            approvedSsnTransfer = transfer;
          }
        }
      }
    }

    const aatRequired = yesNo(strOf(w.fields, "field_sirius_aat_required"));

    let workerId = mapped?.s2Id;

    // ---- resolve target sirius_id (T1 ruling: field_sirius_id) ----
    const { value: fsid, raw: fsidRaw } = fsidOf(w);
    if (fsidRaw != null && fsid == null) {
      rejects.add("sirius_id_not_numeric", { workerNid: w.nid }, w.nid);
    }
    if (fsid != null && fsidFirstOwner.get(fsid) !== w.nid) {
      // Unreachable after the fatal pre-scan — kept as defense in depth.
      // A collision must NEVER load partially (no first-wins).
      throw new Error(
        `sirius_id collision reached the load loop (fsid=${fsid}, nids ${fsidFirstOwner.get(fsid)}/${w.nid}) — aborting`,
      );
    }
    if (fsid != null) {
      const ownerRow = siriusOwner.get(fsid);
      if (ownerRow && (!mapped || ownerRow !== mapped.s2Id)) {
        // A DIFFERENT S2 worker row (not mapped to this nid) already owns this
        // member number — a cross-run person collision. Same ruling as the
        // pre-scan: fatal, never auto-resolved, no allow flag. The loader is
        // idempotent; nothing about this staged worker was written.
        throw new Error(
          `FATAL sirius_id collision: staged worker nid ${w.nid} claims sirius_id ${fsid}, ` +
            `already owned by a different S2 worker row. Never auto-resolved (distinct people) — ` +
            `triage with the fund, then re-run.`,
        );
      }
    }
    let expectedSirius: number;
    if (fsid != null) {
      expectedSirius = fsid;
    } else {
      // missing/invalid field_sirius_id — documented rule: adopt an existing
      // non-nid value (a prior run's assignment), else sequence-assign + note
      const existingRow = mapped && !DRY_RUN ? await storage.workers.getWorker(mapped.s2Id) : undefined;
      if (existingRow && existingRow.siriusId !== w.nid) {
        expectedSirius = existingRow.siriusId;
      } else {
        expectedSirius = nextAssigned++;
        wStats.siriusIdAssigned++;
        rejects.add("sirius_id_assigned", { workerNid: w.nid, assigned: expectedSirius }, w.nid);
      }
    }

    /** workers.data reconcile: merge aatRequired into the existing data
     * object (other keys preserved); remove the key when the S1 field is
     * gone. Compares canonically — jsonb reorders keys. */
    const desiredDataOf = (rowId: string | null): { value: Record<string, unknown> | null; drift: boolean } => {
      const existing = rowId ? (workerDataById.get(rowId) ?? null) : null;
      const base: Record<string, unknown> = { ...(existing ?? {}) };
      if (aatRequired == null) delete base.aatRequired;
      else base.aatRequired = aatRequired;
      const value = Object.keys(base).length === 0 ? null : base;
      return { value, drift: canonicalJson(value) !== canonicalJson(existing) };
    };

    if (mapped && !mapped.stub) {
      // already loaded — reconcile drift (S1-wins full field coverage)
      wStats.matched++;
      if (!DRY_RUN) {
        const worker = await storage.workers.getWorker(mapped.s2Id);
        if (!worker) {
          rejects.add("mapped_worker_missing", { workerNid: w.nid, s2Id: mapped.s2Id });
          continue;
        }
        if (worker.siriusId === w.nid && worker.siriusId !== expectedSirius) {
          wStats.oldMappingRepaired++; // row loaded under the old nid-based mapping
        }
        const dataPlan = desiredDataOf(mapped.s2Id);
        const drift =
          worker.siriusId !== expectedSirius ||
          (worker.ssn ?? null) !== ssn ||
          worker.contactId !== contactMapping.s2Id ||
          dataPlan.drift;
        if (drift) {
          await runInTransaction(async () => {
            if (approvedSsnTransfer) {
              await withNotificationsSuppressed(() =>
                storage.workers.updateWorkerForMigration(approvedSsnTransfer!.staleWorkerId, { ssn: null }),
              );
            }
            await withNotificationsSuppressed(() =>
              storage.workers.updateWorkerForMigration(mapped.s2Id, {
                siriusId: expectedSirius,
                contactId: contactMapping.s2Id,
                ssn,
                data: dataPlan.value,
              }),
            );
          });
          if (approvedSsnTransfer) {
            workerSsn.delete(approvedSsnTransfer.staleWorkerId);
            ssnTransfersApplied++;
          }
          rekeyOwnerMaps(mapped.s2Id, expectedSirius);
          const oldSsn = workerSsn.get(mapped.s2Id);
          if (oldSsn && oldSsn !== ssn && ssnOwner.get(oldSsn)?.workerId === mapped.s2Id) ssnOwner.delete(oldSsn);
          if (ssn) {
            ssnOwner.set(ssn, { workerId: mapped.s2Id, mappings: [{ nid: w.nid, stub: false }] });
            workerSsn.set(mapped.s2Id, ssn);
          } else {
            workerSsn.delete(mapped.s2Id);
          }
          if (dataPlan.value == null) workerDataById.delete(mapped.s2Id);
          else workerDataById.set(mapped.s2Id, dataPlan.value);
          wStats.updated++;
          rowWrites++;
        }
      }
      if (ssn && !DRY_RUN) ssnOwner.set(ssn, { workerId: mapped.s2Id, mappings: [{ nid: w.nid, stub: false }] });
    } else if (mapped?.stub) {
      wStats.absorbedStubs++;
      if (!DRY_RUN) {
        const worker = await storage.workers.getWorker(mapped.s2Id);
        if (!worker) {
          rejects.add("stub_worker_missing", { workerNid: w.nid, s2Id: mapped.s2Id });
          continue;
        }
        if (worker.contactId !== contactMapping.s2Id) {
          // contacts pass should have adopted the stub's contact — a mismatch
          // means the contact node mapped elsewhere first; repoint and log
          rejects.add("stub_contact_repointed", { workerNid: w.nid });
        }
        const dataPlan = desiredDataOf(mapped.s2Id);
        await runInTransaction(async () => {
          if (approvedSsnTransfer) {
            await withNotificationsSuppressed(() =>
              storage.workers.updateWorkerForMigration(approvedSsnTransfer!.staleWorkerId, { ssn: null }),
            );
          }
          await withNotificationsSuppressed(() =>
            storage.workers.updateWorkerForMigration(mapped.s2Id, {
              siriusId: expectedSirius,
              contactId: contactMapping.s2Id,
              ssn,
              data: dataPlan.value,
            }),
          );
        });
        if (approvedSsnTransfer) {
          workerSsn.delete(approvedSsnTransfer.staleWorkerId);
          ssnTransfersApplied++;
        }
        rekeyOwnerMaps(mapped.s2Id, expectedSirius);
        if (dataPlan.value == null) workerDataById.delete(mapped.s2Id);
        else workerDataById.set(mapped.s2Id, dataPlan.value);
        if (ssn) {
          ssnOwner.set(ssn, { workerId: mapped.s2Id, mappings: [{ nid: w.nid, stub: false }] });
          workerSsn.set(mapped.s2Id, ssn);
        }
        await markAbsorbed("worker", w.nid, LOADER);
        rowWrites++;
      }
    } else {
      wStats.created++;
      summary.created++;
      if (!DRY_RUN) {
        const data = aatRequired == null ? null : { aatRequired };
        const created = await runInTransaction(async () => {
          if (approvedSsnTransfer) {
            await withNotificationsSuppressed(() =>
              storage.workers.updateWorkerForMigration(approvedSsnTransfer!.staleWorkerId, { ssn: null }),
            );
          }
          return withNotificationsSuppressed(() =>
            storage.workers.createWorkerForMigration({
              siriusId: expectedSirius,
              contactId: contactMapping.s2Id,
              ssn,
              data,
            }),
          );
        });
        if (approvedSsnTransfer) {
          workerSsn.delete(approvedSsnTransfer.staleWorkerId);
          ssnTransfersApplied++;
        }
        workerId = created.id;
        rekeyOwnerMaps(created.id, expectedSirius);
        if (data) workerDataById.set(created.id, data);
        if (ssn) {
          ssnOwner.set(ssn, { workerId: created.id, mappings: [{ nid: w.nid, stub: false }] });
          workerSsn.set(created.id, ssn);
        }
        const winner = await putMapping("worker", w.nid, created.id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
        if (winner !== created.id) {
          console.error(`RACE: worker nid ${w.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
          workerId = winner;
        }
      }
    }

    const finishWorkerRow = () => {
      if (mapped) {
        if (!rejects.has("ssn_collision_q36", w.nid) && !rejects.has("worker_id_value_collision", w.nid)) {
          pendingWorkerAdvance.push({ s1Id: w.nid, fingerprint: fp });
        }
        if (!mapped.stub) {
          if (rowWrites > 0) summary.updated++;
          else summary.unchanged++; // reconciled, proven drift-free
        } else {
          summary.updated++; // stub absorption always writes
        }
      }
    };

    if (DRY_RUN || !workerId) {
      finishWorkerRow();
      continue;
    }

    // worker_ids (06 §4.9, amended 2026-08-06) — SET reconcile per loader
    // type: S2 rows of the four loader types converge to exactly the S1
    // value (changed → old row deleted + new created; removed → deleted).
    // (type,value) UNIQUE — cross-worker collisions are rejects. Rows under
    // any OTHER type (operator-defined) are never touched. NO "Sirius ID"
    // row anymore — the value lives on workers.sirius_id; the nid loads as
    // "Legacy NID".
    const idSpecs: Array<{ key: string | null; label: string; fixedValue?: string }> = [
      { key: null, label: "Legacy NID", fixedValue: String(w.nid) },
      { key: "field_sirius_id2", label: "Union ID" },
      { key: "field_sirius_id3", label: "External ID" },
      { key: "field_sirius_aat", label: "AAT" },
    ];
    const existingIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
    const removedIdRows = new Set<string>();
    // repair: drop the old-mapping "Sirius ID" row (loader-created — its value
    // equals the staged field_sirius_id); operator rows with other values stay
    if (oldSiriusIdTypeId && fsidRaw != null) {
      for (const e of existingIds) {
        if (e.typeId === oldSiriusIdTypeId && e.value === fsidRaw) {
          await withNotificationsSuppressed(() => storage.workerIds.deleteWorkerId(e.id));
          removedIdRows.add(e.id);
          wStats.oldSiriusIdRowsRemoved++;
        }
      }
    }
    for (const spec of idSpecs) {
      const value = spec.fixedValue ?? (spec.key ? strOf(w.fields, spec.key) : null);
      const typeId = idTypeByLabel.get(spec.label);
      if (!typeId) {
        if (value) rejects.add("worker_id_type_missing", { label: spec.label });
        continue;
      }
      // S1-wins set reconcile: delete loader-type rows whose value is not
      // the (single) current S1 value — including ALL rows when S1 no longer
      // carries the field.
      for (const e of existingIds) {
        if (removedIdRows.has(e.id) || e.typeId !== typeId) continue;
        if (value == null || e.value !== value) {
          await withNotificationsSuppressed(() => storage.workerIds.deleteWorkerId(e.id));
          removedIdRows.add(e.id);
          wStats.workerIdsRemoved++;
          rowWrites++;
        }
      }
      if (!value) continue;
      if (existingIds.some((e) => !removedIdRows.has(e.id) && e.typeId === typeId && e.value === value)) continue;
      const clash = await storage.workerIds.getWorkerIdByTypeAndValue(typeId, value);
      if (clash && !removedIdRows.has(clash.id)) {
        if (clash.workerId !== workerId) {
          rejects.add("worker_id_value_collision", { workerNid: w.nid, label: spec.label }, w.nid);
        }
        continue;
      }
      await withNotificationsSuppressed(() =>
        storage.workerIds.createWorkerId({ workerId, typeId, value }),
      );
      wStats.workerIdsCreated++;
      rowWrites++;
    }
    finishWorkerRow();
  }
  report.workers = wStats;

  // ---------------- setval (T1 — the one raw-SQL write, spec-sanctioned) ----------------
  // max(sirius_id) now reflects the field_sirius_id value space (plus any
  // sequence-assigned ids above it) — NOT the nid space. Shell workers
  // (relationships loader) and app-created workers allocate above this.
  if (!DRY_RUN) {
    await db.execute(sql`
      SELECT setval(pg_get_serial_sequence('workers','sirius_id'), (SELECT max(sirius_id) FROM workers))
    `);
  }

  // ---------------- verify pass ----------------
  // Scoped to rows PROCESSED this run (fast-path rows were verified when
  // last processed; --force-reconcile re-verifies the whole population).
  progress.phase("verify", processedContacts.length + processedWorkers.length);
  let verifyFailures = 0;
  const verifyFailedContactNids = new Set<number>();
  const verifyFailedWorkerNids = new Set<number>();
  if (!DRY_RUN) {
    const planMemberNids = [...sharedEmailPlan.values()].flatMap((p) => p.memberNids);
    const workerCnids = processedWorkers
      .map((w) => targetNidOf(w.fields, "field_sirius_contact"))
      .filter((n): n is number => n != null);
    const vContactMap = await getMappings("contact", [
      ...new Set([...processedContacts.map((c) => c.nid), ...planMemberNids, ...workerCnids]),
    ]);
    for (const c of processedContacts) {
      progress.add(1);
      const m = vContactMap.get(c.nid);
      if (!m) {
        if (!rejects.has("contact_no_name", c.nid)) {
          console.error(`VERIFY: contact nid ${c.nid} has no id_map entry`);
          verifyFailures++;
          verifyFailedContactNids.add(c.nid);
        }
        continue;
      }
      const row = await storage.contacts.getContact(m.s2Id);
      if (!row) {
        console.error(`VERIFY: contact nid ${c.nid} maps to missing row ${m.s2Id}`);
        verifyFailures++;
        verifyFailedContactNids.add(c.nid);
      }
    }

    // Verify no placeholder address slipped through to contacts.email
    {
      const phList = [...PLACEHOLDER_EMAILS];
      const phCheck = await db.execute(sql`
        SELECT lower(trim(email)) AS email, count(*)::int AS cnt
          FROM contacts
         WHERE lower(trim(email)) IN (${sql.join(phList.map((e) => sql`${e}`), sql`, `)})
         GROUP BY lower(trim(email))
      `);
      const leaks = (phCheck as unknown as { rows: Array<{ email: string; cnt: number }> }).rows;
      if (leaks.length > 0) {
        console.error(
          `VERIFY: ${leaks.reduce((sum, r) => sum + Number(r.cnt), 0)} contact(s) still carry placeholder emails across ${leaks.length} address(es)`,
        );
        verifyFailures += leaks.length;
      }
      // Log safe aggregates only.
      if (suppressions.size > 0) {
        console.log(
          `placeholder emails suppressed: ${[...suppressions.values()].reduce((sum, count) => sum + count, 0)} contact(s) across ${suppressions.size} address(es)`,
        );
      }
    }

    // Shared-address ownership: the owner carries the address, nobody else
    // does. (Skips the owner check when the owner lost the address to a
    // pre-existing DB row outside the group — that is a duplicate_email
    // reject, reported separately.)
    for (const [addr, plan] of sharedEmailPlan) {
      for (const nid of plan.memberNids) {
        const m = vContactMap.get(nid);
        if (!m) continue;
        const row = await storage.contacts.getContact(m.s2Id);
        if (!row) continue;
        const rowEmail = normalizeEmailKey(row.email);
        if (nid === plan.winnerNid) {
          if (rowEmail !== addr && !rejects.has("duplicate_email", nid)) {
            console.error(`VERIFY: shared-address owner contact nid ${nid} does not carry its address`);
            verifyFailures++;
            verifyFailedContactNids.add(nid);
          }
        } else if (rowEmail === addr) {
          console.error(`VERIFY: contact nid ${nid} carries a shared address it does not own (rule ${plan.rule})`);
          verifyFailures++;
          verifyFailedContactNids.add(nid);
        }
      }
    }
    const legacyNidTypeId = idTypeByLabel.get("Legacy NID");
    const vWorkerMap = await getMappings("worker", processedWorkers.map((w) => w.nid));
    for (const w of processedWorkers) {
      progress.add(1);
      const cnid = targetNidOf(w.fields, "field_sirius_contact");
      const m = vWorkerMap.get(w.nid);
      if (!m) {
        if (!rejects.has("worker_contact_unresolved", w.nid)) {
          console.error(`VERIFY: worker nid ${w.nid} has no id_map entry`);
          verifyFailures++;
          verifyFailedWorkerNids.add(w.nid);
        }
        continue;
      }
      if (m.stub) {
        console.error(`VERIFY: worker nid ${w.nid} still marked stub after load`);
        verifyFailures++;
        verifyFailedWorkerNids.add(w.nid);
        continue;
      }
      const row = await storage.workers.getWorker(m.s2Id);
      if (!row) {
        console.error(`VERIFY: worker nid ${w.nid} maps to missing row ${m.s2Id}`);
        verifyFailures++;
        verifyFailedWorkerNids.add(w.nid);
        continue;
      }
      // sirius_id == staged field_sirius_id (T1 ruling); workers without one
      // must carry an assigned/adopted value that is NOT the nid
      const { value: vFsid } = fsidOf(w);
      if (vFsid != null) {
        if (row.siriusId !== vFsid) {
          console.error(`VERIFY: worker nid ${w.nid} row has sirius_id ${row.siriusId}, expected field_sirius_id ${vFsid}`);
          verifyFailures++;
          verifyFailedWorkerNids.add(w.nid);
        }
      } else if (row.siriusId === w.nid) {
        console.error(`VERIFY: worker nid ${w.nid} still carries nid-based sirius_id`);
        verifyFailures++;
        verifyFailedWorkerNids.add(w.nid);
      }
      // Legacy NID coverage: every loaded worker carries its nid
      if (legacyNidTypeId) {
        const ids = await storage.workerIds.getWorkerIdsByWorkerId(m.s2Id);
        if (!ids.some((e) => e.typeId === legacyNidTypeId && e.value === String(w.nid))) {
          console.error(`VERIFY: worker nid ${w.nid} has no Legacy NID worker_ids row`);
          verifyFailures++;
          verifyFailedWorkerNids.add(w.nid);
        }
      }
      const cm = cnid != null ? vContactMap.get(cnid) : undefined;
      if (cm && row.contactId !== cm.s2Id) {
        console.error(`VERIFY: worker nid ${w.nid} contact_id mismatch`);
        verifyFailures++;
        verifyFailedWorkerNids.add(w.nid);
      }
      const stagedSsnRaw = strOf(w.fields, "field_sirius_ssn");
      const expectedSsn = stagedSsnRaw ? normalizeSsn(stagedSsnRaw) : null;
      if (expectedSsn && !rejects.has("ssn_collision_q36", w.nid) && (row.ssn ?? null) !== expectedSsn) {
        console.error(`VERIFY: worker nid ${w.nid} does not own its normalized staged SSN`);
        verifyFailures++;
        verifyFailedWorkerNids.add(w.nid);
      }
    }
    for (const transfer of ssnTransferByIncomingNid.values()) {
      const ownerRows = await db.execute(sql`SELECT id FROM workers WHERE ssn = ${transfer.ssn}`);
      const owners = (ownerRows as unknown as { rows: Array<{ id: string }> }).rows;
      const incoming = vWorkerMap.get(transfer.incomingNid);
      if (!incoming || owners.length !== 1 || owners[0].id !== incoming.s2Id) {
        console.error(`VERIFY: planned SSN transfer for worker nid ${transfer.incomingNid} did not produce unique ownership`);
        verifyFailures++;
        verifyFailedWorkerNids.add(transfer.incomingNid);
      }
    }
  }

  progress.stop();

  // ---- advance consumed fingerprints (pre-existing mappings) — only after
  // the S2 writes landed and the verify pass established the target, so
  // failed writes stay retryable on the next run ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      "contact",
      pendingContactAdvance.filter((p) => !verifyFailedContactNids.has(p.s1Id)),
      LOGIC_VERSION,
    );
    await advanceFingerprints(
      "worker",
      pendingWorkerAdvance.filter((p) => !verifyFailedWorkerNids.has(p.s1Id)),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweeps: contacts/workers deleted in S1 ----
  // HIGH BLAST RADIUS (report-only ruling): contacts are referenced by
  // workers/comms/relations; workers anchor benefit history, elections and
  // ledger. An S1 deletion therefore surfaces as a `deleted_in_s1` finding
  // every run (blocking unless --allow-findings deleted_in_s1) and is NEVER
  // auto-deleted. Sweeps are loader-scoped: entity `contact` is also written
  // by the employers loader (shop contacts) — each loader sweeps only the
  // mappings it recorded.
  const findings: SyncFinding[] = [];
  for (const [entity, bundle, reason] of [
    ["contact", "sirius_contact", "contact rows are referenced by workers/comms/relations — S1 deletion needs an operator ruling"],
    ["worker", "sirius_worker", "worker rows anchor benefit history/elections/ledger — S1 deletion needs an operator ruling"],
  ] as const) {
    const sweep = await sweepDeletions({
      entity,
      loaders: [LOADER],
      sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = ${bundle}`,
      dryRun: DRY_RUN,
      policy: async () => ({ action: "report-only", detail: { reason } }),
    });
    summary.deleted += sweep.deleted;
    summary.deactivated += sweep.deactivated;
    summary.reportOnly += sweep.reportOnly;
    findings.push(...sweep.findings);
    report[`sweep_${entity}`] = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled };
  }

  report.fastPathSkips = fastPathSkips;
  report.ssnOwnershipRepairs = {
    eligible: ssnTransfersPlanned,
    applied: ssnTransfersApplied,
    dryRunPlanned: DRY_RUN ? ssnTransfersPlanned : 0,
  };
  report.rejectSamples = rejects.samples;

  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) {
    await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);
  }

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: disallowed reject reason(s): ${result.rejectGate.disallowed.map((d) => `${d.reason}(${d.count})`).join(", ")}. ` +
        `Every expected class must be explicitly allowed per run via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(
      `FAIL: ${result.blockingFindings.length} blocking sync finding(s) (${[...new Set(result.blockingFindings.map((f) => f.kind))].join(", ")}). ` +
        `Resolve them or acknowledge per run via --allow-findings.`,
    );
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
