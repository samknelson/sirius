/**
 * Smoke test for the corrected T24 employer-contact title mapping
 * (task 2026-08-19): S1 Contact Type taxonomy is the SOLE source of
 * employer_contacts.contact_type_id; the Company Rep Title (co_role free
 * text) lands in employer_contacts.position, never as a type.
 *
 * Seeds self-cleaning staged fakes (a shop + four shop contacts + two
 * contact-type terms, nids 999020xx) and runs load-employers.ts as a real
 * CLI. Asserts:
 *   - taxonomy-only contact → one typed link per term, no untyped link,
 *     no position;
 *   - rep-title-only contact → ONE untyped link carrying the position, and
 *     NO options_employer_contact_type row is created from the title;
 *   - mixed contact → typed links from taxonomy only, position on them;
 *   - legacy mis-mapped contact (pre-seeded link whose type IS the rep
 *     title, option UNSTAMPED like the real legacy import): run 1 WITHOUT
 *     --correct-role-links only REPORTS it (roleLinkCandidatesKept); run 2
 *     WITH the flag removes it, position lands on the valid taxonomy link,
 *     the option row itself SURVIVES;
 *   - COLLISION: an operator typed link whose type name EQUALS co_role but
 *     with a staff-edited position is preserved + reported even under the
 *     flag;
 *   - operator untyped link with a manually entered position is NEVER
 *     overwritten (positionConflictsKept, value intact);
 *   - loader-created option rows carry the data.s1Loader provenance stamp;
 *   - re-run idempotence: zero removals/backfills/new links on the final
 *     flag re-run.
 *
 * Run: npx tsx scripts/oneoffs/s1-t24-contact-title-smoke.ts
 * DEV-ONLY (writes fake staged rows + S2 rows, removes them afterwards).
 */
import { spawnSync } from "child_process";
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, upsertRecords, upsertTerms } from "../s1-migration/lib/staging";
import { ensureIdMap, getMappings, putMapping } from "../s1-migration/lib/idmap";

const SHOP_NID = 99902001;
const N = {
  taxOnly: 99902011, // types [A,B], no role
  titleOnly: 99902012, // role only
  mixed: 99902013, // role + type A
  legacy: 99902014, // role + type A, pre-seeded bad title-as-type link
  titleOp: 99902015, // role only, pre-seeded OPERATOR typed link (type A)
  collide: 99902016, // role == operator link's type name, staff-edited position
  posManual: 99902017, // role only, pre-seeded untyped link with manual position
};
const TID_A = 99902101;
const TID_B = 99902102;
const NAME_A = "SMOKE T24 Payroll Type";
const NAME_B = "SMOKE T24 HR Type";
const TITLE_ONLY_ROLE = "SMOKE T24 Director of People Ops";
const MIXED_ROLE = "SMOKE T24 Benefits  Lead"; // double space → normalization check
const MIXED_ROLE_NORM = "SMOKE T24 Benefits Lead";
const LEGACY_ROLE = "SMOKE T24 Legacy Title";
const TITLE_OP_ROLE = "SMOKE T24 Office Coordinator";
const COLLIDE_ROLE = "SMOKE T24 Ops Type"; // == the operator link's TYPE name
const COLLIDE_STAFF_POSITION = "SMOKE T24 Staff-Entered Position";
const MANUAL_POSITION = "SMOKE T24 Manual Position";
const POS_MANUAL_ROLE = "SMOKE T24 Regional Rep";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function runLoader(args: string[]): { status: number; report: Record<string, any> } {
  const res = spawnSync("npx", ["tsx", "scripts/s1-migration/load-employers.ts", ...args], {
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout ?? "";
  const idx = out.indexOf("\n{");
  let report: Record<string, any> = {};
  if (idx >= 0) {
    try {
      report = JSON.parse(out.slice(idx + 1));
    } catch {
      /* asserts below fail loudly */
    }
  }
  if ((res.status ?? -1) !== 0) {
    console.error("--- loader stdout (tail) ---\n" + out.slice(-4000));
    console.error("--- loader stderr (tail) ---\n" + (res.stderr ?? "").slice(-4000));
  }
  return { status: res.status ?? -1, report };
}

/** Dev staging carries known reject classes (e.g. shop_industry_unresolved).
 * Discover them with a priming DRY run BEFORE seeding fixtures, so the real
 * runs pass --allow-rejects up front — a failed-then-retried run would have
 * already performed its writes, zeroing the counters the asserts inspect. */
function discoverAllowedRejects(): string[] {
  const probe = runLoader(["--dry-run"]);
  return Object.keys(probe.report.rejects ?? {});
}

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(q)) as unknown as { rows: T[] }).rows;
}

async function linksOf(contactId: string, employerId: string) {
  const all = await storage.employerContacts.listByContactId(contactId);
  return all.filter((l) => l.employerId === employerId);
}

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();

  const cleanup: Array<() => Promise<void>> = [];
  cleanup.push(async () => {
    await db.execute(sql`DELETE FROM s1_staging.records WHERE nid IN (${SHOP_NID}, ${N.taxOnly}, ${N.titleOnly}, ${N.mixed}, ${N.legacy}, ${N.titleOp}, ${N.collide}, ${N.posManual})`);
    await db.execute(sql`DELETE FROM s1_staging.terms WHERE tid IN (${TID_A}, ${TID_B})`);
    const maps = await rows<{ s2_id: string }>(sql`
      SELECT s2_id FROM s1_staging.id_map WHERE (entity = 'contact' AND s1_id IN (${N.taxOnly}, ${N.titleOnly}, ${N.mixed}, ${N.legacy}, ${N.titleOp}, ${N.collide}, ${N.posManual}))
    `);
    for (const m of maps) {
      await db.execute(sql`DELETE FROM employer_contacts WHERE contact_id = ${m.s2_id}`);
      await db.execute(sql`DELETE FROM contact_phone WHERE contact_id = ${m.s2_id}`);
      await db.execute(sql`DELETE FROM contacts WHERE id = ${m.s2_id}`);
    }
    const emps = await rows<{ s2_id: string }>(sql`
      SELECT s2_id FROM s1_staging.id_map WHERE entity = 'employer' AND s1_id = ${SHOP_NID}
    `);
    for (const e of emps) await db.execute(sql`DELETE FROM employers WHERE id = ${e.s2_id}`);
    await db.execute(sql`DELETE FROM s1_staging.id_map WHERE (entity = 'employer' AND s1_id = ${SHOP_NID}) OR (entity = 'contact' AND s1_id IN (${N.taxOnly}, ${N.titleOnly}, ${N.mixed}, ${N.legacy}, ${N.titleOp}, ${N.collide}, ${N.posManual}))`);
    await db.execute(sql`DELETE FROM options_employer_contact_type WHERE name LIKE 'SMOKE T24%'`);
  });

  try {
    // ---- seed staged fakes -------------------------------------------------
    await upsertTerms([
      { tid: TID_A, vocabulary: "grievance_contact_types", name: NAME_A, description: null, weight: 0, fields: {} },
      { tid: TID_B, vocabulary: "grievance_contact_types", name: NAME_B, description: null, weight: 1, fields: {} },
    ]);
    const base = { vid: null, uid: null, status: 1, created: Date.UTC(2020, 0, 1) / 1000, changed: Date.UTC(2026, 0, 1) / 1000 };
    await upsertRecords([
      { ...base, bundle: "grievance_shop", nid: SHOP_NID, title: "SMOKE T24 Shop", fields: {} },
      { ...base, bundle: "grievance_shop_contact", nid: N.taxOnly, title: "SMOKE T24 TaxOnly", fields: { field_grievance_co_name: "SMOKE T24 TaxOnly", field_grievance_shops: [SHOP_NID], field_grievance_contact_types: [TID_A, TID_B] } },
      { ...base, bundle: "grievance_shop_contact", nid: N.titleOnly, title: "SMOKE T24 TitleOnly", fields: { field_grievance_co_name: "SMOKE T24 TitleOnly", field_grievance_shops: [SHOP_NID], field_grievance_co_role: TITLE_ONLY_ROLE } },
      { ...base, bundle: "grievance_shop_contact", nid: N.mixed, title: "SMOKE T24 Mixed", fields: { field_grievance_co_name: "SMOKE T24 Mixed", field_grievance_shops: [SHOP_NID], field_grievance_co_role: MIXED_ROLE, field_grievance_contact_types: [TID_A] } },
      { ...base, bundle: "grievance_shop_contact", nid: N.legacy, title: "SMOKE T24 Legacy", fields: { field_grievance_co_name: "SMOKE T24 Legacy", field_grievance_shops: [SHOP_NID], field_grievance_co_role: LEGACY_ROLE, field_grievance_contact_types: [TID_A] } },
      { ...base, bundle: "grievance_shop_contact", nid: N.titleOp, title: "SMOKE T24 TitleOp", fields: { field_grievance_co_name: "SMOKE T24 TitleOp", field_grievance_shops: [SHOP_NID], field_grievance_co_role: TITLE_OP_ROLE } },
      { ...base, bundle: "grievance_shop_contact", nid: N.collide, title: "SMOKE T24 Collide", fields: { field_grievance_co_name: "SMOKE T24 Collide", field_grievance_shops: [SHOP_NID], field_grievance_co_role: COLLIDE_ROLE } },
      { ...base, bundle: "grievance_shop_contact", nid: N.posManual, title: "SMOKE T24 PosManual", fields: { field_grievance_co_name: "SMOKE T24 PosManual", field_grievance_shops: [SHOP_NID], field_grievance_co_role: POS_MANUAL_ROLE } },
    ]);

    // ---- pre-seed the legacy mis-mapped state ------------------------------
    // Employer + contact exist and are mapped; the bad import created BOTH a
    // taxonomy-typed link AND a title-as-type link, with no position.
    const employer = await withNotificationsSuppressed(() =>
      storage.employers.createEmployer({ siriusId: String(SHOP_NID), name: "SMOKE T24 Shop" }),
    );
    await putMapping("employer", SHOP_NID, employer.id, { stub: false, loader: "smoke-t24" });
    const legacyContact = await withNotificationsSuppressed(() =>
      storage.contacts.createContact({ displayName: "SMOKE T24 Legacy", email: null }),
    );
    await putMapping("contact", N.legacy, legacyContact.id, { stub: false, loader: "smoke-t24" });
    const { createUnifiedOptionsStorage } = await import("../../server/storage/unified-options");
    const options = createUnifiedOptionsStorage();
    const typeA = await withNotificationsSuppressed(() => options.create("employer-contact-type", { name: NAME_A }));
    const legacyTypeOpt = await withNotificationsSuppressed(() => options.create("employer-contact-type", { name: LEGACY_ROLE }));
    await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: legacyContact.id, employerId: employer.id, contactTypeId: typeA.id }),
    );
    await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: legacyContact.id, employerId: employer.id, contactTypeId: legacyTypeOpt.id }),
    );
    // Pre-seed the "rep title only + operator-added typed link" state: the
    // loader must ADD its own untyped link (with position) alongside the
    // operator link, never retype or touch the operator's.
    const titleOpContact = await withNotificationsSuppressed(() =>
      storage.contacts.createContact({ displayName: "SMOKE T24 TitleOp", email: null }),
    );
    await putMapping("contact", N.titleOp, titleOpContact.id, { stub: false, loader: "smoke-t24" });
    await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: titleOpContact.id, employerId: employer.id, contactTypeId: typeA.id }),
    );
    // COLLISION: operator link whose TYPE NAME equals the source co_role, with
    // a staff-edited position — must survive even the --correct-role-links run.
    const collideContact = await withNotificationsSuppressed(() =>
      storage.contacts.createContact({ displayName: "SMOKE T24 Collide", email: null }),
    );
    await putMapping("contact", N.collide, collideContact.id, { stub: false, loader: "smoke-t24" });
    const collideTypeOpt = await withNotificationsSuppressed(() => options.create("employer-contact-type", { name: COLLIDE_ROLE }));
    await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: collideContact.id, employerId: employer.id, contactTypeId: collideTypeOpt.id, position: COLLIDE_STAFF_POSITION }),
    );
    // Operator untyped link with a manually entered position — never overwritten.
    const posManualContact = await withNotificationsSuppressed(() =>
      storage.contacts.createContact({ displayName: "SMOKE T24 PosManual", email: null }),
    );
    await putMapping("contact", N.posManual, posManualContact.id, { stub: false, loader: "smoke-t24" });
    await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: posManualContact.id, employerId: employer.id, contactTypeId: null, position: MANUAL_POSITION }),
    );

    // ---- run 1 -------------------------------------------------------------
    console.log("priming: discovering dev reject classes (dry run)");
    const allow = discoverAllowedRejects();
    const allowArgs = allow.length > 0 ? ["--allow-rejects", allow.join(",")] : [];
    if (allow.length > 0) console.log(`  (allowing: ${allow.join(",")})`);
    console.log("run 1: load-employers (NO --correct-role-links: report-only)");
    const r1 = runLoader(allowArgs);
    check("run 1 exits 0", r1.status === 0, { status: r1.status, rejects: r1.report.rejects, verifyFailures: r1.report.verifyFailures });
    check("run 1 zero verify failures", r1.report.verifyFailures === 0, r1.report.verifyFailures);
    check("run 1 keeps unstamped legacy title-as-type link (no flag)", (r1.report.shopContacts?.roleTypeLinksRemoved ?? 1) === 0 && (r1.report.shopContacts?.roleLinkCandidatesKept ?? 0) >= 2, r1.report.shopContacts);
    check("run 1 reports candidate samples", Array.isArray(r1.report.roleLinkCandidateSamples) && r1.report.roleLinkCandidateSamples.some((s: any) => s.nid === N.legacy) && r1.report.roleLinkCandidateSamples.some((s: any) => s.nid === N.collide), r1.report.roleLinkCandidateSamples);
    {
      const ls = await linksOf(legacyContact.id, employer.id);
      check("run 1: legacy bad link still present (preserved without flag)", ls.some((l) => l.contactTypeId === legacyTypeOpt.id), ls.map((l) => l.contactTypeId));
    }

    // ---- run 2: audited correction ----------------------------------------
    console.log("run 2: load-employers --correct-role-links");
    const r2c = runLoader([...allowArgs, "--correct-role-links"]);
    check("run 2 exits 0", r2c.status === 0, { status: r2c.status, rejects: r2c.report.rejects, verifyFailures: r2c.report.verifyFailures });
    check("run 2 zero verify failures", r2c.report.verifyFailures === 0, r2c.report.verifyFailures);
    check("run 2 removed the legacy title-as-type link", (r2c.report.shopContacts?.roleTypeLinksRemoved ?? 0) >= 1, r2c.report.shopContacts);
    check("run 2 still reports the staff-edited collision as kept", (r2c.report.shopContacts?.roleLinkCandidatesKept ?? 0) >= 1, r2c.report.shopContacts);

    const cmap = await getMappings("contact", [N.taxOnly, N.titleOnly, N.mixed, N.legacy]);
    if (!cmap.get(N.taxOnly) || !cmap.get(N.titleOnly) || !cmap.get(N.mixed)) {
      check("fixture contacts mapped after run 1", false, [...cmap.keys()]);
      throw new Error("fixture contacts not mapped; aborting asserts");
    }
    const typeIdByName = new Map(
      (await rows<{ id: string; name: string }>(sql`SELECT id, name FROM options_employer_contact_type`)).map((r) => [r.name, r.id]),
    );

    // taxonomy-only
    {
      const ls = await linksOf(cmap.get(N.taxOnly)!.s2Id, employer.id);
      const types = new Set(ls.map((l) => l.contactTypeId));
      check("taxOnly: two typed links from taxonomy", ls.length === 2 && types.has(typeIdByName.get(NAME_A)!) && types.has(typeIdByName.get(NAME_B)!), ls.map((l) => l.contactTypeId));
      check("taxOnly: no position", ls.every((l) => l.position === null), ls.map((l) => l.position));
    }
    // rep-title-only
    {
      const ls = await linksOf(cmap.get(N.titleOnly)!.s2Id, employer.id);
      check("titleOnly: one untyped link", ls.length === 1 && ls[0].contactTypeId === null, ls);
      check("titleOnly: position = rep title", ls[0]?.position === TITLE_ONLY_ROLE, ls[0]?.position);
      check("titleOnly: no type option created from the title", !typeIdByName.has(TITLE_ONLY_ROLE));
    }
    // mixed
    {
      const ls = await linksOf(cmap.get(N.mixed)!.s2Id, employer.id);
      check("mixed: one typed link (taxonomy only)", ls.length === 1 && ls[0].contactTypeId === typeIdByName.get(NAME_A), ls.map((l) => l.contactTypeId));
      check("mixed: position normalized onto typed link", ls[0]?.position === MIXED_ROLE_NORM, ls[0]?.position);
      check("mixed: no type option created from the title", !typeIdByName.has(MIXED_ROLE_NORM) && !typeIdByName.has(MIXED_ROLE));
    }
    // legacy correction
    {
      const ls = await linksOf(legacyContact.id, employer.id);
      check("legacy: title-as-type link removed, taxonomy link kept", ls.length === 1 && ls[0].contactTypeId === typeA.id, ls.map((l) => l.contactTypeId));
      check("legacy: position backfilled onto taxonomy link", ls[0]?.position === LEGACY_ROLE, ls[0]?.position);
      check("legacy: erroneous option row survives", typeIdByName.has(LEGACY_ROLE));
    }
    // rep-title-only alongside an operator-added typed link
    {
      const ls = await linksOf(titleOpContact.id, employer.id);
      const opLink = ls.find((l) => l.contactTypeId === typeA.id);
      const untyped = ls.filter((l) => (l.contactTypeId ?? null) === null);
      check("titleOp: operator typed link kept untouched", ls.length === 2 && !!opLink && opLink.position === null, ls.map((l) => [l.contactTypeId, l.position]));
      check("titleOp: loader added ONE untyped link with position", untyped.length === 1 && untyped[0].position === TITLE_OP_ROLE, untyped);
      check("titleOp: no type option created from the title", !typeIdByName.has(TITLE_OP_ROLE));
    }
    // collision: operator typed link whose type name == co_role, staff position
    {
      const ls = await linksOf(collideContact.id, employer.id);
      const opLink = ls.find((l) => l.contactTypeId === collideTypeOpt.id);
      check("collide: operator link with title-named type SURVIVES the flag run", !!opLink && opLink.position === COLLIDE_STAFF_POSITION, ls.map((l) => [l.contactTypeId, l.position]));
      check("collide: loader added its own untyped link with position", ls.some((l) => (l.contactTypeId ?? null) === null && l.position === COLLIDE_ROLE), ls.map((l) => [l.contactTypeId, l.position]));
    }
    // manual position on operator untyped link is never overwritten
    {
      const ls = await linksOf(posManualContact.id, employer.id);
      check("posManual: manual position intact", ls.length === 1 && ls[0].position === MANUAL_POSITION, ls.map((l) => [l.contactTypeId, l.position]));
      check("posManual: conflict reported, not overwritten", (r2c.report.shopContacts?.positionConflictsKept ?? 0) >= 1 && Array.isArray(r2c.report.positionConflictSamples) && r2c.report.positionConflictSamples.some((s: any) => s.nid === N.posManual), r2c.report.positionConflictSamples);
    }
    // provenance stamp on loader-created option rows
    {
      const stamped = await rows<{ name: string }>(sql`SELECT name FROM options_employer_contact_type WHERE name = ${NAME_B} AND data->>'s1Loader' IS NOT NULL`);
      check("loader-created option carries data.s1Loader stamp", stamped.length === 1, stamped);
    }

    // ---- run 3: idempotence ------------------------------------------------
    console.log("run 3: load-employers --correct-role-links (idempotence)");
    const r3 = runLoader([...allowArgs, "--correct-role-links"]);
    check("run 3 exits 0", r3.status === 0, { status: r3.status, rejects: r3.report.rejects });
    const sc3 = r3.report.shopContacts ?? {};
    check(
      "run 3 makes no link/position changes",
      (sc3.linksCreated ?? 1) === 0 && (sc3.linksRetyped ?? 1) === 0 && (sc3.roleTypeLinksRemoved ?? 1) === 0 && (sc3.positionsBackfilled ?? 1) === 0 && (sc3.positionsSet ?? 1) === 0,
      sc3,
    );
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (err) {
        failures++;
        console.error("cleanup failed:", err);
      }
    }
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
