/**
 * Dev-only smoke for cleanup-contact-type-options.ts (task 344) — proves the
 * locked delete cannot silently null a concurrently created
 * employer_contacts link (the FK is ON DELETE SET NULL, so an unlocked
 * count-then-delete would strip the new link's type).
 *
 * Scenarios:
 *   1. skip-on-adoption: a link exists at locked-recheck time → delete SKIPs.
 *   2. concurrent adoption: a cleanup transaction holds FOR UPDATE on the
 *      option while a second connection tries to insert a link referencing
 *      it. The insert must BLOCK (FK KEY SHARE lock) until the cleanup
 *      commits, then fail with FK violation 23503 — never end up with
 *      contact_type_id silently NULLed.
 *
 * All rows are seeded with a T344SMOKE marker and removed at the end.
 *
 * Usage: npx tsx scripts/s1-migration/dev/smoke-contact-type-cleanup.ts
 */
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

const MARK = "T344SMOKE";
let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const rowsOf = (r: unknown) => (r as { rows: Array<Record<string, any>> }).rows;

/** Same locked verify+delete as the cleanup script, plus an optional pause hook while holding the lock. */
async function lockedDelete(id: string, pauseMs = 0): Promise<{ ok: boolean; reason?: string }> {
  return db.transaction(async (tx) => {
    const lr = rowsOf(await tx.execute(sql`SELECT id, data FROM options_employer_contact_type WHERE id = ${id} FOR UPDATE`));
    if (!lr[0]) return { ok: false, reason: "gone" };
    if (!lr[0].data?.s1Loader) return { ok: false, reason: "no longer loader-stamped" };
    if (pauseMs > 0) await new Promise((res) => setTimeout(res, pauseMs));
    const c = Number(rowsOf(await tx.execute(sql`SELECT COUNT(*)::int AS c FROM employer_contacts WHERE contact_type_id = ${id}`))[0]?.c ?? 0);
    if (c > 0) return { ok: false, reason: `adopted (${c} refs)` };
    await tx.execute(sql`DELETE FROM options_employer_contact_type WHERE id = ${id}`);
    return { ok: true };
  });
}

async function cleanup() {
  await db.execute(sql`DELETE FROM employer_contacts WHERE position = ${MARK}`);
  await db.execute(sql`DELETE FROM contacts WHERE display_name LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM employers WHERE name LIKE ${MARK + "%"}`);
  await db.execute(sql`DELETE FROM options_employer_contact_type WHERE name LIKE ${MARK + "%"}`);
}

async function main() {
  await cleanup();

  // Seed: employer + contact + two loader-stamped orphan options.
  const emp = rowsOf(await db.execute(sql`INSERT INTO employers (name) VALUES (${MARK + " Employer"}) RETURNING id`))[0].id;
  const contact = rowsOf(await db.execute(sql`INSERT INTO contacts (display_name) VALUES (${MARK + " Contact"}) RETURNING id`))[0].id;
  const optA = rowsOf(await db.execute(sql`INSERT INTO options_employer_contact_type (name, data) VALUES (${MARK + " OptA"}, '{"s1Loader":"smoke"}'::jsonb) RETURNING id`))[0].id;
  const optB = rowsOf(await db.execute(sql`INSERT INTO options_employer_contact_type (name, data) VALUES (${MARK + " OptB"}, '{"s1Loader":"smoke"}'::jsonb) RETURNING id`))[0].id;

  // 1. skip-on-adoption
  await db.execute(sql`INSERT INTO employer_contacts (contact_id, employer_id, contact_type_id, position) VALUES (${contact}, ${emp}, ${optA}, ${MARK})`);
  const r1 = await lockedDelete(optA);
  check("skip-on-adoption", !r1.ok && /adopted/.test(r1.reason ?? ""), JSON.stringify(r1));
  const stillThere = rowsOf(await db.execute(sql`SELECT 1 FROM options_employer_contact_type WHERE id = ${optA}`)).length === 1;
  check("adopted option not deleted", stillThere);

  // 2. concurrent adoption during the cleanup transaction
  const delPromise = lockedDelete(optB, 1500); // holds FOR UPDATE for 1.5s before recount+delete
  await new Promise((res) => setTimeout(res, 400)); // let the tx acquire the lock
  const ins: { state: string; code?: string; msg?: string } = { state: "pending" };
  const insPromise = db
    .execute(sql`INSERT INTO employer_contacts (contact_id, employer_id, contact_type_id, position) VALUES (${contact}, ${emp}, ${optB}, ${MARK})`)
    .then(() => { ins.state = "ok"; })
    .catch((e: any) => { ins.state = "error"; ins.code = e?.code ?? e?.cause?.code; ins.msg = String(e?.message ?? e); });
  await new Promise((res) => setTimeout(res, 500));
  check("concurrent insert blocks on option lock", ins.state === "pending", `state=${JSON.stringify(ins)}`);
  const r2 = await delPromise;
  check("locked delete succeeds while blocking adopter", r2.ok === true, JSON.stringify(r2));
  await insPromise;
  const failedFk = ins.state === "error" && (ins.code === "23503" || /foreign key|23503/i.test(ins.msg ?? ""));
  check("blocked insert fails FK (never silently NULLed)", failedFk, `state=${JSON.stringify(ins)}`);
  const nulled = rowsOf(await db.execute(sql`SELECT 1 FROM employer_contacts WHERE position = ${MARK} AND contact_type_id IS NULL`)).length;
  check("no link left with NULLed type", nulled === 0, `nulledRows=${nulled}`);

  await cleanup();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("smoke failed:", e);
  try { await cleanup(); } catch {}
  process.exit(1);
});
