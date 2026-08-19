/**
 * T7+T24 loader — grievance_shop → employers, grievance_shop_contact →
 * contacts + employer_contacts (+ contact_phone, contact_postal). Milestone 3.
 *
 * Shops pass (02-mapping §9b):
 *   - employers.sirius_id ← String(nid), name ← node title
 *   - industry: `field_sirius_industry` tid → term id_map (T4 options load)
 *     → fallback options_industry.sirius_id — unresolved counts a reject and
 *     KEEPS the existing industry (prod tripwire: must be 0 there); a tid
 *     REMOVED in S1 clears industry to NULL (S1 wins)
 *   - stub absorption: hours-loader stubs get the real name/sirius_id/industry
 *     stamped in place (updateEmployer) + id_map stub=false
 *   - fields with NO S2 home yet are counted, not loaded: external_id (Q26
 *     ambiguous — employers has no data column), name_tts (no data column),
 *     tags (no S2 home), dispatch_job_types (Q24 — dispatch out of scope),
 *     contract/attachments (T10/T23 file transfer, later milestone).
 *     All remain queryable in s1_staging.
 *
 * Shop-contacts pass (02-mapping §9c, T24):
 *   - one contact per node: display_name = co_name (else title) — NO
 *     given/family guessing (T24); email with cross-contact dedupe (T12)
 *   - contact types (CORRECTED per task 2026-08-19): S1 Contact Type taxonomy
 *     (`field_grievance_contact_types` term names) is the SOLE source of
 *     employer_contacts.contact_type_id — options_employer_contact_type
 *     ensured BY NAME via unified options (dedupe case/whitespace).
 *     MULTI-LINK per the 2026-08-05 ruling (N25 closed): one
 *     employer_contacts row per (contact, employer, type) in term order. A
 *     milestone-3 single-link row gets healed: an untyped link is retyped to
 *     the first missing type, then the remaining types are created as
 *     additional links. Operator-added links with types the source doesn't
 *     carry are KEPT (counted s2ExtraLinksKept); no type info at all → one
 *     untyped link.
 *   - Company Rep Title (`field_grievance_co_role` free text, e.g. "Director
 *     of People Operations") is NOT a contact type: it lands, whitespace-
 *     normalized, in employer_contacts.position on every loader-owned link
 *     for that (contact, employer) — but only backfilled into NULL positions:
 *     a differing staff-entered value is preserved and reported
 *     (positionConflictsKept). Re-runs CORRECT earlier imports that treated
 *     the rep title as a type: a link whose contact type matches the source
 *     rep title (and no same-named taxonomy term exists) is removed
 *     (roleTypeLinksRemoved) only when ownership is demonstrable — the
 *     option carries the loader provenance stamp (data.s1Loader) or the
 *     operator passed --correct-role-links for the pre-stamp legacy import —
 *     and the link shows no independent staff position edit. Ambiguous
 *     candidates are preserved + reported (roleLinkCandidatesKept, samples).
 *     Valid taxonomy-derived and operator-managed links stay, and the
 *     erroneously-created option rows are LEFT in place (staff may have
 *     adopted them; deleting risks data).
 *   - phones co_phone/_phone_2/_fax → E.164 rows (Phone / Phone 2 / Fax)
 *   - address co_address(+_2 merged into street — createOrMatchAddress has no
 *     line2)/city/state/zip → contact_postal via createOrMatchAddress
 *   - field_grievance_company → companies/employer_companies is DEFERRED
 *     (absent from synthetic; counted when present so the prod run surfaces it)
 *
 * Sync semantics (Task 293 — RUNBOOK §10): RECONCILING.
 *   - Shop fingerprint = combine(node hash, resolved-industry outcome) so an
 *     industry that becomes resolvable (T4 re-run) reprocesses the shop even
 *     though the node hash didn't move. Full S1-wins reconcile of name,
 *     sirius_id (drift repair), industry (clear when the tid is gone; keep
 *     existing when present-but-unresolved + reject).
 *   - Shop-contact fingerprint = combine(node hash, email-ownership outcome,
 *     resolved-type-terms outcome) — email blockers clearing and late-staged
 *     type terms both reprocess without a node edit.
 *   - Contact reconcile: display name; email S1-wins (absent in S1 → cleared;
 *     blocked by dedupe → duplicate_email reject keeps existing and the row
 *     stays retryable). Employer-contact LINKS reconcile as (contact,
 *     employer, type) triples: links whose contact-type option carries the
 *     loader provenance stamp and whose triple vanished from the source are
 *     removed — including cross-employer stale links after a shop retarget —
 *     unless the link's position shows an independent staff edit (kept +
 *     reported linkRemovalsKept). Untyped links carry no stamp and are never
 *     removed, only healed (retyped) per N25. Phones reconcile as a set over
 *     the loader-owned friendly names (Phone / Phone 2 / Fax): S1-removed →
 *     row deleted, changed → replaced; foreign names untouched; invalid
 *     source phone keeps the existing row + rejects. Address reconciles over
 *     source='import' rows (norm/zip5 equivalence): S1-removed address →
 *     import rows deleted; incomplete → reject, nothing touched.
 *   - Unchanged rows skip via the fingerprint fast path (classifyRow).
 *   - Deletion sweeps: S1-deleted shops and shop-contact nodes are
 *     REPORT-ONLY (deleted_in_s1 findings) — employers and contacts are
 *     high-blast-radius entities, never auto-deleted (RUNBOOK ruling).
 *
 * Writes go through the storage layer under notification suppression.
 * Idempotent: re-runs resolve via id_map and only write on drift.
 *
 * REJECT POLICY (fail loud): every reject reason present in the run must be
 * explicitly allowed via `--allow-rejects r1,r2,...` or the run exits 1
 * (after the full report). Production: start with NO allowances; each
 * allowance must be a conscious ruling.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-employers.ts [--dry-run] [--force-reconcile]
 *       [--allow-rejects r1,r2] [--allow-findings k1,k2] [--correct-role-links]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, markAbsorbed, advanceFingerprints } from "./lib/idmap";
import { RejectLog, loadStaged, strOf, tidOf, targetNidOf, toE164 } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
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

const DRY_RUN = process.argv.includes("--dry-run");
/** Opt-in, audited one-time correction: remove legacy title-as-type links
 * even when the option row carries no loader provenance stamp (pre-stamp
 * imports). Without the flag such links are only REPORTED as candidates. */
const CORRECT_ROLE_LINKS = process.argv.includes("--correct-role-links");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "t7t24-employers";
/** BUMP whenever transform logic changes so unchanged S1 rows reprocess. */
const LOGIC_VERSION = 1;
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();

/** Row-skipping (fatal) reasons — the verify pass skips exactly these.
 * Annotation reasons (bad phone, unresolved industry, dropped extra types…)
 * must NOT mask verification of rows that DID load. */
const FATAL_SHOP_REASONS = ["shop_no_name", "mapped_employer_missing"] as const;
const FATAL_SHOPCONTACT_REASONS = ["shopcontact_no_name", "shopcontact_employer_unresolved", "mapped_contact_missing"] as const;
/** Keyed reasons that additionally BLOCK fingerprint advance (row must stay
 * retryable — the blocker can clear without an S1 edit… but the fingerprint
 * captures the ownership outcome anyway; belt and suspenders). */
const CONTACT_ADVANCE_BLOCKERS = [...FATAL_SHOPCONTACT_REASONS, "duplicate_email"] as const;

/** §9b fields with no S2 home yet — counted so the prod run surfaces volume. */
const SHOP_UNLOADED_FIELDS = [
  "field_grievance_external_id", // Q26 ambiguous target
  "field_sirius_name_tts", // employers has no data column
  "field_grievance_tags", // no S2 home
  "field_sirius_dispatch_job_types", // Q24; dispatch out of scope
  "field_grievance_contract", // T10/T23 file transfer (later)
  "field_grievance_attachments", // T10 file transfer (later)
] as const;

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = {};
  const rejects = new RejectLog();
  const summary = emptySummary();
  const findings: SyncFinding[] = [];
  const fastPathSkips = { shops: 0, shopContacts: 0 };
  const shopsPendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const contactsPendingAdvance: Array<{ s1Id: number; fingerprint: string | null }> = [];
  const verifyFailedShopNids = new Set<number>();
  const verifyFailedContactNids = new Set<number>();
  /** nids processed this run (created/absorbed/reconciled) — verify scope. */
  const processedShopNids: number[] = [];
  const processedContactNids: number[] = [];

  // Heartbeat from process start — liveness ticks during the staged loads and
  // bulk crosswalks, then real progress across the shops + shop-contacts rows.
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const shops = await loadStaged("grievance_shop");
  const shopContacts = await loadStaged("grievance_shop_contact");
  report.stagedShops = shops.length;
  report.stagedShopContacts = shopContacts.length;
  progress.setTotal(shops.length + shopContacts.length);

  // ---------------- shops pass (§9b) ----------------
  const employerMap = await getMappings("employer", shops.map((s) => s.nid));

  // industry resolution: term id_map first, then industry options sirius_id
  const industryTids = shops.map((s) => tidOf(s.fields, "field_sirius_industry")).filter((t): t is number => t != null);
  const termMap = await getMappings("term", industryTids);
  const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
  const options = createUnifiedOptionsStorage();
  const industryRows: Array<{ id: string; siriusId?: string | null }> = await options.list("industry");
  const industryBySiriusId = new Map(
    industryRows.filter((r) => r.siriusId).map((r) => [String(r.siriusId), r.id]),
  );
  const resolveIndustry = (tid: number | null): string | null => {
    if (tid == null) return null;
    return termMap.get(tid)?.s2Id ?? industryBySiriusId.get(String(tid)) ?? null;
  };

  const unloadedFieldCounts: Record<string, number> = {};
  const eStats = { matched: 0, absorbedStubs: 0, created: 0, updated: 0, industriesCleared: 0 };

  progress.phase(null);
  for (const s of shops) {
    progress.add(1);
    const name = s.title?.trim();
    if (!name) {
      rejects.add("shop_no_name", { nid: s.nid }, s.nid);
      continue;
    }
    const tid = tidOf(s.fields, "field_sirius_industry");
    const industryId = resolveIndustry(tid);

    for (const f of SHOP_UNLOADED_FIELDS) {
      if (s.fields[f] != null) unloadedFieldCounts[f] = (unloadedFieldCounts[f] ?? 0) + 1;
    }

    // Consumed fingerprint = node hash + the industry-resolution OUTCOME, so
    // a tid that becomes resolvable (T4 re-run) reprocesses this shop.
    // Staged NULL content_hash ⇒ never fast-skip (classifyRow contract).
    const fp = s.contentHash == null
      ? null
      : combineFingerprints([
          ["node", s.contentHash],
          ["industry", tid == null ? null : contentHashOf(industryId ?? `unresolved:${tid}`)],
        ]);

    const mapped = employerMap.get(s.nid);
    if (classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips.shops++;
      continue;
    }
    if (tid != null && !industryId) rejects.add("shop_industry_unresolved", { nid: s.nid, tid });

    if (!mapped) {
      eStats.created++;
      summary.created++;
      if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.employers.createEmployer({ siriusId: String(s.nid), name, industryId }),
        );
        const winner = await putMapping("employer", s.nid, created.id, {
          stub: false,
          loader: LOADER,
          fingerprint: fp,
          logicVersion: LOGIC_VERSION,
        });
        if (winner !== created.id) {
          console.error(`RACE: employer nid ${s.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
        }
        processedShopNids.push(s.nid);
      }
    } else if (mapped.stub) {
      eStats.absorbedStubs++;
      summary.updated++;
      if (!DRY_RUN) {
        await withNotificationsSuppressed(() =>
          storage.employers.updateEmployer(mapped.s2Id, { siriusId: String(s.nid), name, industryId }),
        );
        await markAbsorbed("employer", s.nid, LOADER);
        processedShopNids.push(s.nid);
        shopsPendingAdvance.push({ s1Id: s.nid, fingerprint: fp });
      }
    } else {
      eStats.matched++;
      if (DRY_RUN) {
        summary.updated++; // classification says changed; approximate under --dry-run
        continue;
      }
      const existing = await storage.employers.getEmployer(mapped.s2Id);
      if (!existing) {
        rejects.add("mapped_employer_missing", { nid: s.nid, s2Id: mapped.s2Id }, s.nid);
        continue;
      }
      // Full S1-wins reconcile: name, sirius_id (drift repair), industry.
      // Industry: tid REMOVED in S1 → clear to NULL; tid present but
      // unresolved → keep existing (annotation reject above); resolved →
      // overwrite on drift.
      const patch: { name?: string; siriusId?: string; industryId?: string | null } = {};
      if (existing.name !== name) patch.name = name;
      if (existing.siriusId !== String(s.nid)) patch.siriusId = String(s.nid);
      if (tid == null) {
        if (existing.industryId != null) {
          patch.industryId = null;
          eStats.industriesCleared++;
        }
      } else if (industryId && existing.industryId !== industryId) {
        patch.industryId = industryId;
      }
      if (Object.keys(patch).length > 0) {
        await withNotificationsSuppressed(() => storage.employers.updateEmployer(mapped.s2Id, patch));
        eStats.updated++;
        summary.updated++;
      } else {
        summary.unchanged++;
      }
      processedShopNids.push(s.nid);
      shopsPendingAdvance.push({ s1Id: s.nid, fingerprint: fp });
    }
  }
  report.employers = eStats;
  report.shopFieldsWithoutS2Home = unloadedFieldCounts;

  // ---------------- shop-contacts pass (§9c, T24) ----------------
  const scStats = { matched: 0, created: 0, updated: 0, emailsCleared: 0, linksCreated: 0, linksRetyped: 0, linksRemoved: 0, linkRemovalsKept: 0, roleTypeLinksRemoved: 0, roleLinkCandidatesKept: 0, positionsSet: 0, positionsBackfilled: 0, positionConflictsKept: 0, s2ExtraLinksKept: 0, phonesCreated: 0, phonesRemoved: 0, addressesUpserted: 0, addressesMatched: 0, addressesRemoved: 0, typesEnsured: 0, companyRefsDeferred: 0 };
  /** Ambiguous title-as-type links preserved for manual review (capped). */
  const roleLinkCandidateSamples: Array<{ nid: number; linkId: string; typeId: string; staffEditedPosition: boolean }> = [];
  /** Loader-owned links whose existing non-null position differs from the source title (never overwritten; capped). */
  const positionConflictSamples: Array<{ nid: number; linkId: string }> = [];
  /** Stale loader-owned links KEPT because the position shows a staff edit (capped). */
  const linkRemovalKeptSamples: Array<{ nid: number; linkId: string; employerId: string }> = [];
  /** contact nid → what the verify pass must see: employer + full taxonomy
   * type set (N25 multi-link), the expected position (rep title), and the
   * erroneous title-as-type id that must NOT remain linked (null when n/a). */
  const expectedLinksByContactNid = new Map<number, { employerId: string; typeIds: string[]; position: string | null; removedTypeId: string | null; positionConflict: boolean }>();

  const contactMap = await getMappings("contact", shopContacts.map((c) => c.nid));
  const employerMapFinal = await getMappings("employer", shops.map((s) => s.nid));

  // email → owning contact id (dedupe, re-run-safe)
  const emailRes = await db.execute(sql`SELECT id, lower(email) AS email FROM contacts WHERE email IS NOT NULL`);
  const emailOwner = new Map(
    (emailRes as unknown as { rows: Array<{ id: string; email: string }> }).rows.map((r) => [r.email, r.id]),
  );

  // contact-type term names for multi-value field_grievance_contact_types
  const typeTidSet = new Set<number>();
  const typeTidsOf = (fields: Record<string, unknown>): number[] => {
    const raw = fields["field_grievance_contact_types"];
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const out: number[] = [];
    for (const v of arr) {
      const tid = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
      if (tid != null) out.push(tid);
    }
    return out;
  };
  for (const c of shopContacts) for (const tid of typeTidsOf(c.fields)) typeTidSet.add(tid);
  const typeNameByTid = new Map<number, string>();
  if (typeTidSet.size > 0) {
    const tres = await db.execute(sql`
      SELECT tid, name FROM s1_staging.terms WHERE tid IN (${sql.join([...typeTidSet].map((t) => sql`${t}`), sql`, `)})
    `);
    for (const r of (tres as unknown as { rows: Array<{ tid: string | number; name: string }> }).rows) {
      typeNameByTid.set(Number(r.tid), r.name);
    }
  }

  // options_employer_contact_type ensured by (case/whitespace-normalized) name.
  // Loader-created options are provenance-stamped (data.s1Loader) so future
  // corrections can prove ownership instead of guessing by name.
  const typeRows: Array<{ id: string; name: string; data?: Record<string, unknown> | null }> = await options.list("employer-contact-type");
  const typeIdByNorm = new Map(typeRows.map((r) => [r.name.trim().replace(/\s+/g, " ").toLowerCase(), r.id]));
  const loaderStampedTypeIds = new Set(typeRows.filter((r) => (r.data as any)?.s1Loader).map((r) => r.id));
  const normKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const ensureType = async (label: string): Promise<string | null> => {
    const norm = label.trim().replace(/\s+/g, " ");
    if (!norm) return null;
    const key = norm.toLowerCase();
    let id = typeIdByNorm.get(key);
    if (!id && !DRY_RUN) {
      const created = await withNotificationsSuppressed(() =>
        options.create("employer-contact-type", { name: norm, data: { s1Loader: LOADER } }),
      );
      id = created.id;
      if (id) {
        typeIdByNorm.set(key, id);
        loaderStampedTypeIds.add(id);
        scStats.typesEnsured++;
      }
    }
    return id ?? null;
  };

  for (const c of shopContacts) {
    progress.add(1);
    const displayName = strOf(c.fields, "field_grievance_co_name") ?? c.title?.trim() ?? null;
    if (!displayName) {
      rejects.add("shopcontact_no_name", { nid: c.nid }, c.nid);
      continue;
    }
    const shopNid = targetNidOf(c.fields, "field_grievance_shops");
    const employerMapping = shopNid != null ? employerMapFinal.get(shopNid) : undefined;
    if (!employerMapping) {
      rejects.add("shopcontact_employer_unresolved", { nid: c.nid, shopNid }, c.nid);
      continue;
    }
    if (c.fields["field_grievance_company"] != null) scStats.companyRefsDeferred++;

    let email = strOf(c.fields, "field_grievance_co_email")?.toLowerCase() ?? null;

    const mapped = contactMap.get(c.nid);

    // Consumed fingerprint = node hash + email-ownership outcome + resolved
    // type-term outcome (both can change without an S1 node edit: a blocking
    // email owner releases the address; a type term gets staged late).
    // Computed BEFORE this row mutates emailOwner. NULL node hash ⇒ never
    // fast-skip.
    const tids = typeTidsOf(c.fields);
    const fp = c.contentHash == null
      ? null
      : combineFingerprints([
          ["node", c.contentHash],
          [
            "emailOwner",
            email == null
              ? null
              : contentHashOf(
                  emailOwner.has(email) && emailOwner.get(email) !== mapped?.s2Id
                    ? `blocked:${emailOwner.get(email)}`
                    : "claimable",
                ),
          ],
          ["types", tids.length === 0 ? null : contentHashOf(tids.map((t) => ({ t, name: typeNameByTid.get(t) ?? null })))],
        ]);

    if (classifyRow(mapped, fp, LOGIC_VERSION, FORCE_RECONCILE) === "unchanged") {
      summary.unchanged++;
      fastPathSkips.shopContacts++;
      continue;
    }

    /** storage writes performed for this row (drift accounting). */
    let writes = 0;

    let contactId = mapped?.s2Id;
    if (!contactId) {
      if (email && emailOwner.has(email)) {
        rejects.add("duplicate_email", { nid: c.nid }, c.nid);
        email = null;
      }
      scStats.created++;
      summary.created++;
      if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.contacts.createContact({ displayName, email }),
        );
        contactId = created.id;
        if (email) emailOwner.set(email, contactId);
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
        processedContactNids.push(c.nid);
      }
    } else {
      scStats.matched++;
      if (!DRY_RUN) {
        const existing = await storage.contacts.getContact(contactId);
        if (!existing) {
          rejects.add("mapped_contact_missing", { nid: c.nid, s2Id: contactId }, c.nid);
          continue;
        }
        if (existing.displayName !== displayName) {
          await withNotificationsSuppressed(() => storage.contacts.updateName(contactId!, displayName));
          writes++;
        }
        let emailBlocked = false;
        if (email && emailOwner.has(email) && emailOwner.get(email) !== contactId) {
          rejects.add("duplicate_email", { nid: c.nid }, c.nid);
          email = null;
          emailBlocked = true;
        }
        if (email) {
          if (existing.email?.toLowerCase() !== email) {
            await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId!, email));
            writes++;
          }
          emailOwner.set(email, contactId);
        } else if (!emailBlocked && existing.email != null) {
          // S1 removed the email → S1 wins (clear); blocked keeps existing
          await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId!, null));
          const old = existing.email.toLowerCase();
          if (emailOwner.get(old) === contactId) emailOwner.delete(old);
          scStats.emailsCleared++;
          writes++;
        }
        processedContactNids.push(c.nid);
      }
    }

    if (DRY_RUN) {
      // classification says new/changed; approximate under --dry-run
      if (mapped) summary.updated++;
      continue;
    }
    if (!contactId) continue;

    // contact types (T24, MULTI-LINK per N25 ruling 2026-08-05, source
    // CORRECTED 2026-08-19): the Contact Type taxonomy terms are the SOLE
    // type source, in delta order. The co_role free text is the rep title →
    // employer_contacts.position, never a type.
    const typeLabels: string[] = [];
    const role = strOf(c.fields, "field_grievance_co_role");
    const position = role ? role.replace(/\s+/g, " ").trim() : null;
    for (const tid of tids) {
      const nm = typeNameByTid.get(tid);
      if (nm) typeLabels.push(nm);
      else rejects.add("contact_type_term_unstaged", { nid: c.nid, tid });
    }
    const taxonomyKeys = new Set(typeLabels.map(normKey).filter(Boolean));
    const typeIds: string[] = [];
    for (const label of [...new Set(typeLabels.map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean))]) {
      const id = await ensureType(label);
      if (id) typeIds.push(id);
    }

    const allLinks = await storage.employerContacts.listByContactId(contactId);
    let links = allLinks.filter((l) => l.employerId === employerMapping.s2Id);

    // Corrective re-run (2026-08-19): earlier loads created a link whose
    // contact type IS the rep title. A link is a CANDIDATE when the source
    // rep title's normalized name matches an existing type option and no
    // taxonomy term of the same name exists for this contact. It is removed
    // only when ownership is demonstrable: the option carries the loader's
    // provenance stamp, or the operator explicitly opted in with
    // --correct-role-links (pre-stamp legacy imports) AND the link's position
    // shows no independent staff edit (null or already equal to the title).
    // Everything else is preserved and REPORTED (roleLinkCandidatesKept +
    // samples) for manual review. Option rows are never deleted.
    let removedTypeId: string | null = null;
    let badTypeId: string | null = null;
    if (position && !taxonomyKeys.has(normKey(position))) {
      badTypeId = typeIdByNorm.get(normKey(position)) ?? null;
      if (badTypeId) {
        const candidates = links.filter((l) => l.contactTypeId === badTypeId);
        for (const bad of candidates) {
          const staffEditedPosition = bad.position != null && bad.position !== position;
          const demonstrable = loaderStampedTypeIds.has(badTypeId) || CORRECT_ROLE_LINKS;
          if (demonstrable && !staffEditedPosition) {
            await withNotificationsSuppressed(() => storage.employerContacts.delete(bad.id));
            scStats.roleTypeLinksRemoved++;
            removedTypeId = badTypeId;
            links = links.filter((l) => l.id !== bad.id);
            writes++;
          } else {
            scStats.roleLinkCandidatesKept++;
            if (roleLinkCandidateSamples.length < 25) {
              roleLinkCandidateSamples.push({ nid: c.nid, linkId: bad.id, typeId: badTypeId, staffEditedPosition });
            }
          }
        }
      }
    }

    // ---- owned-link triple reconcile (Task 293 sync) ----
    // Links whose contact-type option is PROVABLY loader-created (provenance
    // stamp) and whose (contact, employer, type) triple the source no longer
    // carries are removed S1-wins — including links at OTHER employers left
    // behind by a shop retarget. A non-null position differing from the
    // source rep title is treated as a staff edit: kept + reported. Untyped
    // links carry no stamp → never removed here (only healed per N25).
    // Role-title candidates above are excluded (their own audited flow).
    {
      const desired = new Set(typeIds.map((t) => `${employerMapping.s2Id}|${t}`));
      const currentLinks = allLinks.filter((l) => links.some((k) => k.id === l.id) || l.employerId !== employerMapping.s2Id);
      for (const l of currentLinks) {
        if (l.contactTypeId == null) continue;
        if (badTypeId != null && l.contactTypeId === badTypeId) continue; // role-pass territory
        if (!loaderStampedTypeIds.has(l.contactTypeId)) continue; // not provably ours
        if (desired.has(`${l.employerId}|${l.contactTypeId}`)) continue; // still current
        const staffEditedPosition = l.position != null && l.position !== position;
        if (staffEditedPosition) {
          scStats.linkRemovalsKept++;
          if (linkRemovalKeptSamples.length < 25) {
            linkRemovalKeptSamples.push({ nid: c.nid, linkId: l.id, employerId: l.employerId });
          }
          continue;
        }
        await withNotificationsSuppressed(() => storage.employerContacts.delete(l.id));
        scStats.linksRemoved++;
        links = links.filter((k) => k.id !== l.id);
        writes++;
      }
    }
    const haveTypes = new Set(links.map((l) => (l.contactTypeId ?? null) as string | null));

    if (typeIds.length === 0) {
      // no Contact Type taxonomy value → ensure ONE loader-owned untyped link
      // (carrying the position), even alongside operator-added typed links;
      // never null-out an operator-set type on an existing link
      if (!links.some((l) => (l.contactTypeId ?? null) === null)) {
        const created = await withNotificationsSuppressed(() =>
          storage.employerContacts.create({ contactId: contactId!, employerId: employerMapping.s2Id, contactTypeId: null, position }),
        );
        links.push(created as (typeof links)[number]);
        scStats.linksCreated++;
        writes++;
        if (position) scStats.positionsSet++;
      }
    } else {
      const missingTypes = typeIds.filter((t) => !haveTypes.has(t));
      // heal milestone-3 single-link rows: retype an untyped link to the
      // first missing type instead of leaving a stray untyped link behind
      const nullLink = links.find((l) => (l.contactTypeId ?? null) === null);
      if (nullLink && missingTypes.length > 0) {
        const t = missingTypes.shift()!;
        await withNotificationsSuppressed(() => storage.employerContacts.update(nullLink.id, { contactTypeId: t }));
        nullLink.contactTypeId = t;
        haveTypes.delete(null);
        haveTypes.add(t);
        scStats.linksRetyped++;
        writes++;
      }
      for (const t of missingTypes) {
        const created = await withNotificationsSuppressed(() =>
          storage.employerContacts.create({ contactId: contactId!, employerId: employerMapping.s2Id, contactTypeId: t, position }),
        );
        links.push(created as (typeof links)[number]);
        haveTypes.add(t);
        scStats.linksCreated++;
        writes++;
        if (position) scStats.positionsSet++;
      }
      // operator-added links whose type the source doesn't carry are KEPT
      const extras = links.filter((l) => (l.contactTypeId ?? null) !== null && !typeIds.includes(l.contactTypeId!)).length;
      if (extras > 0) scStats.s2ExtraLinksKept += extras;
    }

    // Position backfill on loader-owned links only: links carrying a
    // source-derived taxonomy type, or the untyped link(s) when the source
    // has no taxonomy types. Only a NULL position is filled — an existing
    // non-null value may be staff-entered, so a differing one is preserved
    // and reported (positionConflictsKept), never overwritten; and the
    // loader never nulls a position when the source carries no rep title.
    let positionConflict = false;
    if (position) {
      const owned = typeIds.length === 0
        ? links.filter((l) => (l.contactTypeId ?? null) === null)
        : links.filter((l) => l.contactTypeId != null && typeIds.includes(l.contactTypeId));
      for (const l of owned) {
        if (l.position == null) {
          await withNotificationsSuppressed(() => storage.employerContacts.update(l.id, { position }));
          l.position = position;
          scStats.positionsBackfilled++;
          writes++;
        } else if (l.position !== position) {
          positionConflict = true;
          scStats.positionConflictsKept++;
          if (positionConflictSamples.length < 25) positionConflictSamples.push({ nid: c.nid, linkId: l.id });
        }
      }
    }
    expectedLinksByContactNid.set(c.nid, { employerId: employerMapping.s2Id, typeIds, position, removedTypeId, positionConflict });

    // phones (T5): loader-owned friendly names Phone / Phone 2 / Fax
    // reconcile as a SET — S1-removed slot deletes the row, changed number
    // replaces it, foreign friendly names are untouched. An invalid source
    // value keeps the existing row (reject annotation) — never destroy S2
    // data over a value we cannot parse.
    const phoneSpecs: Array<{ key: string; friendly: string; primary: boolean }> = [
      { key: "field_grievance_co_phone", friendly: "Phone", primary: true },
      { key: "field_grievance_co_phone_2", friendly: "Phone 2", primary: false },
      { key: "field_grievance_co_fax", friendly: "Fax", primary: false },
    ];
    const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
    const byFriendly = new Map<string, typeof existingPhones>();
    for (const p of existingPhones) {
      const k = p.friendlyName ?? "";
      const arr = byFriendly.get(k);
      if (arr) arr.push(p);
      else byFriendly.set(k, [p]);
    }
    const existingByNumber = new Set(existingPhones.map((p) => p.phoneNumber));
    for (const spec of phoneSpecs) {
      const raw = strOf(c.fields, spec.key);
      const ownedRows = byFriendly.get(spec.friendly) ?? [];
      let desired: string | null = null;
      if (raw) {
        desired = toE164(raw);
        if (!desired) {
          rejects.add("phone_invalid", { nid: c.nid, field: spec.key });
          continue; // keep existing row — unparseable source
        }
      }
      // remove loader-owned rows that no longer match the desired value
      for (const p of ownedRows) {
        if (desired != null && p.phoneNumber === desired) continue;
        await withNotificationsSuppressed(() => storage.contacts.phoneNumbers.deletePhoneNumber(p.id));
        existingByNumber.delete(p.phoneNumber);
        scStats.phonesRemoved++;
        writes++;
      }
      if (desired == null) continue;
      if (existingByNumber.has(desired)) continue; // number already present (any name)
      await withNotificationsSuppressed(() =>
        storage.contacts.phoneNumbers.createPhoneNumber({
          contactId: contactId!,
          phoneNumber: desired!,
          friendlyName: spec.friendly,
          isPrimary: spec.primary && existingPhones.length === 0,
        }),
      );
      existingByNumber.add(desired);
      scStats.phonesCreated++;
      writes++;
    }

    // address (T13): co_address(+_2)/city/state/zip — reconciles over
    // source='import' rows (norm/zip5 equivalence): S1-removed/changed
    // address deletes stale import rows; incomplete → reject, nothing
    // touched; operator-entered (non-import) rows are never deleted.
    const streetBase = strOf(c.fields, "field_grievance_co_address");
    const street2 = strOf(c.fields, "field_grievance_co_address_2");
    const city = strOf(c.fields, "field_grievance_co_city");
    const state = strOf(c.fields, "field_grievance_co_state");
    const postalCode = strOf(c.fields, "field_grievance_co_zip");
    const anyAddr = Boolean(streetBase || city || state || postalCode);
    if (anyAddr && (!streetBase || !city || !state || !postalCode)) {
      rejects.add("address_incomplete", { nid: c.nid });
    } else {
      const street = street2 ? `${streetBase}, ${street2}` : streetBase;
      const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
      const zip5 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 5);
      const existingAddrs = await storage.contacts.addresses.getContactPostalByContact(contactId);
      const isEquivalent = (e: (typeof existingAddrs)[number]) =>
        anyAddr &&
        norm(e.street) === norm(street) &&
        norm(e.city) === norm(city) &&
        norm(e.state) === norm(state) &&
        zip5(e.postalCode) === zip5(postalCode);
      // delete loader-owned (source='import') rows that don't match S1's
      // current address (or ALL of them when S1 no longer has one)
      let matched = false;
      for (const e of existingAddrs) {
        if (isEquivalent(e)) {
          matched = true;
          continue;
        }
        if (e.source === "import") {
          await withNotificationsSuppressed(() => storage.contacts.addresses.deleteContactPostal(e.id));
          scStats.addressesRemoved++;
          writes++;
        }
      }
      if (anyAddr) {
        if (matched) {
          scStats.addressesMatched++;
        } else {
          await withNotificationsSuppressed(() =>
            storage.contacts.addresses.createOrMatchAddress(
              contactId!,
              { street: street!, city: city!, state: state!, postalCode: postalCode!, country: "US" },
              "import",
              {},
            ),
          );
          scStats.addressesUpserted++;
          writes++;
        }
      }
    }

    if (mapped) {
      if (writes > 0) {
        scStats.updated++;
        summary.updated++;
      } else {
        summary.unchanged++;
      }
      contactsPendingAdvance.push({ s1Id: c.nid, fingerprint: fp });
    }
  }
  report.shopContacts = scStats;
  report.roleLinkCandidateSamples = roleLinkCandidateSamples;
  report.positionConflictSamples = positionConflictSamples;
  report.linkRemovalKeptSamples = linkRemovalKeptSamples;
  report.fastPathSkips = fastPathSkips;

  // ---------------- verify pass ----------------
  // Scoped to rows PROCESSED this run (fast-path rows were verified when
  // last processed; --force-reconcile re-verifies the whole population).
  const shopByNid = new Map(shops.map((s) => [s.nid, s]));
  const contactByNid = new Map(shopContacts.map((c) => [c.nid, c]));
  progress.phase("verify", processedShopNids.length + processedContactNids.length);
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vEmployerMap = await getMappings("employer", processedShopNids);
    for (const nid of processedShopNids) {
      progress.add(1);
      if (rejects.hasAnyIn(nid, FATAL_SHOP_REASONS)) continue;
      const s = shopByNid.get(nid)!;
      const m = vEmployerMap.get(nid);
      if (!m || m.stub) {
        console.error(`VERIFY: shop nid ${nid} ${!m ? "has no id_map entry" : "still marked stub"}`);
        verifyFailures++;
        verifyFailedShopNids.add(nid);
        continue;
      }
      const row = await storage.employers.getBySiriusId(String(s.nid));
      if (!row || row.id !== m.s2Id) {
        console.error(`VERIFY: shop nid ${nid} sirius_id lookup ${row ? "maps to different row" : "missing"}`);
        verifyFailures++;
        verifyFailedShopNids.add(nid);
      }
    }
    const vContactMap = await getMappings("contact", processedContactNids);
    for (const nid of processedContactNids) {
      progress.add(1);
      if (rejects.hasAnyIn(nid, FATAL_SHOPCONTACT_REASONS)) continue;
      const c = contactByNid.get(nid)!;
      const m = vContactMap.get(nid);
      if (!m) {
        console.error(`VERIFY: shop contact nid ${nid} has no id_map entry`);
        verifyFailures++;
        verifyFailedContactNids.add(nid);
        continue;
      }
      const row = await storage.contacts.getContact(m.s2Id);
      if (!row) {
        console.error(`VERIFY: shop contact nid ${nid} maps to missing contact ${m.s2Id}`);
        verifyFailures++;
        verifyFailedContactNids.add(nid);
        continue;
      }
      const links = await storage.employerContacts.listByContactId(m.s2Id);
      if (links.length === 0) {
        console.error(`VERIFY: shop contact nid ${nid} has no employer_contacts link`);
        verifyFailures++;
        verifyFailedContactNids.add(nid);
        continue;
      }
      // N25 multi-link: every resolved source type must have its own link row.
      // 2026-08-19: also verify position mapping (rep title → position on
      // every loader-owned link, including type-less contacts) and that the
      // erroneous title-as-type link is gone.
      const exp = expectedLinksByContactNid.get(c.nid);
      if (exp) {
        const empLinks = links.filter((l) => l.employerId === exp.employerId);
        if (exp.typeIds.length > 0) {
          const have = new Set(empLinks.map((l) => (l.contactTypeId ?? null) as string | null));
          const missing = exp.typeIds.filter((t) => !have.has(t));
          if (missing.length > 0) {
            console.error(`VERIFY: shop contact nid ${nid} missing ${missing.length} typed employer link(s)`);
            verifyFailures++;
            verifyFailedContactNids.add(nid);
          }
        }
        if (exp.removedTypeId && empLinks.some((l) => l.contactTypeId === exp.removedTypeId)) {
          console.error(`VERIFY: shop contact nid ${nid} still has the erroneous title-as-type link`);
          verifyFailures++;
          verifyFailedContactNids.add(nid);
        }
        if (exp.position) {
          const owned = exp.typeIds.length === 0
            ? empLinks.filter((l) => (l.contactTypeId ?? null) === null)
            : empLinks.filter((l) => l.contactTypeId != null && exp.typeIds.includes(l.contactTypeId));
          // a reported staff-position conflict is preserved, so only require
          // a non-null position there; everywhere else the exact title
          const ok = owned.length > 0 && owned.every((l) =>
            exp.positionConflict ? l.position != null : (l.position ?? null) === exp.position,
          );
          if (!ok) {
            console.error(`VERIFY: shop contact nid ${nid} position not applied to all source-derived link(s)`);
            verifyFailures++;
            verifyFailedContactNids.add(nid);
          }
        }
      }
    }
  }

  // ---- advance consumed fingerprints (pre-existing mappings) — after verify
  // so failed rows stay retryable; duplicate_email also blocks advance ----
  if (!DRY_RUN) {
    await advanceFingerprints(
      "employer",
      shopsPendingAdvance.filter((p) => !verifyFailedShopNids.has(p.s1Id)),
      LOGIC_VERSION,
    );
    await advanceFingerprints(
      "contact",
      contactsPendingAdvance.filter(
        (p) => !verifyFailedContactNids.has(p.s1Id) && !rejects.hasAnyIn(p.s1Id, CONTACT_ADVANCE_BLOCKERS),
      ),
      LOGIC_VERSION,
    );
  }

  // ---- deletion sweeps: REPORT-ONLY (high-blast-radius entities) ----
  // S1-deleted shops/shop-contact nodes emit deleted_in_s1 findings every run
  // until an operator rules on them; nothing is auto-deleted.
  for (const [entity, bundle] of [
    ["employer", "grievance_shop"],
    ["contact", "grievance_shop_contact"],
  ] as const) {
    const sweep = await sweepDeletions({
      entity,
      loaders: [LOADER],
      sourceSql: sql`SELECT nid AS s1_id FROM s1_staging.records WHERE bundle = ${bundle}`,
      dryRun: DRY_RUN,
      policy: async () => ({
        action: "report-only",
        detail: { reason: `${entity}s are never auto-deleted (high blast radius) — operator ruling required` },
      }),
    });
    summary.deleted += sweep.deleted;
    summary.deactivated += sweep.deactivated;
    summary.reportOnly += sweep.reportOnly;
    findings.push(...sweep.findings);
    report[`sweep_${entity}`] = { candidates: sweep.candidates, alreadyHandled: sweep.alreadyHandled };
  }

  progress.stop();
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
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE, correctRoleLinks: CORRECT_ROLE_LINKS }, result as unknown as Record<string, unknown>);

  if (result.rejectGate.status === "fail") {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${result.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
  }
  if (result.blockingFindings.length > 0) {
    console.error(`FAIL: ${result.blockingFindings.length} blocking sync finding(s) — resolve or acknowledge via --allow-findings.`);
  }
  process.exit(loaderExitCode(result));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
