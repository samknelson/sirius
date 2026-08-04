/**
 * T3+T1 loader — sirius_contact → contacts (+ contact_phone, contact_postal),
 * sirius_worker → workers (+ worker_ids, contact updates). Milestone 2.
 *
 * Contacts pass (02-mapping §2):
 *   - name parts (T11): field_sirius_name subcolumns map 1:1; display_name =
 *     S1 node title, else trim(given + family)
 *   - email (T12): contacts.email is UNIQUE — first contact (lowest nid)
 *     keeps it; later duplicates load with email=null + a rejects entry
 *     (contacts has no data column yet, so the duplicate email lives only in
 *     the run report — revisit if a data/language column lands per Q10)
 *   - phones (T5): strip non-digits → E.164 (+1, len 10 or 11-leading-1);
 *     field_sirius_phone is_primary=true, field_sirius_phone_alt "Alt";
 *     rejects counted. Twilio validation is NOT invoked (bulk mode).
 *   - address (T13): compound merge via createOrMatchAddress (idempotent by
 *     normalized match), source="import" (closest AddressSource to the
 *     spec's 's1-migration'), geo left/top as lon/lat ONLY when the bbox is
 *     degenerate (left=right, top=bottom) — else coordinates are rejected
 *   - stub absorption: if a contact's referencing worker was stubbed by the
 *     hours loader, ADOPT the stub worker's auto-created contact row instead
 *     of creating a duplicate (update name/email in place)
 *
 * Workers pass (02-mapping §1):
 *   - workers.sirius_id ← S1 nid EXPLICITLY (T1); sequence setval() runs once
 *     after the load — the only raw SQL write in this loader (spec-sanctioned)
 *   - contact_id via id_map (contact nid → contacts.id); missing → reject
 *   - ssn (T3): digits-only, must be 9 digits; uniqueness pre-checked — the
 *     first worker keeps a colliding SSN, later ones load ssn=null + reject
 *     (Q36 review queue). Masked snapshot values fail the 9-digit rule and
 *     are counted (expected in dev, must be ~0 in production).
 *   - dob/gender → the worker's CONTACT (updateBirthDate/updateGender);
 *     gender tid resolves via id_map term else options_gender name match
 *   - worker_ids (06 §4.9): field_sirius_id → "Sirius ID", _id2 → "Union ID",
 *     _id3 → "External ID", _aat → "AAT"; types ensured via unified options;
 *     (type, value) is UNIQUE — cross-worker collisions are rejects
 *   - field_sirius_aat_required (T14 Yes/No) → workers.data.aatRequired
 *   - contact-style fields directly on the worker bundle are MIRRORS — the
 *     contact node wins (N10); they are not read
 *   - dispatch/member-status/denorm/headshot fields: out of scope here
 *     (member-status association = T6 pending N12 target schema; headshot =
 *     T10 file transfer, later)
 *
 * Writes go through the storage layer under notification suppression.
 * Idempotent: re-runs resolve via id_map and only write on drift.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-contacts-workers.ts [--dry-run]
 *
 * Output is AGGREGATES ONLY (plus S1 nids / opaque ids) — safe inside the
 * HIPAA boundary.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings, putMapping, markAbsorbed } from "./lib/idmap";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t3t1-contacts-workers";
const REJECT_SAMPLE_CAP = 25;

interface StagedNode {
  nid: number;
  title: string | null;
  fields: Record<string, unknown>;
}

// ---------- field helpers (staged D7 shapes: {value}, scalar, array) ----------

function scalarOf(v: unknown): unknown {
  const s = Array.isArray(v) ? v[0] : v;
  if (s && typeof s === "object" && "value" in (s as Record<string, unknown>)) {
    return (s as Record<string, unknown>).value;
  }
  return s;
}

function strOf(fields: Record<string, unknown>, key: string): string | null {
  const v = scalarOf(fields[key]);
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function tidOf(fields: Record<string, unknown>, key: string): number | null {
  const v = scalarOf(fields[key]);
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  if (v && typeof v === "object" && "tid" in (v as Record<string, unknown>)) {
    return Number((v as Record<string, unknown>).tid) || null;
  }
  return null;
}

function targetNidOf(fields: Record<string, unknown>, key: string): number | null {
  const raw = fields[key];
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s === "number") return s;
  if (typeof s === "string" && /^\d+$/.test(s)) return Number(s);
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const cand = o.target_id ?? o.value;
    if (typeof cand === "number") return cand;
    if (typeof cand === "string" && /^\d+$/.test(cand)) return Number(cand);
  }
  return null;
}

/** T5: bare/formatted phone → E.164 (+1...), or null if not 10/11-leading-1 digits. */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** T14: Yes/No text → boolean (case-insensitive), null passthrough. */
function yesNo(v: string | null): boolean | null {
  if (v == null) return null;
  const s = v.trim().toLowerCase();
  if (s === "yes") return true;
  if (s === "no") return false;
  return null;
}

/** T3: SSN digits-only; must be exactly 9. */
function normalizeSsn(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

/** "1971-06-07 00:00:00" → "1971-06-07" (D7 wall-time datetimes, date-only). */
function toYmd(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
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

async function loadStaged(bundle: string): Promise<StagedNode[]> {
  const res = await db.execute(sql`
    SELECT nid, title, fields FROM s1_staging.records WHERE bundle = ${bundle} ORDER BY nid
  `);
  return (res as unknown as { rows: Array<{ nid: string | number; title: string | null; fields: unknown }> }).rows.map(
    (r) => ({
      nid: Number(r.nid),
      title: r.title,
      fields: (typeof r.fields === "string" ? JSON.parse(r.fields) : r.fields ?? {}) as Record<string, unknown>,
    }),
  );
}

class RejectLog {
  counts: Record<string, number> = {};
  samples: Record<string, Array<Record<string, unknown>>> = {};
  /** FULL key membership per reason (verify allowlist) — samples are capped
   * for the report, but verification must never depend on the cap. */
  private keys: Record<string, Set<number>> = {};
  add(reason: string, detail: Record<string, unknown>, key?: number) {
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
    const arr = (this.samples[reason] ??= []);
    if (arr.length < REJECT_SAMPLE_CAP) arr.push(detail);
    if (key != null) (this.keys[reason] ??= new Set()).add(key);
  }
  has(reason: string, key: number): boolean {
    return this.keys[reason]?.has(key) ?? false;
  }
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN };
  const rejects = new RejectLog();

  const stagedContacts = await loadStaged("sirius_contact");
  const stagedWorkers = await loadStaged("sirius_worker");
  report.stagedContacts = stagedContacts.length;
  report.stagedWorkers = stagedWorkers.length;

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

  // Existing unique-column values (dedupe pre-checks). Direct reads — the
  // storage layer has no "list all emails/ssns" surface; loader-side keyset
  // paging is a documented production TODO (README).
  // email → owning contact id, so re-runs don't count a contact's own
  // already-loaded email as a duplicate
  const emailRes = await db.execute(sql`SELECT id, lower(email) AS email FROM contacts WHERE email IS NOT NULL`);
  const emailOwner = new Map(
    (emailRes as unknown as { rows: Array<{ id: string; email: string }> }).rows.map((r) => [r.email, r.id]),
  );
  // ssn → owning sirius_id (NULL for pre-migration rows) so a re-run doesn't
  // count a worker's own already-loaded SSN as a collision
  const ssnRes = await db.execute(sql`SELECT ssn, sirius_id FROM workers WHERE ssn IS NOT NULL`);
  const ssnOwner = new Map(
    (ssnRes as unknown as { rows: Array<{ ssn: string; sirius_id: number | string | null }> }).rows.map((r) => [
      r.ssn,
      r.sirius_id == null ? null : Number(r.sirius_id),
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
  const gtids = stagedWorkers.map((w) => tidOf(w.fields, "field_sirius_gender")).filter((t): t is number => t != null);
  const termNameByTid = new Map<number, string>();
  if (gtids.length > 0) {
    const tres = await db.execute(sql`
      SELECT tid, name FROM s1_staging.terms WHERE tid IN (${sql.join(gtids.map((t) => sql`${t}`), sql`, `)})
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
  const cStats = { matched: 0, adoptedStubContact: 0, created: 0, updated: 0, phonesCreated: 0, addressesUpserted: 0, addressesMatched: 0 };

  /** Reconcile an EXISTING contact row to the staged values (adopted stubs
   * and already-mapped rows — makes crash-interrupted absorption resumable).
   * Only writes fields that differ; returns count of update calls. */
  const reconcileContact = async (
    contactId: string,
    cNid: number,
    vals: {
      parts: NameParts | null;
      displayName: string;
      email: string | null;
      birthDate: string | null;
      genderId: string | null;
      genderNota: string | null;
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
    if (email && emailOwner.has(email) && emailOwner.get(email) !== contactId) {
      rejects.add("duplicate_email", { nid: cNid }, cNid);
      email = null;
    }
    if (email && existing.email?.toLowerCase() !== email) {
      await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId, email));
      writes++;
    }
    if (email) emailOwner.set(email, contactId);
    if (vals.birthDate && existing.birthDate !== vals.birthDate) {
      await withNotificationsSuppressed(() => storage.contacts.updateBirthDate(contactId, vals.birthDate));
      writes++;
    }
    if (vals.genderId && existing.gender !== vals.genderId) {
      await withNotificationsSuppressed(() =>
        storage.contacts.updateGender(contactId, vals.genderId, vals.genderNota),
      );
      writes++;
    }
    return writes;
  };

  for (const c of stagedContacts) {
    const parts = namePartsOf(c.fields);
    const displayName =
      c.title?.trim() ||
      [parts?.given, parts?.family].filter(Boolean).join(" ").trim() ||
      null;
    if (!displayName) {
      rejects.add("contact_no_name", { nid: c.nid }, c.nid);
      continue;
    }

    let email = strOf(c.fields, "field_sirius_email")?.toLowerCase() ?? null;

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

    const mapped = contactMap.get(c.nid);
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
          cStats.updated += await reconcileContact(contactId, c.nid, {
            parts,
            displayName,
            email,
            birthDate,
            genderId,
            genderNota,
          });
        }
      } else {
        // fresh contact
        if (email && emailOwner.has(email)) {
          rejects.add("duplicate_email", { nid: c.nid }, c.nid);
          email = null;
        }
        cStats.created++;
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
        const winner = await putMapping("contact", c.nid, contactId, { stub: false, loader: LOADER });
        if (winner !== contactId) {
          console.error(`RACE: contact nid ${c.nid} already mapped to ${winner}; row ${contactId} may be an orphan`);
          contactId = winner;
        }
      }
    } else {
      // already mapped — reconcile drift (resumability after a partial run)
      cStats.matched++;
      if (!DRY_RUN) {
        cStats.updated += await reconcileContact(contactId, c.nid, {
          parts,
          displayName,
          email,
          birthDate,
          genderId,
          genderNota,
        });
      }
    }

    if (DRY_RUN || !contactId) continue;

    // phones (T5) — idempotent by E.164 value per contact
    const phoneSpecs: Array<{ key: string; friendly: string; primary: boolean }> = [
      { key: "field_sirius_phone", friendly: "Primary", primary: true },
      { key: "field_sirius_phone_alt", friendly: "Alt", primary: false },
    ];
    const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
    const existingByNumber = new Set(existingPhones.map((p) => p.phoneNumber));
    for (const spec of phoneSpecs) {
      const raw = strOf(c.fields, spec.key);
      if (!raw) continue;
      const e164 = toE164(raw);
      if (!e164) {
        rejects.add("phone_invalid", { nid: c.nid, field: spec.key });
        continue;
      }
      if (existingByNumber.has(e164)) continue;
      await withNotificationsSuppressed(() =>
        storage.contacts.phoneNumbers.createPhoneNumber({
          contactId: contactId!,
          phoneNumber: e164,
          friendlyName: spec.friendly,
          isPrimary: spec.primary && existingPhones.length === 0,
        }),
      );
      existingByNumber.add(e164);
      cStats.phonesCreated++;
    }

    // address (T13) — pre-check existing rows so re-runs don't touch storage
    // (createOrMatchAddress "matches" by rewriting updatedAt on the match)
    const addrRaw = scalarOf(c.fields["field_sirius_address"]);
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
      } else {
        let latitude: number | undefined;
        let longitude: number | undefined;
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
        const accuracy = strOf(c.fields, "field_sirius_address_accuracy") ?? undefined;
        // re-run guard: skip storage entirely when an equivalent row already
        // exists (createOrMatchAddress touches updatedAt even on a match)
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const zip5 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 5);
        const existingAddrs = await storage.contacts.addresses.getContactPostalByContact(contactId);
        const already = existingAddrs.some(
          (e) =>
            norm(e.street) === norm(street) &&
            norm(e.city) === norm(city) &&
            norm(e.state) === norm(state) &&
            zip5(e.postalCode) === zip5(postalCode) &&
            (latitude == null || e.latitude != null),
        );
        if (already) {
          cStats.addressesMatched++;
        } else {
          await withNotificationsSuppressed(() =>
            storage.contacts.addresses.createOrMatchAddress(
              contactId!,
              { street, city, state, postalCode, country },
              "import",
              { latitude, longitude, accuracy },
            ),
          );
          cStats.addressesUpserted++;
        }
      }
    }
  }
  report.contacts = cStats;

  // ---------------- workers pass ----------------
  // worker-id types (06 §4.9) via unified options — ensure by name
  const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
  const options = createUnifiedOptionsStorage();
  const idTypeByLabel = new Map<string, string>();
  {
    const rows: Array<{ id: string; name: string }> = await options.list("worker-id-type");
    const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
    for (const label of ["Sirius ID", "Union ID", "External ID", "AAT"]) {
      let id = byName.get(label.toLowerCase());
      if (!id && !DRY_RUN) {
        const created = await withNotificationsSuppressed(() => options.create("worker-id-type", { name: label }));
        id = created.id;
      }
      if (id) idTypeByLabel.set(label, id);
    }
  }

  const wStats = { matched: 0, absorbedStubs: 0, created: 0, updated: 0, workerIdsCreated: 0 };
  const finalContactMap = await getMappings("contact", stagedContacts.map((c) => c.nid));

  for (const w of stagedWorkers) {
    const cnid = targetNidOf(w.fields, "field_sirius_contact");
    const contactMapping = cnid != null ? finalContactMap.get(cnid) : undefined;
    if (!contactMapping) {
      rejects.add("worker_contact_unresolved", { workerNid: w.nid, contactNid: cnid }, w.nid);
      continue;
    }

    // ssn (T3)
    const ssnRaw = strOf(w.fields, "field_sirius_ssn");
    let ssn: string | null = null;
    if (ssnRaw) {
      ssn = normalizeSsn(ssnRaw);
      if (!ssn) rejects.add("ssn_not_9_digits", { workerNid: w.nid });
      else if (ssnOwner.has(ssn) && ssnOwner.get(ssn) !== w.nid) {
        rejects.add("ssn_collision_q36", { workerNid: w.nid });
        ssn = null;
      }
    }

    const aatRequired = yesNo(strOf(w.fields, "field_sirius_aat_required"));
    const data = aatRequired == null ? null : { aatRequired };

    const mapped = workerMap.get(w.nid);
    let workerId = mapped?.s2Id;

    if (mapped && !mapped.stub) {
      // already loaded — reconcile drift (resumability after a partial run)
      wStats.matched++;
      if (!DRY_RUN) {
        const worker = await storage.workers.getWorker(mapped.s2Id);
        if (!worker) {
          rejects.add("mapped_worker_missing", { workerNid: w.nid, s2Id: mapped.s2Id });
          continue;
        }
        const drift =
          worker.siriusId !== w.nid ||
          (worker.ssn ?? null) !== ssn ||
          worker.contactId !== contactMapping.s2Id;
        if (drift) {
          await withNotificationsSuppressed(() =>
            storage.workers.updateWorkerForMigration(mapped.s2Id, {
              siriusId: w.nid,
              contactId: contactMapping.s2Id,
              ssn,
              ...(data ? { data } : {}),
            }),
          );
          wStats.updated++;
        }
      }
      if (ssn) ssnOwner.set(ssn, w.nid);
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
        await withNotificationsSuppressed(() =>
          storage.workers.updateWorkerForMigration(mapped.s2Id, {
            siriusId: w.nid,
            contactId: contactMapping.s2Id,
            ssn,
            ...(data ? { data } : {}),
          }),
        );
        if (ssn) ssnOwner.set(ssn, w.nid);
        await markAbsorbed("worker", w.nid, LOADER);
      }
    } else {
      wStats.created++;
      if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.workers.createWorkerForMigration({
            siriusId: w.nid,
            contactId: contactMapping.s2Id,
            ssn,
            data,
          }),
        );
        workerId = created.id;
        if (ssn) ssnOwner.set(ssn, w.nid);
        const winner = await putMapping("worker", w.nid, created.id, { stub: false, loader: LOADER });
        if (winner !== created.id) {
          console.error(`RACE: worker nid ${w.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
          workerId = winner;
        }
      }
    }

    if (DRY_RUN || !workerId) continue;

    // worker_ids (06 §4.9) — idempotent per (worker, type, value); (type,value) UNIQUE
    const idSpecs: Array<{ key: string; label: string }> = [
      { key: "field_sirius_id", label: "Sirius ID" },
      { key: "field_sirius_id2", label: "Union ID" },
      { key: "field_sirius_id3", label: "External ID" },
      { key: "field_sirius_aat", label: "AAT" },
    ];
    const existingIds = await storage.workerIds.getWorkerIdsByWorkerId(workerId);
    for (const spec of idSpecs) {
      const value = strOf(w.fields, spec.key);
      if (!value) continue;
      const typeId = idTypeByLabel.get(spec.label);
      if (!typeId) {
        rejects.add("worker_id_type_missing", { label: spec.label });
        continue;
      }
      if (existingIds.some((e) => e.typeId === typeId && e.value === value)) continue;
      const clash = await storage.workerIds.getWorkerIdByTypeAndValue(typeId, value);
      if (clash) {
        if (clash.workerId !== workerId) {
          rejects.add("worker_id_value_collision", { workerNid: w.nid, label: spec.label });
        }
        continue;
      }
      await withNotificationsSuppressed(() =>
        storage.workerIds.createWorkerId({ workerId, typeId, value }),
      );
      wStats.workerIdsCreated++;
    }
  }
  report.workers = wStats;

  // ---------------- setval (T1 — the one raw-SQL write, spec-sanctioned) ----------------
  if (!DRY_RUN) {
    await db.execute(sql`
      SELECT setval(pg_get_serial_sequence('workers','sirius_id'), (SELECT max(sirius_id) FROM workers))
    `);
  }

  // ---------------- verify pass ----------------
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vContactMap = await getMappings("contact", stagedContacts.map((c) => c.nid));
    for (const c of stagedContacts) {
      const m = vContactMap.get(c.nid);
      if (!m) {
        if (!rejects.has("contact_no_name", c.nid)) {
          console.error(`VERIFY: contact nid ${c.nid} has no id_map entry`);
          verifyFailures++;
        }
        continue;
      }
      const row = await storage.contacts.getContact(m.s2Id);
      if (!row) {
        console.error(`VERIFY: contact nid ${c.nid} maps to missing row ${m.s2Id}`);
        verifyFailures++;
      }
    }
    const vWorkerMap = await getMappings("worker", stagedWorkers.map((w) => w.nid));
    for (const w of stagedWorkers) {
      const cnid = targetNidOf(w.fields, "field_sirius_contact");
      const m = vWorkerMap.get(w.nid);
      if (!m) {
        if (!rejects.has("worker_contact_unresolved", w.nid)) {
          console.error(`VERIFY: worker nid ${w.nid} has no id_map entry`);
          verifyFailures++;
        }
        continue;
      }
      if (m.stub) {
        console.error(`VERIFY: worker nid ${w.nid} still marked stub after load`);
        verifyFailures++;
        continue;
      }
      const row = await storage.workers.getWorker(m.s2Id);
      if (!row) {
        console.error(`VERIFY: worker nid ${w.nid} maps to missing row ${m.s2Id}`);
        verifyFailures++;
        continue;
      }
      if (row.siriusId !== w.nid) {
        console.error(`VERIFY: worker nid ${w.nid} row has sirius_id ${row.siriusId}`);
        verifyFailures++;
      }
      const cm = cnid != null ? vContactMap.get(cnid) : undefined;
      if (cm && row.contactId !== cm.s2Id) {
        console.error(`VERIFY: worker nid ${w.nid} contact_id mismatch`);
        verifyFailures++;
      }
    }
  }

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);

  if (verifyFailures > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
