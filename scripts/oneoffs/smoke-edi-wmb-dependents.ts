/**
 * Smoke test: EDI dependents are derived from WMB records (task: derive EDI
 * dependents from trust_wmb source_relation_id, not relation date windows).
 *
 * Fixtures (created and deleted against the dev DB):
 *  - Subscriber S with a WMB row for a smoke benefit in 2026-07.
 *  - dep1: ACTIVE SP relation + dependent WMB row  -> appears (role SP).
 *  - dep2: ACTIVE C relation, NO dependent WMB row -> omitted.
 *  - dep3: ENDED C relation + dependent WMB row    -> appears (scan granted).
 *  - S2: COBRA subscriber (employer siriusId COBRA) -> isCobra unit.
 *  - Dangling source_relation_id -> row skipped, batch survives (only
 *    testable when the conditional FK is absent; otherwise FK integrity
 *    makes dangling impossible and the insert is expected to fail).
 *
 * Exercises the shared buildMemberUnits plus BOTH provider plugins'
 * processBatch (Kaiser + HealthNet). Usage:
 *   npx tsx scripts/oneoffs/smoke-edi-wmb-dependents.ts
 */
// Import storage/database FIRST so its (circular) module graph initializes in
// boot order (see eligibility smoke-test convention).
import { storage } from "../../server/storage/database";
import { db } from "../../server/storage/db";
import { eq, inArray } from "drizzle-orm";
import {
  contacts,
  workers,
  employers,
  trustBenefits,
  trustWmb,
  workerRelations,
  optionsWorkerRelationType,
} from "@shared/schema";
import { buildMemberUnits } from "../../server/plugins/trust/provider-edi/base";
import { trustProviderEdiPluginRegistry } from "../../server/plugins/trust/provider-edi/registry";
import { KAISER_EDI_FIELDS } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-kaiser";
import { HEALTHNET_EDI_FIELDS } from "../../server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet";

const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";
const TAG = "SMOKE-EDI-DEP";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

async function makeWorker(name: string): Promise<{ workerId: string; contactId: string }> {
  const [c] = await db
    .insert(contacts)
    .values({ given: name, family: TAG, displayName: `${name} ${TAG}` })
    .returning();
  const [w] = await db.insert(workers).values({ contactId: c.id }).returning();
  return { workerId: w.id, contactId: c.id };
}

async function relationTypeId(siriusId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(optionsWorkerRelationType)
    .where(eq(optionsWorkerRelationType.siriusId, siriusId));
  if (existing) return existing.id;
  const [row] = await db
    .insert(optionsWorkerRelationType)
    .values({ siriusId, name: `${TAG} ${siriusId}` })
    .returning();
  return row.id;
}

async function main() {
  const created = {
    contactIds: [] as string[],
    workerIds: [] as string[],
    employerIds: [] as string[],
    benefitIds: [] as string[],
    wmbIds: [] as string[],
    relationIds: [] as string[],
  };

  try {
    // --- fixtures -----------------------------------------------------
    const [emp] = await db
      .insert(employers)
      .values({ siriusId: `${TAG}-EMP`, name: `${TAG} Employer` })
      .returning();
    created.employerIds.push(emp.id);

    let [cobraEmp] = await db
      .select()
      .from(employers)
      .where(eq(employers.siriusId, "COBRA"));
    if (!cobraEmp) {
      [cobraEmp] = await db
        .insert(employers)
        .values({ siriusId: "COBRA", name: "COBRA" })
        .returning();
      created.employerIds.push(cobraEmp.id);
    }

    const [benefit] = await db
      .insert(trustBenefits)
      .values({ siriusId: `${TAG}-K`, name: `${TAG} Benefit` })
      .returning();
    created.benefitIds.push(benefit.id);

    const sub = await makeWorker("Sub");
    const dep1 = await makeWorker("DepActiveWmb");
    const dep2 = await makeWorker("DepActiveNoWmb");
    const dep3 = await makeWorker("DepEndedWmb");
    const sub2 = await makeWorker("CobraSub");
    for (const p of [sub, dep1, dep2, dep3, sub2]) {
      created.workerIds.push(p.workerId);
      created.contactIds.push(p.contactId);
    }

    const spType = await relationTypeId("SP");
    const cType = await relationTypeId("C");

    const [rel1] = await db
      .insert(workerRelations)
      .values({ worker1: sub.workerId, worker2: dep1.workerId, relationType: spType, startYmd: "2020-01-01" })
      .returning();
    const [rel2] = await db
      .insert(workerRelations)
      .values({ worker1: sub.workerId, worker2: dep2.workerId, relationType: cType, startYmd: "2020-01-01" })
      .returning();
    const [rel3] = await db
      .insert(workerRelations)
      .values({ worker1: sub.workerId, worker2: dep3.workerId, relationType: cType, startYmd: "2020-01-01", endYmd: "2026-01-31" })
      .returning();
    created.relationIds.push(rel1.id, rel2.id, rel3.id);

    async function wmb(workerId: string, employerId: string, sourceRelationId: string | null) {
      const [row] = await db
        .insert(trustWmb)
        .values({ workerId, employerId, benefitId: benefit.id, month: MONTH, year: YEAR, sourceRelationId })
        .returning();
      created.wmbIds.push(row.id);
      return row;
    }

    const subWmb = await wmb(sub.workerId, emp.id, null);
    await wmb(dep1.workerId, emp.id, rel1.id); // active relation + WMB -> appears
    // dep2: active relation, NO wmb -> must be omitted
    await wmb(dep3.workerId, emp.id, rel3.id); // ended relation + WMB -> appears
    const cobraWmb = await wmb(sub2.workerId, cobraEmp.id, null);

    // Dangling source relation (only insertable when the conditional FK is absent).
    let danglingInserted = false;
    try {
      await wmb(dep2.workerId, cobraEmp.id, "00000000-0000-0000-0000-000000000000");
      danglingInserted = true;
    } catch {
      console.log("note: FK on source_relation_id present; dangling row not insertable (integrity enforced by DB)");
    }

    const ctx: any = {
      configId: "smoke",
      configData: { benefitSiriusId: `${TAG}-K` },
      providerId: null,
      sftpClientId: null,
      input: { asOfDate: AS_OF },
      storage,
    };

    // --- shared assembly ----------------------------------------------
    const units = await buildMemberUnits([subWmb.id, cobraWmb.id], ctx);
    check("two subscriber units built", units.length === 2, units.length);

    const subUnit = units.find((u) => u.wmb.id === subWmb.id)!;
    const cobraUnit = units.find((u) => u.wmb.id === cobraWmb.id)!;
    const depNames = subUnit.dependents.map((d) => d.givenName).sort();
    check(
      "dependents = WMB-granted only (dep1 + dep3)",
      depNames.length === 2 && depNames[0] === "DepActiveWmb" && depNames[1] === "DepEndedWmb",
      depNames,
    );
    check("active-relation-without-WMB dep omitted", !depNames.includes("DepActiveNoWmb"));
    const d1 = subUnit.dependents.find((d) => d.givenName === "DepActiveWmb")!;
    const d3 = subUnit.dependents.find((d) => d.givenName === "DepEndedWmb")!;
    check("dep1 relation type SP from referenced relation", d1.relationSiriusId === "SP", d1.relationSiriusId);
    check("dep3 (ended relation) relation type C", d3.relationSiriusId === "C", d3.relationSiriusId);
    check("dep relationId points at sourcing relation", d1.relationId === rel1.id && d3.relationId === rel3.id);
    check("COBRA unit flagged", cobraUnit.isCobra === true);
    if (danglingInserted) {
      check(
        "dangling source relation skipped without crashing",
        cobraUnit.dependents.length === 0,
        cobraUnit.dependents.length,
      );
    }

    // --- Kaiser plugin -------------------------------------------------
    const kaiser = trustProviderEdiPluginRegistry.get("sitespecific-bao-kaiser")!;
    const kRows = await kaiser.processBatch([subWmb.id, cobraWmb.id], ctx);
    const kSub = kRows.filter((r) => String(r.subscriberName).startsWith("Sub"));
    const kDeps = kSub.filter((r) => r.recordCode === "D");
    check("kaiser: A + 2 D records for subscriber", kSub.length === 3 && kDeps.length === 2, kSub.length);
    const kRoles = kDeps.map((r) => r.accountRole).sort();
    check("kaiser: roles SP->07, C->06", kRoles.join(",") === "06,07", kRoles);
    const kCobra = kRows.find((r) => r.pk === cobraWmb.id)!;
    check("kaiser: COBRA enrollment unit 7000", kCobra.enrollmentUnit === "7000", kCobra.enrollmentUnit);
    const kWidth = KAISER_EDI_FIELDS.reduce((s, f) => s + f.width, 0);
    const line = kaiser.encodeRow(kRows[0], ctx);
    check(`kaiser: encoded row width matches layout (${kWidth})`, line.length === kWidth, line.length);

    // --- HealthNet plugin ------------------------------------------------
    const hn = trustProviderEdiPluginRegistry.get("sitespecific-bao-healthnet")!;
    const hRows = await hn.processBatch([subWmb.id, cobraWmb.id], ctx);
    const hSub = hRows.filter((r) => String(r.subscriberName).startsWith("Sub"));
    const hTypes = hSub.map((r) => r.memberType).sort();
    check("healthnet: member types M,S,D", hTypes.join(",") === "D,M,S", hTypes);
    const hM = hSub.find((r) => r.memberType === "M")!;
    check("healthnet: numberCovered=3, contractType=3", hM.numberCovered === "3" && hM.contractType === "3", hM);
    const hCobra = hRows.find((r) => r.pk === cobraWmb.id)!;
    check("healthnet: COBRA pay status CO", hCobra.payStatusCode === "CO", hCobra.payStatusCode);
    const hWidth = HEALTHNET_EDI_FIELDS.reduce((s, f) => s + f.width, 0);
    const hLine = hn.encodeRow(hRows[0], ctx);
    check(`healthnet: encoded row width matches layout (${hWidth})`, hLine.length === hWidth, hLine.length);

    console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  } finally {
    // --- cleanup (reverse dependency order) ----------------------------
    if (created.wmbIds.length) await db.delete(trustWmb).where(inArray(trustWmb.id, created.wmbIds));
    if (created.relationIds.length) await db.delete(workerRelations).where(inArray(workerRelations.id, created.relationIds));
    if (created.workerIds.length) await db.delete(workers).where(inArray(workers.id, created.workerIds));
    if (created.contactIds.length) await db.delete(contacts).where(inArray(contacts.id, created.contactIds));
    if (created.benefitIds.length) await db.delete(trustBenefits).where(inArray(trustBenefits.id, created.benefitIds));
    if (created.employerIds.length) await db.delete(employers).where(inArray(employers.id, created.employerIds));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
