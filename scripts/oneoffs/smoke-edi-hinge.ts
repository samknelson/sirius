/**
 * Smoke test: Hinge CSV EDI plugin (sitespecific-smf-hinge).
 *
 * Fixtures (dev DB, deleted afterwards): subscriber with SSN/email/address/
 * phone + spouse dependent without address/email (subscriber fallback) +
 * QMSCO child without address (no fallback). Asserts membership, row
 * layout/values, relationship/sex codes, and file assembly (header row).
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-hinge.ts
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
  hingeRelationship,
  hingeSex,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-hinge";

const TAG = "SMOKE-EDI-HINGE";
const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";

async function main() {
  // Pure mapping checks.
  check("relationship: subscriber → EE", hingeRelationship(null) === "EE");
  check("relationship: SP → Spouse", hingeRelationship("SP") === "Spouse");
  check("relationship: AC → Child", hingeRelationship("AC") === "Child");
  check("relationship: QMSCO → Q", hingeRelationship("QMSCO") === "Q");
  check("relationship: other → Other", hingeRelationship("XX") === "Other");
  check("sex: M/F kept, odd → U, blank stays blank",
    hingeSex("M") === "M" && hingeSex("NB") === "U" && hingeSex(null) === "");

  const created = newCreated();
  try {
    const emp = await makeEmployer(created, TAG);
    const benefit = await makeBenefit(created, `${TAG}-HINGEPT`, `${TAG} Hinge`);

    const sub = await makePerson(created, {
      given: "Sub", family: TAG, ssn: "123456789",
      email: `sub-${TAG}@example.com`.toLowerCase(),
      birthDate: "1980-01-02", gender: "M",
      address: { street: "1 Main St", city: "LA", state: "CA", postalCode: "90001-1234" },
      phone: "13105551212",
    });
    const spouse = await makePerson(created, {
      given: "Spo", family: TAG, birthDate: "1981-03-04", gender: "F",
    });
    const qmsco = await makePerson(created, {
      given: "Kid", family: TAG, birthDate: "2010-05-06", gender: "M",
    });

    const relSp = await makeRelation(created, sub.workerId, spouse.workerId, await relationTypeId(TAG, "SP"));
    const relQ = await makeRelation(created, sub.workerId, qmsco.workerId, await relationTypeId(TAG, "QMSCO"));

    const subWmb = await makeWmb(created, { workerId: sub.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH });
    // Prior month → contiguous coverage start 2026-06-01.
    await makeWmb(created, { workerId: sub.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH - 1 });
    await makeWmb(created, { workerId: spouse.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relSp.id });
    await makeWmb(created, { workerId: qmsco.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relQ.id });

    const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-hinge")!;
    const ctx = makeCtx({ benefitSiriusId: `${TAG}-HINGEPT` }, AS_OF);
    const keys = await plugin.getPrimaryKeys!(ctx);
    check("membership: one subscriber key", keys.length === 1 && keys[0] === subWmb.id, keys);

    const rows = await plugin.processBatch(keys, ctx);
    check("rows: subscriber + 2 dependents", rows.length === 3, rows.length);

    const subRow = rows.find((r) => r.pk === subWmb.id)!;
    check("sub: subscriber_id = worker sirius id", subRow.subscriberId === String(sub.siriusId));
    check("sub: relationship EE, sex M", subRow.relationship === "EE" && subRow.sex === "M");
    check("sub: dob compact", subRow.birthDate === "19800102");
    check("sub: address/zip/email", subRow.address1 === "1 Main St" && subRow.zip === "90001" && subRow.email === `sub-${TAG}@example.com`.toLowerCase(), subRow);
    check("sub: coverage start walks back contiguous months", subRow.coverageStart === "20260601");
    check("sub: term date blank", subRow.coverageEnd === "");

    const spRow = rows.find((r) => String(r.pk).includes(relSp.id))!;
    check("spouse: relationship Spouse, sex F", spRow.relationship === "Spouse" && spRow.sex === "F");
    check("spouse: address+email fall back to subscriber",
      spRow.address1 === "1 Main St" && spRow.city === "LA" && spRow.zip === "90001" && spRow.email === subRow.email, spRow);
    check("spouse: rides under subscriber id", spRow.subscriberId === String(sub.siriusId));

    const qRow = rows.find((r) => String(r.pk).includes(relQ.id))!;
    check("qmsco: relationship Q", qRow.relationship === "Q");
    check("qmsco: NO subscriber address fallback", qRow.address1 === "" && qRow.city === "" && qRow.zip === "", qRow);

    const lines = assembleEdiFileLines(plugin, rows, ctx);
    check("file: header row + 3 detail rows", lines.length === 4, lines.length);
    check("file: header line", lines[0].startsWith("subscriber_id,first_name,last_name,dob,relationship,sex,"), lines[0]);
    check("file: 15 columns per row", lines[1].split(",").length === 15, lines[1]);
    check("file: subscriber line values", lines[1].startsWith(`${sub.siriusId},Sub,${TAG},19800102,EE,M,1 Main St,`), lines[1]);
    check("filename", /^HINGE_\d{8}\.csv$/.test(plugin.buildFilename(ctx)));
  } finally {
    await cleanup(created);
  }
  finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
