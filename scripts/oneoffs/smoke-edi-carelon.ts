/**
 * Smoke test: Carelon EAP CSV EDI plugin (sitespecific-smf-carelon).
 *
 * Fixtures (dev DB, deleted afterwards): two subscribers with Carelon
 * coverage — one whose medical coverage is MLK ("M"-configured benefit,
 * tier `mlk`) and one with a non-MLK medical benefit (tier `other`) —
 * plus a spouse + child under the first (family tier FMLY). Asserts the
 * headerless CSV, address fallback when ADRLN1 blank, quote stripping,
 * REL codes, TIERCD, MSTACD, and the medical-coverage-derived GRPNUM +
 * premium tier.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-carelon.ts
 */
// Import storage/database FIRST (boot-order circular-import convention).
import "../../server/storage/database";
import { db } from "../../server/storage/db";
import { eq } from "drizzle-orm";
import { optionsTrustBenefitType } from "@shared/schema";
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
  carelonRelCode,
  carelonTierCode,
  stripQuotes,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-carelon";

const TAG = "SMOKE-EDI-CARELON";
const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";

async function medicalTypeId(): Promise<string> {
  const [existing] = await db
    .select()
    .from(optionsTrustBenefitType)
    .where(eq(optionsTrustBenefitType.name, "Medical"));
  if (existing) return existing.id;
  const [row] = await db
    .insert(optionsTrustBenefitType)
    .values({ name: "Medical" })
    .returning();
  return row.id;
}

async function main() {
  // Pure mapping checks.
  check("relcode: self 01, SP/DP 02, child flavors 03",
    carelonRelCode(null) === "01" && carelonRelCode("DP") === "02" && carelonRelCode("SC") === "03" && carelonRelCode("XX") === "01");
  check("tiercd: family composition",
    carelonTierCode(["SP", "C"]) === "FMLY" && carelonTierCode(["SP"]) === "SEMP" &&
    carelonTierCode(["C"]) === "AEMP" && carelonTierCode([]) === "EEMP");
  check("stripQuotes", stripQuotes(`1 "Main" St's`) === "1 Main Sts");

  const created = newCreated();
  try {
    const emp = await makeEmployer(created, TAG);
    const medType = await medicalTypeId();
    const carelon = await makeBenefit(created, `${TAG}-EAP`, `${TAG} Carelon`);
    const mlkMed = await makeBenefit(created, `${TAG}-M`, `${TAG} MLK Medical`, medType);
    const otherMed = await makeBenefit(created, `${TAG}-K`, `${TAG} Kaiser Medical`, medType);

    const sub1 = await makePerson(created, {
      given: "Mlk", family: TAG, middle: "Ann", ssn: "222334444",
      birthDate: "1982-04-05", gender: "F",
      address: { street: `12 "Quoted" Way`, city: "LA", state: "CA", postalCode: "90011" },
      phone: "13235551111",
    });
    const spouse = await makePerson(created, {
      given: "Spo", family: TAG, ssn: "333445555", birthDate: "1983-06-07", gender: "M",
    });
    const child = await makePerson(created, {
      given: "Kid", family: TAG, birthDate: "2014-08-09", gender: "F",
    });
    const sub2 = await makePerson(created, {
      given: "Oth", family: TAG, ssn: "555667777", birthDate: "1979-10-11", gender: "M",
      address: { street: "8 Pine Ct", city: "LB", state: "CA", postalCode: "90802" },
    });

    const relSp = await makeRelation(created, sub1.workerId, spouse.workerId, await relationTypeId(TAG, "SP"));
    const relC = await makeRelation(created, sub1.workerId, child.workerId, await relationTypeId(TAG, "C"));

    const wmb1 = await makeWmb(created, { workerId: sub1.workerId, employerId: emp.id, benefitId: carelon.id, year: YEAR, month: MONTH });
    await makeWmb(created, { workerId: spouse.workerId, employerId: emp.id, benefitId: carelon.id, year: YEAR, month: MONTH, sourceRelationId: relSp.id });
    await makeWmb(created, { workerId: child.workerId, employerId: emp.id, benefitId: carelon.id, year: YEAR, month: MONTH, sourceRelationId: relC.id });
    const wmb2 = await makeWmb(created, { workerId: sub2.workerId, employerId: emp.id, benefitId: carelon.id, year: YEAR, month: MONTH });
    // Medical coverage rows in the as-of month.
    await makeWmb(created, { workerId: sub1.workerId, employerId: emp.id, benefitId: mlkMed.id, year: YEAR, month: MONTH });
    await makeWmb(created, { workerId: sub2.workerId, employerId: emp.id, benefitId: otherMed.id, year: YEAR, month: MONTH });

    const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-carelon")!;
    const ctx = makeCtx(
      { benefitSiriusId: `${TAG}-EAP`, mlkBenefitSiriusId: `${TAG}-M` },
      AS_OF,
    );
    const keys = await plugin.getPrimaryKeys!(ctx);
    check("membership: two subscriber keys", keys.length === 2 && keys.includes(wmb1.id) && keys.includes(wmb2.id), keys);

    const rows = await plugin.processBatch(keys, ctx);
    check("rows: 2 subscribers + 2 dependents", rows.length === 4, rows.length);

    const s1 = rows.find((r) => r.pk === wmb1.id)!;
    check("mlk sub: premium tier mlk, GRPNUM = medical benefit id", s1.premiumTier === "mlk" && s1.grpNum === `${TAG}-M`, s1);
    check("mlk sub: TIERCD FMLY (spouse + child)", s1.tierCode === "FMLY");
    check("mlk sub: MSTACD A, relcode 01", s1.memberStatus === "A" && s1.relCode === "01");
    check("mlk sub: quotes stripped from address", s1.address1 === "12 Quoted Way", s1.address1);
    check("mlk sub: middle initial", s1.middleInitial === "A");

    const s2 = rows.find((r) => r.pk === wmb2.id)!;
    check("other sub: premium tier other, GRPNUM = its medical benefit", s2.premiumTier === "other" && s2.grpNum === `${TAG}-K`, s2);
    check("other sub: TIERCD EEMP (no dependents)", s2.tierCode === "EEMP");

    const spRow = rows.find((r) => String(r.pk).includes(relSp.id))!;
    check("spouse: relcode 02, MEMBNO subscriber SSN, own SOCSEC",
      spRow.relCode === "02" && spRow.subscriberSsn === "222334444" && spRow.memberSsn === "333445555", spRow);
    check("spouse: blank ADRLN1 → whole address falls back to subscriber",
      spRow.address1 === "12 Quoted Way" && spRow.city === "LA" && spRow.zip === "90011");
    check("spouse: TIERCD blank on dependents", spRow.tierCode === "");

    const cRow = rows.find((r) => String(r.pk).includes(relC.id))!;
    check("child: relcode 03", cRow.relCode === "03");

    const lines = assembleEdiFileLines(plugin, rows, ctx);
    check("file: NO header row — 4 detail lines only", lines.length === 4, lines.length);
    check("file: 23 columns per row", lines[0].split(",").length === 23, lines[0]);
    check("file: no header names in first line", !lines[0].startsWith("MEMBNO"), lines[0]);
    check("filename", /^CARELON_\d{8}\.csv$/.test(plugin.buildFilename(ctx)));
  } finally {
    await cleanup(created);
  }
  finish();
}

main().catch((err) => { console.error(err); process.exit(1); });
