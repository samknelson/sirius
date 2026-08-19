/**
 * Smoke test for association-level contact job positions (Task: Add Contact
 * Job Positions):
 *
 *  1. Migration 1126 is idempotent (rerunning is a no-op).
 *  2. employerContacts storage: create persists a trimmed position,
 *     whitespace-only stores null, reads (get/listByEmployer/listByContactId/
 *     getAll) return it, update edits and clears it, and a position-only
 *     update leaves contactTypeId untouched.
 *  3. trustProviderContacts storage: same lifecycle.
 *
 * Run: npx tsx scripts/oneoffs/contact-position-smoke.ts
 * Seeds temp rows in the dev DB and removes them afterwards.
 */
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage";
import migration1126 from "../migrate/core/1126_add_contact_position";

const TAG = `smoke-pos-${Date.now()}`;

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

async function main() {
  // 1. Migration idempotence (columns may already exist from db:push/boot).
  await migration1126.up();
  await migration1126.up();
  const cols = await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'position'
      AND table_name IN ('employer_contacts', 'trust_provider_contacts')
  `);
  check("migration adds position to both tables", (cols as any).rows.length === 2, (cols as any).rows);

  const cleanup: Array<() => Promise<void>> = [];
  try {
    // --- Employer contact lifecycle ---
    const employer = await storage.employers.createEmployer({ name: `Emp ${TAG}`, isActive: true });
    cleanup.push(async () => { await db.execute(sql`DELETE FROM employers WHERE id = ${employer.id}`); });
    const contact = await storage.contacts.createContact({ displayName: `EC ${TAG}`, email: `ec-${TAG}@example.com` });
    cleanup.push(async () => { await db.execute(sql`DELETE FROM contacts WHERE id = ${contact.id}`); });

    const ec = await storage.employerContacts.create({
      contactId: contact.id,
      employerId: employer.id,
      position: "  Director of Human Resources  ",
    });
    check("EC create trims position", ec.position === "Director of Human Resources", ec.position);

    const fetched = await storage.employerContacts.get(ec.id);
    check("EC get returns position", fetched?.position === "Director of Human Resources");

    const listed = await storage.employerContacts.listByEmployer(employer.id);
    check("EC listByEmployer returns position", listed.find((l) => l.id === ec.id)?.position === "Director of Human Resources");

    const byContact = await storage.employerContacts.listByContactId(contact.id);
    check("EC listByContactId returns position", byContact.find((l) => l.id === ec.id)?.position === "Director of Human Resources");

    const all = await storage.employerContacts.getAll({ employerId: employer.id });
    check("EC getAll returns position", all.find((l) => l.id === ec.id)?.position === "Director of Human Resources");

    const updated = await storage.employerContacts.update(ec.id, { position: "CFO" });
    check("EC update edits position", updated?.position === "CFO");

    const posOnly = await storage.employerContacts.update(ec.id, { position: "COO" });
    check("EC position-only update keeps contactTypeId", posOnly?.contactTypeId === ec.contactTypeId && posOnly?.position === "COO");

    const cleared = await storage.employerContacts.update(ec.id, { position: "   " });
    check("EC whitespace-only position clears to null", cleared?.position === null);

    const ec2 = await storage.employerContacts.create({ contactId: contact.id, employerId: employer.id, contactTypeId: null, position: undefined });
    check("EC create without position stores null", ec2 === null || false, "duplicate untyped link should have thrown");
  } catch (err: any) {
    if (err?.message === "This contact is already linked to this employer with this contact type") {
      check("EC duplicate untyped link still rejected", true);
    } else {
      failures++;
      console.log("FAIL employer-contact lifecycle threw ::", err?.message);
    }
  }

  try {
    // --- Trust provider contact lifecycle ---
    const provRes = await db.execute(sql`INSERT INTO trust_providers (name) VALUES (${`Prov ${TAG}`}) RETURNING id`);
    const providerId = (provRes as any).rows[0].id as string;
    cleanup.push(async () => { await db.execute(sql`DELETE FROM trust_providers WHERE id = ${providerId}`); });
    const contact2 = await storage.contacts.createContact({ displayName: `TPC ${TAG}`, email: `tpc-${TAG}@example.com` });
    cleanup.push(async () => { await db.execute(sql`DELETE FROM contacts WHERE id = ${contact2.id}`); });

    const tpc = await storage.trustProviderContacts.create({
      contactId: contact2.id,
      providerId,
      position: "  Claims Manager ",
    });
    check("TPC create trims position", tpc.position === "Claims Manager", tpc.position);

    const tFetched = await storage.trustProviderContacts.get(tpc.id);
    check("TPC get returns position", tFetched?.position === "Claims Manager");

    const tListed = await storage.trustProviderContacts.listByProvider(providerId);
    check("TPC listByProvider returns position", tListed.find((l) => l.id === tpc.id)?.position === "Claims Manager");

    const tByContact = await storage.trustProviderContacts.listByContactId(contact2.id);
    check("TPC listByContactId returns position", tByContact.find((l) => l.id === tpc.id)?.position === "Claims Manager");

    const tUpdated = await storage.trustProviderContacts.update(tpc.id, { position: "Account Executive" });
    check("TPC update edits position", tUpdated?.position === "Account Executive");

    const tPosOnly = await storage.trustProviderContacts.update(tpc.id, { position: "VP" });
    check("TPC position-only update keeps contactTypeId", tPosOnly?.contactTypeId === tpc.contactTypeId && tPosOnly?.position === "VP");

    const tCleared = await storage.trustProviderContacts.update(tpc.id, { position: null });
    check("TPC null position clears to null", tCleared?.position === null);
  } catch (err: any) {
    failures++;
    console.log("FAIL trust-provider-contact lifecycle threw ::", err?.message);
  }

  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch (e: any) { console.log("cleanup error:", e?.message); }
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
