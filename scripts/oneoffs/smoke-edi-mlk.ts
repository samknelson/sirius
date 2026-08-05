/**
 * Smoke test: MLK CSV EDI plugin (sitespecific-smf-mlk).
 *
 * Fixtures (dev DB, deleted afterwards): subscriber + spouse dependent
 * (no address/phone → subscriber fallback) + QMSCO child (no fallback).
 * Asserts constants (POLICY/PLAN/GROUP/LOB/ERN), member vs dependent
 * account numbers and SSNs, DEP REL codes, and file assembly.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-mlk.ts
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
  mlkDepRel,
  mlkSex,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-mlk";

const TAG = "SMOKE-EDI-MLK";
const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";

async function main() {
  // Pure mapping checks.
  check("deprel: self 01", mlkDepRel(null) === "01");
  check("deprel: child flavors 06", mlkDepRel("C") === "06" && mlkDepRel("H") === "06");
  check("deprel: SP 07, DP 05, QMSCO 08", mlkDepRel("SP") === "07" && mlkDepRel("DP") === "05" && mlkDepRel("QMSCO") === "08");
  check("deprel: unknown blank", mlkDepRel("XX") === "");
  check("sex: M/F kept, unknown/blank U", mlkSex("M") === "M" && mlkSex("NB") === "U" && mlkSex(null) === "U");

  const created = newCreated();
  try {
    const emp = await makeEmployer(created, TAG);
    const benefit = await makeBenefit(created, `${TAG}-M`, `${TAG} MLK`);

    const sub = await makePerson(created, {
      given: "Sub", family: TAG, middle: "Xavier", ssn: "111223333",
      email: `sub-${TAG}@example.com`.toLowerCase(),
      birthDate: "1970-07-08", gender: "M",
      address: { street: "5 Palm Dr", city: "Compton", state: "CA", postalCode: "90220-4444" },
      phone: "12135559999",
    });
    const spouse = await makePerson(created, {
      given: "Spo", family: TAG, ssn: "444556666",
      email: `spo-${TAG}@example.com`.toLowerCase(),
      birthDate: "1971-09-10", gender: "F",
    });
    const qmsco = await makePerson(created, {
      given: "Kid", family: TAG, birthDate: "2011-12-13", gender: "F",
    });

    const relSp = await makeRelation(created, sub.workerId, spouse.workerId, await relationTypeId(TAG, "SP"));
    const relQ = await makeRelation(created, sub.workerId, qmsco.workerId, await relationTypeId(TAG, "QMSCO"));

    const subWmb = await makeWmb(created, { workerId: sub.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH });
    await makeWmb(created, { workerId: spouse.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relSp.id });
    await makeWmb(created, { workerId: qmsco.workerId, employerId: emp.id, benefitId: benefit.id, year: YEAR, month: MONTH, sourceRelationId: relQ.id });

    const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-mlk")!;
    const ctx = makeCtx({ benefitSiriusId: `${TAG}-M` }, AS_OF);
    const keys = await plugin.getPrimaryKeys!(ctx);
    check("membership: one subscriber key", keys.length === 1 && keys[0] === subWmb.id, keys);

    const rows = await plugin.processBatch(keys, ctx);
    check("rows: 1 M + 2 D", rows.length === 3 && rows.filter((r) => r.memDep === "M").length === 1, rows.length);

    const subRow = rows.find((r) => r.memDep === "M")!;
    check("constants: policy/plan/group/lob/ern",
      subRow.policy === "MLKH" && subRow.plan === "1" && subRow.group === "SMC" &&
      subRow.lob === "COMMERCIAL" && subRow.ern === "C0991", subRow);
    check("sub: mem/dep acct both subscriber sirius id",
      subRow.memAcct === String(sub.siriusId) && subRow.depAcct === String(sub.siriusId));
    check("sub: SSN + DEP SSN both subscriber's", subRow.subscriberSsn === "111223333" && subRow.memberSsn === "111223333");
    check("sub: dep rel 01, middle initial", subRow.depRel === "01" && subRow.middleInitial === "X");
    check("sub: file date today Ymd", /^\d{8}$/.test(String(subRow.fileDate)));
    check("sub: address/phone/zip", subRow.address1 === "5 Palm Dr" && subRow.phone === "2135559999" && subRow.zip === "90220", subRow);

    const spRow = rows.find((r) => String(r.pk).includes(relSp.id))!;
    check("spouse: D, dep rel 07, own SSN, subscriber MEM ACCT",
      spRow.memDep === "D" && spRow.depRel === "07" && spRow.memberSsn === "444556666" &&
      spRow.memAcct === String(sub.siriusId) && spRow.depAcct === String(spouse.siriusId), spRow);
    check("spouse: address+phone fall back to subscriber",
      spRow.address1 === "5 Palm Dr" && spRow.phone === "2135559999" && spRow.zip === "90220");
    check("spouse: own email kept", spRow.email === `spo-${TAG}@example.com`.toLowerCase());

    const qRow = rows.find((r) => String(r.pk).includes(relQ.id))!;
    check("qmsco: dep rel 08, NO address fallback", qRow.depRel === "08" && qRow.address1 === "" && qRow.phone === "" && qRow.zip === "", qRow);

    const lines = assembleEdiFileLines(plugin, rows, ctx);
    check("file: header row + 3 details", lines.length === 4, lines.length);
    check("file: header line", lines[0].startsWith("POLICY,PLAN,GROUP,FILE DT,MEM ACCT,DEP ACCT,MEM/DEP,"), lines[0]);
    check("file: 28 columns per row", lines[1].split(",").length === 28, lines[1]);
    check("file: subscriber line starts with constants", lines[1].startsWith("MLKH,1,SMC,"), lines[1]);
    check("filename", /^MLK_\d{8}\.csv$/.test(plugin.buildFilename(ctx)));

    // Config overrides for the constants.
    const rows2 = await plugin.processBatch(keys, makeCtx({ benefitSiriusId: `${TAG}-M`, policy: "ALT", ern: "Z9" }, AS_OF));
    check("config overrides constants", rows2[0].policy === "ALT" && rows2[0].ern === "Z9" && rows2[0].group === "SMC");
  } finally {
    await cleanup(created);
  }
  finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
