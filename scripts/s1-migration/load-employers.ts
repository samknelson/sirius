/**
 * T7+T24 loader — grievance_shop → employers, grievance_shop_contact →
 * contacts + employer_contacts (+ contact_phone, contact_postal). Milestone 3.
 *
 * Shops pass (02-mapping §9b):
 *   - employers.sirius_id ← String(nid), name ← node title
 *   - industry: `field_sirius_industry` tid → term id_map (T4 options load)
 *     → fallback options_industry.sirius_id — unresolved counts a reject and
 *     loads with industry NULL (prod tripwire: must be 0 there)
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
 *   - contact types: co_role free text + contact_types term names →
 *     options_employer_contact_type ensured BY NAME via unified options
 *     (dedupe case/whitespace). MULTI-LINK per the 2026-08-05 ruling (N25
 *     closed): one employer_contacts row per (contact, employer, type) —
 *     co_role first, then term order. A milestone-3 single-link row gets
 *     healed: an untyped link is retyped to the first missing type, then the
 *     remaining types are created as additional links. Operator-added links
 *     with types the source doesn't carry are KEPT (counted
 *     s2ExtraLinksKept); no type info at all → one untyped link.
 *   - phones co_phone/_phone_2/_fax → E.164 rows (Phone / Phone 2 / Fax)
 *   - address co_address(+_2 merged into street — createOrMatchAddress has no
 *     line2)/city/state/zip → contact_postal via createOrMatchAddress
 *   - field_grievance_company → companies/employer_companies is DEFERRED
 *     (absent from synthetic; counted when present so the prod run surfaces it)
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
 *   npx tsx scripts/s1-migration/load-employers.ts [--dry-run] [--allow-rejects r1,r2]
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
import { RejectLog, loadStaged, strOf, tidOf, targetNidOf, toE164 } from "./lib/loader-utils";

const DRY_RUN = process.argv.includes("--dry-run");
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "t7t24-employers";

/** Row-skipping (fatal) reasons — the verify pass skips exactly these.
 * Annotation reasons (bad phone, unresolved industry, dropped extra types…)
 * must NOT mask verification of rows that DID load. */
const FATAL_SHOP_REASONS = ["shop_no_name", "mapped_employer_missing"] as const;
const FATAL_SHOPCONTACT_REASONS = ["shopcontact_no_name", "shopcontact_employer_unresolved"] as const;

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

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN };
  const rejects = new RejectLog();

  const shops = await loadStaged("grievance_shop");
  const shopContacts = await loadStaged("grievance_shop_contact");
  report.stagedShops = shops.length;
  report.stagedShopContacts = shopContacts.length;

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
  const eStats = { matched: 0, absorbedStubs: 0, created: 0, updated: 0 };

  for (const s of shops) {
    const name = s.title?.trim();
    if (!name) {
      rejects.add("shop_no_name", { nid: s.nid }, s.nid);
      continue;
    }
    const tid = tidOf(s.fields, "field_sirius_industry");
    const industryId = resolveIndustry(tid);
    if (tid != null && !industryId) rejects.add("shop_industry_unresolved", { nid: s.nid, tid });

    for (const f of SHOP_UNLOADED_FIELDS) {
      if (s.fields[f] != null) unloadedFieldCounts[f] = (unloadedFieldCounts[f] ?? 0) + 1;
    }

    const mapped = employerMap.get(s.nid);
    if (!mapped) {
      eStats.created++;
      if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.employers.createEmployer({ siriusId: String(s.nid), name, industryId }),
        );
        const winner = await putMapping("employer", s.nid, created.id, { stub: false, loader: LOADER });
        if (winner !== created.id) {
          console.error(`RACE: employer nid ${s.nid} already mapped to ${winner}; row ${created.id} may be an orphan`);
        }
      }
    } else if (mapped.stub) {
      eStats.absorbedStubs++;
      if (!DRY_RUN) {
        await withNotificationsSuppressed(() =>
          storage.employers.updateEmployer(mapped.s2Id, { siriusId: String(s.nid), name, industryId }),
        );
        await markAbsorbed("employer", s.nid, LOADER);
      }
    } else {
      eStats.matched++;
      if (!DRY_RUN) {
        const existing = await storage.employers.getBySiriusId(String(s.nid));
        if (!existing) {
          rejects.add("mapped_employer_missing", { nid: s.nid, s2Id: mapped.s2Id });
          continue;
        }
        if (existing.name !== name || (existing.industryId ?? null) !== (industryId ?? existing.industryId ?? null)) {
          // industry: only overwrite when we resolved one (never null-out)
          await withNotificationsSuppressed(() =>
            storage.employers.updateEmployer(mapped.s2Id, {
              name,
              ...(industryId ? { industryId } : {}),
            }),
          );
          eStats.updated++;
        }
      }
    }
  }
  report.employers = eStats;
  report.shopFieldsWithoutS2Home = unloadedFieldCounts;

  // ---------------- shop-contacts pass (§9c, T24) ----------------
  const scStats = { matched: 0, created: 0, updated: 0, linksCreated: 0, linksRetyped: 0, s2ExtraLinksKept: 0, phonesCreated: 0, addressesUpserted: 0, addressesMatched: 0, typesEnsured: 0, companyRefsDeferred: 0 };
  /** contact nid → the employer + full type set the verify pass must see (N25 multi-link). */
  const expectedLinksByContactNid = new Map<number, { employerId: string; typeIds: string[] }>();

  const contactMap = await getMappings("contact", shopContacts.map((c) => c.nid));
  const employerMapFinal = await getMappings("employer", shops.map((s) => s.nid));

  // email → owning contact id (dedupe, re-run-safe)
  const emailRes = await db.execute(sql`SELECT id, lower(email) AS email FROM contacts WHERE email IS NOT NULL`);
  const emailOwner = new Map(
    (emailRes as unknown as { rows: Array<{ id: string; email: string }> }).rows.map((r) => [r.email, r.id]),
  );

  // contact-type term names for multi-value field_grievance_contact_types
  const typeTidSet = new Set<number>();
  for (const c of shopContacts) {
    const raw = c.fields["field_grievance_contact_types"];
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const v of arr) {
      const tid = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
      if (tid != null) typeTidSet.add(tid);
    }
  }
  const typeNameByTid = new Map<number, string>();
  if (typeTidSet.size > 0) {
    const tres = await db.execute(sql`
      SELECT tid, name FROM s1_staging.terms WHERE tid IN (${sql.join([...typeTidSet].map((t) => sql`${t}`), sql`, `)})
    `);
    for (const r of (tres as unknown as { rows: Array<{ tid: string | number; name: string }> }).rows) {
      typeNameByTid.set(Number(r.tid), r.name);
    }
  }

  // options_employer_contact_type ensured by (case/whitespace-normalized) name
  const typeRows: Array<{ id: string; name: string }> = await options.list("employer-contact-type");
  const typeIdByNorm = new Map(typeRows.map((r) => [r.name.trim().replace(/\s+/g, " ").toLowerCase(), r.id]));
  const ensureType = async (label: string): Promise<string | null> => {
    const norm = label.trim().replace(/\s+/g, " ");
    if (!norm) return null;
    const key = norm.toLowerCase();
    let id = typeIdByNorm.get(key);
    if (!id && !DRY_RUN) {
      const created = await withNotificationsSuppressed(() => options.create("employer-contact-type", { name: norm }));
      id = created.id;
      typeIdByNorm.set(key, id);
      scStats.typesEnsured++;
    }
    return id ?? null;
  };

  for (const c of shopContacts) {
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
    let contactId = mapped?.s2Id;
    if (!contactId) {
      if (email && emailOwner.has(email)) {
        rejects.add("duplicate_email", { nid: c.nid }, c.nid);
        email = null;
      }
      scStats.created++;
      if (!DRY_RUN) {
        const created = await withNotificationsSuppressed(() =>
          storage.contacts.createContact({ displayName, email }),
        );
        contactId = created.id;
        if (email) emailOwner.set(email, contactId);
        const winner = await putMapping("contact", c.nid, contactId, { stub: false, loader: LOADER });
        if (winner !== contactId) {
          console.error(`RACE: contact nid ${c.nid} already mapped to ${winner}; row ${contactId} may be an orphan`);
          contactId = winner;
        }
      }
    } else {
      scStats.matched++;
      if (!DRY_RUN) {
        const existing = await storage.contacts.getContact(contactId);
        if (existing) {
          if (existing.displayName !== displayName) {
            await withNotificationsSuppressed(() => storage.contacts.updateName(contactId!, displayName));
            scStats.updated++;
          }
          if (email && emailOwner.has(email) && emailOwner.get(email) !== contactId) {
            rejects.add("duplicate_email", { nid: c.nid }, c.nid);
            email = null;
          }
          if (email && existing.email?.toLowerCase() !== email) {
            await withNotificationsSuppressed(() => storage.contacts.updateEmail(contactId!, email));
            scStats.updated++;
          }
          if (email) emailOwner.set(email, contactId);
        }
      }
    }

    if (DRY_RUN || !contactId) continue;

    // contact types (T24, MULTI-LINK per N25 ruling 2026-08-05): one
    // employer_contacts row per (contact, employer, type) — role free text
    // first, then contact_types term names (delta order)
    const typeLabels: string[] = [];
    const role = strOf(c.fields, "field_grievance_co_role");
    if (role) typeLabels.push(role);
    {
      const raw = c.fields["field_grievance_contact_types"];
      const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
      for (const v of arr) {
        const tid = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
        if (tid == null) continue;
        const nm = typeNameByTid.get(tid);
        if (nm) typeLabels.push(nm);
        else rejects.add("contact_type_term_unstaged", { nid: c.nid, tid });
      }
    }
    const typeIds: string[] = [];
    for (const label of [...new Set(typeLabels.map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean))]) {
      const id = await ensureType(label);
      if (id) typeIds.push(id);
    }

    const allLinks = await storage.employerContacts.listByContactId(contactId);
    const links = allLinks.filter((l) => l.employerId === employerMapping.s2Id);
    const haveTypes = new Set(links.map((l) => (l.contactTypeId ?? null) as string | null));

    if (typeIds.length === 0) {
      // no type info at all → ensure ONE untyped link; never null-out an
      // operator-set type on an existing link
      if (links.length === 0) {
        await withNotificationsSuppressed(() =>
          storage.employerContacts.create({ contactId: contactId!, employerId: employerMapping.s2Id, contactTypeId: null }),
        );
        scStats.linksCreated++;
      }
    } else {
      const missingTypes = typeIds.filter((t) => !haveTypes.has(t));
      // heal milestone-3 single-link rows: retype an untyped link to the
      // first missing type instead of leaving a stray untyped link behind
      const nullLink = links.find((l) => (l.contactTypeId ?? null) === null);
      if (nullLink && missingTypes.length > 0) {
        const t = missingTypes.shift()!;
        await withNotificationsSuppressed(() => storage.employerContacts.update(nullLink.id, { contactTypeId: t }));
        haveTypes.delete(null);
        haveTypes.add(t);
        scStats.linksRetyped++;
      }
      for (const t of missingTypes) {
        await withNotificationsSuppressed(() =>
          storage.employerContacts.create({ contactId: contactId!, employerId: employerMapping.s2Id, contactTypeId: t }),
        );
        haveTypes.add(t);
        scStats.linksCreated++;
      }
      // operator-added links whose type the source doesn't carry are KEPT
      const extras = links.filter((l) => (l.contactTypeId ?? null) !== null && !typeIds.includes(l.contactTypeId!)).length;
      if (extras > 0) scStats.s2ExtraLinksKept += extras;
    }
    expectedLinksByContactNid.set(c.nid, { employerId: employerMapping.s2Id, typeIds });

    // phones (T5): Phone / Phone 2 / Fax
    const phoneSpecs: Array<{ key: string; friendly: string; primary: boolean }> = [
      { key: "field_grievance_co_phone", friendly: "Phone", primary: true },
      { key: "field_grievance_co_phone_2", friendly: "Phone 2", primary: false },
      { key: "field_grievance_co_fax", friendly: "Fax", primary: false },
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
      scStats.phonesCreated++;
    }

    // address (T13): co_address(+_2)/city/state/zip
    const streetBase = strOf(c.fields, "field_grievance_co_address");
    const street2 = strOf(c.fields, "field_grievance_co_address_2");
    const city = strOf(c.fields, "field_grievance_co_city");
    const state = strOf(c.fields, "field_grievance_co_state");
    const postalCode = strOf(c.fields, "field_grievance_co_zip");
    if (streetBase || city || state || postalCode) {
      if (!streetBase || !city || !state || !postalCode) {
        rejects.add("address_incomplete", { nid: c.nid });
      } else {
        const street = street2 ? `${streetBase}, ${street2}` : streetBase;
        const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
        const zip5 = (s: string | null | undefined) => (s ?? "").trim().slice(0, 5);
        const existingAddrs = await storage.contacts.addresses.getContactPostalByContact(contactId);
        const already = existingAddrs.some(
          (e) =>
            norm(e.street) === norm(street) &&
            norm(e.city) === norm(city) &&
            norm(e.state) === norm(state) &&
            zip5(e.postalCode) === zip5(postalCode),
        );
        if (already) {
          scStats.addressesMatched++;
        } else {
          await withNotificationsSuppressed(() =>
            storage.contacts.addresses.createOrMatchAddress(
              contactId!,
              { street, city, state, postalCode, country: "US" },
              "import",
              {},
            ),
          );
          scStats.addressesUpserted++;
        }
      }
    }
  }
  report.shopContacts = scStats;

  // ---------------- verify pass ----------------
  let verifyFailures = 0;
  if (!DRY_RUN) {
    const vEmployerMap = await getMappings("employer", shops.map((s) => s.nid));
    for (const s of shops) {
      if (rejects.hasAnyIn(s.nid, FATAL_SHOP_REASONS)) continue;
      const m = vEmployerMap.get(s.nid);
      if (!m || m.stub) {
        console.error(`VERIFY: shop nid ${s.nid} ${!m ? "has no id_map entry" : "still marked stub"}`);
        verifyFailures++;
        continue;
      }
      const row = await storage.employers.getBySiriusId(String(s.nid));
      if (!row || row.id !== m.s2Id) {
        console.error(`VERIFY: shop nid ${s.nid} sirius_id lookup ${row ? "maps to different row" : "missing"}`);
        verifyFailures++;
      }
    }
    const vContactMap = await getMappings("contact", shopContacts.map((c) => c.nid));
    for (const c of shopContacts) {
      if (rejects.hasAnyIn(c.nid, FATAL_SHOPCONTACT_REASONS)) continue;
      const m = vContactMap.get(c.nid);
      if (!m) {
        console.error(`VERIFY: shop contact nid ${c.nid} has no id_map entry`);
        verifyFailures++;
        continue;
      }
      const row = await storage.contacts.getContact(m.s2Id);
      if (!row) {
        console.error(`VERIFY: shop contact nid ${c.nid} maps to missing contact ${m.s2Id}`);
        verifyFailures++;
        continue;
      }
      const links = await storage.employerContacts.listByContactId(m.s2Id);
      if (links.length === 0) {
        console.error(`VERIFY: shop contact nid ${c.nid} has no employer_contacts link`);
        verifyFailures++;
        continue;
      }
      // N25 multi-link: every resolved source type must have its own link row
      const exp = expectedLinksByContactNid.get(c.nid);
      if (exp && exp.typeIds.length > 0) {
        const have = new Set(
          links.filter((l) => l.employerId === exp.employerId).map((l) => (l.contactTypeId ?? null) as string | null),
        );
        const missing = exp.typeIds.filter((t) => !have.has(t));
        if (missing.length > 0) {
          console.error(`VERIFY: shop contact nid ${c.nid} missing ${missing.length} typed employer link(s)`);
          verifyFailures++;
        }
      }
    }
  }

  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;
  report.allowedRejects = ALLOWED_REJECTS;

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
