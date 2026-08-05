/**
 * Smoke test: SMF fixed-width EDI plugins — VSP, Delta Dental, Express
 * Scripts (task: port the three fixed-width legacy EDI reports).
 *
 * Fixtures (created and deleted against the dev DB, TAG-scoped):
 *  - Subscriber SUB with a spouse (SP) dependent and a QMSCO dependent.
 *  - Second worker ENH on the enhanced vision benefit only.
 *  - Benefits: TAG-3 / TAG-3E (vision std/enh), TAG-D (dental), TAG-RX
 *    (pharmacy), TAG-MED (medical plan, mapped → SMM00 via config).
 *
 * Checks per plugin: registration, membership, subscriber + dependent
 *  rows, exact line widths (every line), and header/trailer content and
 *  record counts (Delta, ESI) via assembleEdiFileLines.
 *
 * Usage: npx tsx scripts/oneoffs/smoke-edi-smf-fixedwidth.ts
 */
// Import storage/database FIRST so its (circular) module graph initializes
// in boot order (see eligibility smoke-test convention).
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
import { assembleEdiFileLines } from "../../server/plugins/trust/provider-edi/base";
import {
  trustProviderEdiPluginRegistry,
  type TrustProviderEdiContext,
} from "../../server/plugins/trust/provider-edi/registry";
import {
  VSP_RECORD_WIDTH,
  vspDivisionCode,
  vspDependentFamilyIndicator,
  vspSubscriberFamilyIndicator,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-vsp";
import {
  DELTA_RECORD_WIDTH,
  DELTA_HEADER_WIDTH,
  DELTA_TRAILER_WIDTH,
  deltaMemberClassification,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-delta";
import {
  ESI_RECORD_WIDTH,
  ESI_HEADER_WIDTH,
  ESI_TRAILER_WIDTH,
  esiRelationshipCode,
} from "../../server/plugins/trust/provider-edi/plugins/sitespecific-smf-expressscripts";

const TAG = "SMOKE-FWEDI";
const YEAR = 2026;
const MONTH = 7;
const AS_OF = "2026-07-15";

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`,
  );
}

function mkCtx(
  configData: Record<string, unknown>,
  input: Record<string, unknown> = {},
): TrustProviderEdiContext {
  return {
    configId: "smoke",
    configData,
    providerId: null,
    sftpClientId: null,
    input: { asOfDate: AS_OF, ...input },
    storage,
  };
}

async function relationTypeId(siriusId: string, created: string[]): Promise<string> {
  const [existing] = await db
    .select({ id: optionsWorkerRelationType.id })
    .from(optionsWorkerRelationType)
    .where(eq(optionsWorkerRelationType.siriusId, siriusId));
  if (existing) return existing.id;
  const [row] = await db
    .insert(optionsWorkerRelationType)
    .values({ siriusId, name: `${TAG} ${siriusId}` })
    .returning();
  created.push(row.id);
  return row.id;
}

async function main() {
  const created = {
    contactIds: [] as string[],
    workerIds: [] as string[],
    employerIds: [] as string[],
    benefitIds: [] as string[],
    relationIds: [] as string[],
    relTypeIds: [] as string[],
    wmbIds: [] as string[],
  };

  try {
    // --- fixtures ---------------------------------------------------------
    const [emp] = await db
      .insert(employers)
      .values({ siriusId: `${TAG}-EMP`, name: `${TAG} Employer` })
      .returning();
    created.employerIds.push(emp.id);

    const benefit = async (suffix: string) => {
      const [b] = await db
        .insert(trustBenefits)
        .values({ siriusId: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` })
        .returning();
      created.benefitIds.push(b.id);
      return b;
    };
    const ben3 = await benefit("3");
    const ben3e = await benefit("3E");
    const benD = await benefit("D");
    const benRx = await benefit("RX");
    const benMed = await benefit("MED");

    const mkWorker = async (given: string, ssn: string, gender?: undefined) => {
      const [c] = await db
        .insert(contacts)
        .values({
          given,
          family: TAG,
          displayName: `${given} ${TAG}`,
          middle: "Quincy",
          birthDate: "1980-03-05",
        })
        .returning();
      const [w] = await db
        .insert(workers)
        .values({ contactId: c.id, ssn })
        .returning();
      created.contactIds.push(c.id);
      created.workerIds.push(w.id);
      return w;
    };
    const sub = await mkWorker("Subby", "111223333");
    const spouse = await mkWorker("Spousey", "222334444");
    const qdep = await mkWorker("Quincy", "333445555");
    const enh = await mkWorker("Enhy", "444556666");

    const spId = await relationTypeId("SP", created.relTypeIds);
    const qmscoId = await relationTypeId("QMSCO", created.relTypeIds);
    const mkRel = async (worker2: string, relationType: string) => {
      const [r] = await db
        .insert(workerRelations)
        .values({ worker1: sub.id, worker2, relationType })
        .returning();
      created.relationIds.push(r.id);
      return r;
    };
    const relSp = await mkRel(spouse.id, spId);
    const relQ = await mkRel(qdep.id, qmscoId);

    const wmb = async (
      workerId: string,
      benefitId: string,
      sourceRelationId: string | null = null,
    ) => {
      const [row] = await db
        .insert(trustWmb)
        .values({
          workerId,
          employerId: emp.id,
          benefitId,
          year: YEAR,
          month: MONTH,
          sourceRelationId,
        })
        .returning();
      created.wmbIds.push(row.id);
      return row;
    };

    // Vision: sub (std) + both deps; enh worker on enhanced only.
    await wmb(sub.id, ben3.id);
    await wmb(spouse.id, ben3.id, relSp.id);
    await wmb(qdep.id, ben3.id, relQ.id);
    await wmb(enh.id, ben3e.id);
    // Dental + pharmacy: sub + both deps.
    await wmb(sub.id, benD.id);
    await wmb(spouse.id, benD.id, relSp.id);
    await wmb(qdep.id, benD.id, relQ.id);
    await wmb(sub.id, benRx.id);
    await wmb(spouse.id, benRx.id, relSp.id);
    await wmb(qdep.id, benRx.id, relQ.id);
    // Medical plan for the client-group lookup.
    await wmb(sub.id, benMed.id);

    const groupMap = { [`${TAG}-MED`]: "SMM00" };

    // --- VSP ---------------------------------------------------------------
    {
      const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-vsp")!;
      check("vsp: plugin registered", !!plugin);
      const ctx = mkCtx({ benefitSiriusIds: [`${TAG}-3`, `${TAG}-3E`] });
      const keys = (await plugin.getPrimaryKeys!(ctx)).filter((k) =>
        created.wmbIds.includes(k),
      );
      check("vsp: two subscriber units (std + enh)", keys.length === 2, keys.length);
      const rows = await plugin.processBatch(keys, ctx);
      check("vsp: MEM + 2 DEP + enh MEM rows", rows.length === 4, rows.length);
      const mem = rows.find((r) => r.recordId === "MEM" && r.memberName === `Subby ${TAG}`)!;
      const enhMem = rows.find((r) => r.recordId === "MEM" && r.memberName === `Enhy ${TAG}`)!;
      const depSp = rows.find((r) => r.recordId === "DEP" && r.memberName === `Spousey ${TAG}`)!;
      const depQ = rows.find((r) => r.recordId === "DEP" && r.memberName === `Quincy ${TAG}`)!;
      check("vsp: std division 1001", mem?.divisionCode === "1001", mem?.divisionCode);
      check("vsp: enhanced division 2001", enhMem?.divisionCode === "2001", enhMem?.divisionCode);
      check("vsp: subscriber family indicator A (2 deps)", mem?.familyIndicator === "A");
      check("vsp: enh subscriber family indicator C (0 deps)", enhMem?.familyIndicator === "C");
      check("vsp: spouse indicator S", depSp?.familyIndicator === "S");
      check("vsp: QMSCO dep indicator C", depQ?.familyIndicator === "C");
      check("vsp: dep carries subscriber + dependent SSN",
        depSp?.subscriberSsn === "111223333" && depSp?.dependentSsn === "222334444");
      const lines = assembleEdiFileLines(plugin, rows, ctx);
      check("vsp: no header/trailer (detail only)", lines.length === 4);
      check(
        `vsp: every line exactly ${VSP_RECORD_WIDTH} chars`,
        lines.every((l) => l.length === VSP_RECORD_WIDTH),
        lines.map((l) => l.length),
      );
      const memLine = plugin.encodeRow(mem, ctx);
      check("vsp: MEM line starts 'MEMR52638'", memLine.startsWith("MEMR52638"), memLine.slice(0, 12));
      check("vsp: filename shape", /^VSP_\d{8}\.txt$/.test(plugin.buildFilename(ctx)));
      // Pure mapping spot checks.
      check("vsp: division code matrix", vspDivisionCode(true, true) === "2002" && vspDivisionCode(false, true) === "1002");
      check("vsp: dep indicators", vspDependentFamilyIndicator("DP") === "P" && vspDependentFamilyIndicator("H") === "H");
      check("vsp: sub indicator 1 dep = B", vspSubscriberFamilyIndicator(1) === "B");
    }

    // --- Delta -------------------------------------------------------------
    {
      const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-delta")!;
      check("delta: plugin registered", !!plugin);
      const ctx = mkCtx(
        { benefitSiriusId: `${TAG}-D`, medicalPlanGroupMap: groupMap },
        { mode: "T" },
      );
      const keys = (await plugin.getPrimaryKeys!(ctx)).filter((k) =>
        created.wmbIds.includes(k),
      );
      check("delta: one subscriber unit", keys.length === 1, keys.length);
      const rows = await plugin.processBatch(keys, ctx);
      check("delta: 1 subscriber + 2 dependent rows", rows.length === 3, rows.length);
      const subRow = rows.find((r) => r.memberName === `Subby ${TAG}`)!;
      const spRow = rows.find((r) => r.memberName === `Spousey ${TAG}`)!;
      const qRow = rows.find((r) => r.memberName === `Quincy ${TAG}`)!;
      check("delta: subscriber classification 10", subRow?.memberClassification === "10");
      check("delta: spouse classification 20", spRow?.memberClassification === "20");
      check("delta: QMSCO classification 13", qRow?.memberClassification === "13");
      check("delta: division 00002 (non-COBRA)", subRow?.divisionId === "00002");
      check("delta: client group id from medical plan", rows.every((r) => r.clientGroupId === "SMM00"));
      const lines = assembleEdiFileLines(plugin, rows, ctx);
      check("delta: header + 3 details + trailer", lines.length === 5, lines.length);
      check(
        "delta: all lines 2000 chars",
        lines.every((l) => l.length === 2000) &&
          DELTA_RECORD_WIDTH === 2000 &&
          DELTA_HEADER_WIDTH === 2000 &&
          DELTA_TRAILER_WIDTH === 2000,
        lines.map((l) => l.length),
      );
      const header = lines[0];
      check("delta: header record type/group", header.startsWith("1017975"), header.slice(0, 12));
      check("delta: header reporting date + mode", header.includes("20260715") && header[20] === "T", header.slice(0, 30));
      const trailer = lines[4];
      check("delta: trailer '90' with count 5 (3 details + 2)", trailer.startsWith("905"), trailer.slice(0, 10));
      check("delta: detail record type 30 + group", lines[1].startsWith("3017975"));
      check("delta: filename shape", /^DELTA_\d{8}\.txt$/.test(plugin.buildFilename(ctx)));
      check("delta: classification map extras", deltaMemberClassification("DP") === "21" && deltaMemberClassification("G") === "40");
    }

    // --- Express Scripts ----------------------------------------------------
    {
      const plugin = trustProviderEdiPluginRegistry.get("sitespecific-smf-expressscripts")!;
      check("esi: plugin registered", !!plugin);
      const ctx = mkCtx(
        { benefitSiriusId: `${TAG}-RX`, medicalPlanGroupMap: groupMap },
        { mode: "P", qmsco: "exclude" },
      );
      const keys = (await plugin.getPrimaryKeys!(ctx)).filter((k) =>
        created.wmbIds.includes(k),
      );
      check("esi: one subscriber unit", keys.length === 1, keys.length);
      const rows = await plugin.processBatch(keys, ctx);
      check("esi: QMSCO excluded → subscriber + spouse only", rows.length === 2, rows.length);
      const subRow = rows.find((r) => r.memberName === `Subby ${TAG}`)!;
      const spRow = rows.find((r) => r.memberName === `Spousey ${TAG}`)!;
      check("esi: subscriber relationship 1", subRow?.relationshipCode === "1");
      check("esi: spouse relationship 2", spRow?.relationshipCode === "2");
      check("esi: contract type AC (non-COBRA)", subRow?.contractType === "AC");
      check("esi: client group id from medical plan", rows.every((r) => r.clientGroupId === "SMM00"));
      const lines = assembleEdiFileLines(plugin, rows, ctx);
      check("esi: header + 2 details + trailer", lines.length === 4, lines.length);
      check(
        "esi: all lines at layout width",
        lines[0].length === ESI_HEADER_WIDTH &&
          lines[3].length === ESI_TRAILER_WIDTH &&
          lines.slice(1, 3).every((l) => l.length === ESI_RECORD_WIDTH),
        { h: lines[0].length, d: lines[1].length, t: lines[3].length },
      );
      const header = lines[0];
      check("esi: header 'H' + truncated client id 'K7G'", header.startsWith("HK7GUNITE HERE"), header.slice(0, 20));
      check("esi: header dates + mode P", header.slice(64, 72) === "20260715" && header[88] === "P", header.slice(60, 92));
      const trailer = lines[3];
      check("esi: trailer 'TK7G' with count 4 (2 details + 2)", trailer.startsWith("TK7G4"), trailer.slice(0, 12));
      check("esi: detail 'M' + client id", lines[1].startsWith("MK7G"));
      // QMSCO-only feed.
      const qCtx = mkCtx(
        { benefitSiriusId: `${TAG}-RX`, medicalPlanGroupMap: groupMap },
        { qmsco: "include" },
      );
      const qRows = await plugin.processBatch(keys, qCtx);
      check("esi: QMSCO-only feed emits only QMSCO dep", qRows.length === 1 && qRows[0].memberName === `Quincy ${TAG}`, qRows.length);
      check("esi: QMSCO member level address type C", qRows[0]?.memberLevelAddressType === "C");
      check("esi: filename shape", /^ESI_\d{8}\.txt$/.test(plugin.buildFilename(ctx)));
      check("esi: relationship map extras", esiRelationshipCode("DP") === "7" && esiRelationshipCode("C") === "3" && esiRelationshipCode("H") === "5");
    }
  } finally {
    if (created.wmbIds.length)
      await db.delete(trustWmb).where(inArray(trustWmb.id, created.wmbIds));
    if (created.relationIds.length)
      await db.delete(workerRelations).where(inArray(workerRelations.id, created.relationIds));
    if (created.workerIds.length)
      await db.delete(workers).where(inArray(workers.id, created.workerIds));
    if (created.contactIds.length)
      await db.delete(contacts).where(inArray(contacts.id, created.contactIds));
    if (created.relTypeIds.length)
      await db
        .delete(optionsWorkerRelationType)
        .where(inArray(optionsWorkerRelationType.id, created.relTypeIds));
    if (created.benefitIds.length)
      await db.delete(trustBenefits).where(inArray(trustBenefits.id, created.benefitIds));
    if (created.employerIds.length)
      await db.delete(employers).where(inArray(employers.id, created.employerIds));
  }

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
