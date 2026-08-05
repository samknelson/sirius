/**
 * Smoke test for the 2026-08-05 S1-migration rulings:
 *   - N26: defaultRelationshipDates() pure helper (missing-start defaults)
 *   - N25: employer_contacts MULTI-LINK storage guard (create + update)
 *
 * The multi-link cases create throwaway rows on the dev DB and delete them
 * in a finally block. Run: npx tsx scripts/oneoffs/s1-n25-n26-smoke.ts
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { defaultRelationshipDates } from "../s1-migration/lib/loader-utils";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`);
  if (!cond) failures++;
}

async function main() {
  // ---------------- N26 pure helper ----------------
  const a = defaultRelationshipDates("2010-05-01", null);
  check("N26 real start, no end → untouched", a.startYmd === "2010-05-01" && a.endYmd === null && !a.defaulted);
  const b = defaultRelationshipDates("2010-05-01", "2011-01-01");
  check("N26 real start+end → untouched", b.startYmd === "2010-05-01" && b.endYmd === "2011-01-01" && !b.defaulted);
  const c = defaultRelationshipDates(null, null);
  check("N26 missing both → 2000-01-01 / 2000-01-02", c.startYmd === "2000-01-01" && c.endYmd === "2000-01-02" && c.defaulted);
  const d = defaultRelationshipDates(null, "2015-03-04");
  check("N26 missing start keeps real end", d.startYmd === "2000-01-01" && d.endYmd === "2015-03-04" && d.defaulted);
  const e = defaultRelationshipDates(null, "1999-01-01");
  check(
    "N26 real end before default start preserved (loader end_before_start catches it)",
    e.startYmd === "2000-01-01" && e.endYmd === "1999-01-01" && e.defaulted,
  );

  // ---------------- N25 multi-link storage guard ----------------
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const employer = await withNotificationsSuppressed(() =>
      storage.employers.createEmployer({ name: "SMOKE N25 employer (delete me)" }),
    );
    cleanup.push(async () => {
      await db.execute(sql`DELETE FROM employers WHERE id = ${employer.id}`);
    });
    const contact = await withNotificationsSuppressed(() =>
      storage.contacts.createContact({ displayName: "SMOKE N25 contact (delete me)", email: null }),
    );
    cleanup.push(async () => {
      await db.execute(sql`DELETE FROM contacts WHERE id = ${contact.id}`);
    });
    cleanup.push(async () => {
      await db.execute(sql`DELETE FROM employer_contacts WHERE contact_id = ${contact.id}`);
    });

    const typeRows = await db.execute(sql`SELECT id FROM options_employer_contact_type ORDER BY id LIMIT 2`);
    const typeA = (typeRows.rows[0]?.id as string | undefined) ?? null;
    const typeB = (typeRows.rows[1]?.id as string | undefined) ?? null;

    const l1 = await withNotificationsSuppressed(() =>
      storage.employerContacts.create({ contactId: contact.id, employerId: employer.id, contactTypeId: null }),
    );
    check("N25 untyped link created", !!l1.id);

    let threw = false;
    try {
      await withNotificationsSuppressed(() =>
        storage.employerContacts.create({ contactId: contact.id, employerId: employer.id, contactTypeId: null }),
      );
    } catch {
      threw = true;
    }
    check("N25 second untyped link rejected", threw);

    if (typeA) {
      const l2 = await withNotificationsSuppressed(() =>
        storage.employerContacts.create({ contactId: contact.id, employerId: employer.id, contactTypeId: typeA }),
      );
      check("N25 typed link alongside untyped allowed", !!l2.id);

      threw = false;
      try {
        await withNotificationsSuppressed(() =>
          storage.employerContacts.create({ contactId: contact.id, employerId: employer.id, contactTypeId: typeA }),
        );
      } catch {
        threw = true;
      }
      check("N25 duplicate typed link rejected", threw);

      threw = false;
      try {
        await withNotificationsSuppressed(() => storage.employerContacts.update(l2.id, { contactTypeId: null }));
      } catch {
        threw = true;
      }
      check("N25 retype onto colliding untyped sibling rejected", threw);

      if (typeB) {
        const upd = await withNotificationsSuppressed(() => storage.employerContacts.update(l2.id, { contactTypeId: typeB }));
        check("N25 retype to a free type allowed", upd?.contactTypeId === typeB);
      } else {
        console.log("SKIP: only one contact type on dev — retype-to-free-type not exercised");
      }
    } else {
      console.log("SKIP: no options_employer_contact_type rows on dev — typed-link cases not exercised");
    }
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch (err) {
        console.error("cleanup failed:", err);
        failures++;
      }
    }
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
