/**
 * Regression guard for the Workers list two-field search.
 *
 * The Name/ID search must never match contact columns (email, phone, postal),
 * and the Contact search must never match name/ID columns (display_name,
 * given, family, sirius_id, worker_ids). This compiles the two SQL condition
 * builders and asserts the column separation, plus the AND-across-terms /
 * OR-within-field semantics.
 *
 * Run: npx tsx scripts/dev/check-worker-search-separation.ts
 */
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildNameIdSearchCondition,
  buildContactSearchCondition,
} from "../../server/storage/worker-search-conditions";

const dialect = new PgDialect();
const compile = (chunk: any) => dialect.sqlToQuery(chunk).sql.toLowerCase();

let failures = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

const NAME_ID_COLUMNS = ["display_name", "c.given", "c.family", "sirius_id", "worker_ids"];
const CONTACT_COLUMNS = ["c.email", "contact_phone", "contact_postal", "phone_number", "postal_code"];

console.log("Name/ID search condition:");
const nameIdSql = compile(buildNameIdSearchCondition("smith 12345"));
for (const col of NAME_ID_COLUMNS) {
  check(`matches ${col}`, nameIdSql.includes(col));
}
for (const col of CONTACT_COLUMNS) {
  check(`does NOT match ${col}`, !nameIdSql.includes(col));
}
check("only enabled (show-on-lists) worker IDs", nameIdSql.includes("showonlists"));
check("terms are ANDed", (nameIdSql.match(/\) and \(/g)?.length ?? 0) >= 1);

console.log("Contact search condition:");
const contactSql = compile(buildContactSearchCondition("555-1234 main"));
for (const col of CONTACT_COLUMNS) {
  check(`matches ${col}`, contactSql.includes(col));
}
for (const col of NAME_ID_COLUMNS) {
  check(`does NOT match ${col}`, !contactSql.includes(col));
}
check("digit-normalized phone matching for numeric terms", contactSql.includes("regexp_replace"));
check("only active phones", contactSql.includes("cp.is_active = true"));
check("only active postal addresses", contactSql.includes("cpo.is_active = true"));
check("terms are ANDed", (contactSql.match(/\) and \(/g)?.length ?? 0) >= 1);

console.log("Empty input:");
check("empty Name/ID search produces no condition", compile(buildNameIdSearchCondition("  ")).trim() === "");
check("empty Contact search produces no condition", compile(buildContactSearchCondition(undefined)).trim() === "");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll worker search separation checks passed");
