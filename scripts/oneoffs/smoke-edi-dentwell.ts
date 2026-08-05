/**
 * Smoke test: Dentwell CSV EDI plugin (sitespecific-smf-dentwell).
 *
 * Fixtures (dev DB, deleted afterwards): subscriber + spouse dependent +
 * child dependent. Asserts row layout (SUB/DEP, relationship codes,
 * subscriber SSN carried on every row, members keep their OWN address —
 * no fallback), and file assembly: H header record, CSV column header,
 * detail rows, T trailer with subscriber/dependent counts.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-dentwell.ts
 */
// Import storage/database FIRST (boot-order circular-import convention).
import "../../server/storage/database";
import {
  check,
  newCreated,
  makePerson,
  makeEmployer,
  makeBenefit,
  makeWmb,
  makeRelation,
  relationTypeId,
  makeCtx,
  cleanup,
  finish,
} from "./edi-smoke-helpers";
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import { trustProviderEdiPluginRegistry } from "../../server/plugins/trust/provider-edi/registry";
import {
  dentwellRelationshipCode,
  dentwellGender,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-dentwell";

const TAG = "SMOKE-EDI-DENTWELL";
const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";

async function main() {
  // Pure mapping checks.
  check("relcode: self 18", dentwellRelationshipCode(null) === "18");
  check("relcode: child flavors 19", dentwellRelationshipCode("C") === "19" && dentwellRelationshipCode("AC") === "19");
  check("relcode: SP/DP 01", dentwellRelationshipCode("SP") === "01" && dentwellRelationshipCode("DP") === "01");
  check("relcode: QMSCO 08, unknown blank", dentwellRelationshipCode("QMSCO") === "08" && dentwellRelationshipCode("XX") === "");
  check("gender: M/F kept, odd U, blank blank", dentwellGender("F") === "F" && dentwellGender("NB") === "U" && dentwellGender(null) === "");

  const created = newCreated();
  try {
    const emp = await makeEmployer(created, TAG);
    const benefit = await makeBenefit(created, `${TAG}-LADC`, `${TAG} Dentwell`);

    const sub = await makePerson(created, {
      given: "Sub", family: TAG, middle: "Quincy", ssn: "987654321",
      email: `sub-${TAG}@example.com`.toLowerCase(),
      birthDate: "1975-11-30", gender: "F",
      address: { street: "9 Elm Ave", city: "Burbank", state: "CA", postalCode: "91502" },
      phone: "18185550000",
    });
    const spouse = await makePerson(created, {
      given: "Spo", family: TAG, birthDate: "1976-01-01", gender: "M",
      address: { street: "77 Oak Rd", city: "Glendale", state: "CA", postalCode: "91203" },
    });
    const child = await makePerson(created, {
      given: "Kid", family: TAG, birthDate: "2012-02-03", gender: "F",
    });

    const relSp = await makeRelation(created, sub.workerId, spouse.workerId, await relationTypeId(TAG, "SP"));
    const relC = await makeRelation(created, sub.workerId, child.workerId, await relationTypeId(TAG, "C"));

    const subWmb = await makeWmb(created, { workerId: sub.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH });
    await makeWmb(created, { workerId: spouse.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relSp.id });
    await makeWmb(created, { workerId: child.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relC.id });

    const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-dentwell")!;
    const ctx = makeCtx({ benefitSiriusId: `${TAG}-LADC` }, AS_OF);
    const keys = await plugin.getPrimaryKeys!(ctx);
    check("membership: one subscriber key", keys.length === 1 && keys[0] === subWmb.id, keys);

    const rows = await plugin.processBatch(keys, ctx);
    check("rows: 1 SUB + 2 DEP", rows.length === 3 && rows.filter((r) => r.memberType === "SUB").length === 1, rows.length);

    const subRow = rows.find((r) => r.memberType === "SUB")!;
    check("sub: subscriber SSN, relcode 18", subRow.subscriberSsn === "987654321" && subRow.relationshipCode === "18");
    check("sub: middle name full (not initial)", subRow.middleName === "Quincy");
    check("sub: own address/phone/email/gender",
      subRow.street === "9 Elm Ave" && subRow.zip === "91502" && subRow.phone === "8185550000" &&
      subRow.email === `sub-${TAG}@example.com`.toLowerCase() && subRow.gender === "F", subRow);

    const spRow = rows.find((r) => String(r.pk).includes(relSp.id))!;
    check("spouse: DEP, relcode 01, carries subscriber SSN", spRow.memberType === "DEP" && spRow.relationshipCode === "01" && spRow.subscriberSsn === "987654321");
    check("spouse: keeps OWN address (no fallback)", spRow.street === "77 Oak Rd" && spRow.city === "Glendale", spRow);

    const cRow = rows.find((r) => String(r.pk).includes(relC.id))!;
    check("child: relcode 19; blank address stays blank", cRow.relationshipCode === "19" && cRow.street === "" && cRow.city === "", cRow);

    const lines = assembleEdiFileLines(plugin, rows, ctx);
    check("file: H + column header + 3 details + T", lines.length === 6, lines);
    check("file: H record carries as-of date", lines[0] === "H,,20260715", lines[0]);
    check("file: column header", lines[1].startsWith("Record Type,SubscriberNumber,MemberType,"), lines[1]);
    check("file: detail rows start with E", lines[2].startsWith("E,987654321,SUB,") && lines[3].startsWith("E,987654321,DEP,"), lines[2]);
    check("file: 19 columns per detail row", lines[2].split(",").length === 19, lines[2]);
    check("file: T trailer counts 1 sub / 2 deps", lines[5] === "T,1,2", lines[5]);
    check("filename", /^DENTWELL_\d{8}\.csv$/.test(plugin.buildFilename(ctx)));
  } finally {
    await cleanup(created);
  }
  finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
