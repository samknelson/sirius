import { and, eq, inArray } from "drizzle-orm";
import {
  trustWmb,
  trustBenefits,
  optionsTrustBenefitType,
} from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";
import {
  type EdiCsvField,
  encodeCsvRow,
  str,
  ymdCompact,
  padSsn,
  phoneDigits,
  readAsOfYmd,
  buildMemberUnits,
  displayName,
  type EdiPerson,
} from "../base";

/**
 * SMF — Carelon EAP eligibility CSV.
 *
 * Port of the legacy PHP generator (Sirius_Smf_Report_Edi_Carelon): a CSV
 * WITHOUT a header row — one row per subscriber and covered dependent —
 * for every worker holding a monthly benefit record (trust_wmb) for the
 * configured benefit in the as-of month.
 *
 * Legacy notes carried over:
 *  - MEMBNO is always the SUBSCRIBER's SSN; SOCSEC the member's own.
 *  - Address falls back to the subscriber's when ADRLN1 is blank; quote
 *    characters are stripped from address lines.
 *  - GRPNUM/BENPKG carry the member's MEDICAL coverage benefit Sirius ID
 *    as of the run date; the premium tier is `mlk` when that medical
 *    coverage is MLK ("M"), else `other` (subscribers only).
 *  - TIERCD is the family-composition indicator (FMLY/SEMP/AEMP/EEMP),
 *    blank on dependent rows.
 */

const CSV_FIELDS: EdiCsvField[] = [
  { name: "MEMBNO", get: (r) => str(r.subscriberSsn) },
  { name: "SOCSEC", get: (r) => str(r.memberSsn) },
  { name: "LSTNAM", get: (r) => str(r.lastName) },
  { name: "FSTNAM", get: (r) => str(r.firstName) },
  { name: "MIDNAM", get: (r) => str(r.middleInitial) },
  { name: "ADRLN1", get: (r) => str(r.address1) },
  { name: "ADRLN2", get: () => "" },
  { name: "CITYCD", get: (r) => str(r.city) },
  { name: "STACOD", get: (r) => str(r.state) },
  { name: "ZIPCOD", get: (r) => str(r.zip) },
  { name: "HOMPHN", get: (r) => str(r.phone) },
  { name: "WRKPHN", get: () => "" },
  { name: "BTHDAT", get: (r) => str(r.birthDate) },
  { name: "RELCOD", get: (r) => str(r.relCode) },
  { name: "SEXCOD", get: (r) => str(r.sex) },
  { name: "GRPEFF", get: (r) => str(r.coverageStart) },
  { name: "GRPEXP", get: (r) => str(r.coverageEnd) },
  { name: "GRPNUM", get: (r) => str(r.grpNum) },
  { name: "BENPKG", get: (r) => str(r.grpNum) },
  { name: "TIERCD", get: (r) => str(r.tierCode) },
  { name: "MSTACD", get: (r) => str(r.memberStatus) },
  { name: "ALTNUM", get: () => "" },
  { name: "CLIDEF", get: () => "" },
];

/** Exported for the smoke test. */
export const CARELON_CSV_FIELDS = CSV_FIELDS;

/**
 * Relation-type sirius id → Carelon relationship code (01 self / 02 spouse /
 * 03 child). S1-taxonomy ruling (2026-08-05): RP is a QMSCO-variant child →
 * 03; EX (Ex Spouse) is NEVER spouse-like — it emits blank so a covered
 * ex-spouse is visible in carrier-file QA instead of masquerading as self
 * (legacy fell through to 01) or spouse.
 */
export function carelonRelCode(relationSiriusId: string | null): string {
  if (relationSiriusId && ["SP", "DP"].includes(relationSiriusId)) return "02";
  if (
    relationSiriusId &&
    ["C", "AC", "H", "QMSCO", "RP", "SC", "G"].includes(relationSiriusId)
  )
    return "03";
  if (relationSiriusId === "EX") return "";
  return "01";
}

/** Gender option code → M/F/U (unknown/blank → U, like legacy). */
export function carelonSex(code: string | null): string {
  return code === "M" || code === "F" ? code : "U";
}

/**
 * Legacy `tiercd`: family-composition indicator from the subscriber's
 * covered dependents' relation types (blank for dependents themselves).
 */
export function carelonTierCode(
  relationSiriusIds: ReadonlyArray<string | null>,
): string {
  let hasSpouse = false;
  let hasChild = false;
  for (const id of relationSiriusIds) {
    // S1-taxonomy ruling (2026-08-05): "ES" retired — an ex-spouse (now
    // "EX") never counts as a spouse for the family-composition tier.
    // G (Guardian/Protected Person) stays OUT of the child family here
    // (legacy parity — it is a relCode 03 child but not a tier child).
    if (id && ["DP", "SP"].includes(id)) hasSpouse = true;
    if (id && ["C", "AC", "H", "QMSCO", "RP", "SC"].includes(id)) hasChild = true;
  }
  if (hasSpouse && hasChild) return "FMLY";
  if (hasSpouse) return "SEMP";
  if (hasChild) return "AEMP";
  return "EEMP";
}

/** Strip quote characters from an address value (legacy sanitization intent). */
export function stripQuotes(v: unknown): string {
  return str(v).replace(/['"]/g, "");
}

/** Legacy address handling: worker's own; whole block falls back when ADRLN1 blank. */
export function carelonAddressFields(
  member: EdiPerson,
  subscriber: EdiPerson,
): { address1: string; city: string; state: string; zip: string } {
  const zip5 = (p: EdiPerson) =>
    String(p.postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  const src = stripQuotes(member.postal?.street) ? member : subscriber;
  return {
    address1: stripQuotes(src.postal?.street),
    city: stripQuotes(src.postal?.city),
    state: str(src.postal?.state),
    zip: zip5(src),
  };
}

interface CarelonConfigData {
  mlkBenefitSiriusId?: string;
  medicalBenefitTypeName?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<CarelonConfigData> {
  const d = (ctx.configData ?? {}) as CarelonConfigData;
  return {
    mlkBenefitSiriusId: d.mlkBenefitSiriusId || "M",
    medicalBenefitTypeName: d.medicalBenefitTypeName || "Medical",
  };
}

/**
 * Medical coverage as of the run date: for each worker, the Sirius ID of
 * the benefit of type "Medical" they hold a monthly benefit record for in
 * the as-of month (lowest wmb id wins deterministically on ties).
 */
export async function medicalCoverageByWorker(
  workerIds: readonly string[],
  ctx: TrustProviderEdiContext,
  medicalTypeName: string,
): Promise<Map<string, string>> {
  if (!workerIds.length) return new Map();
  const asOfYmd = readAsOfYmd(ctx);
  const year = Number(asOfYmd.slice(0, 4));
  const month = Number(asOfYmd.slice(5, 7));
  const rows = await ctx.storage.readOnly.query(async (db) =>
    db
      .select({
        wmbId: trustWmb.id,
        workerId: trustWmb.workerId,
        benefitSiriusId: trustBenefits.siriusId,
      })
      .from(trustWmb)
      .innerJoin(trustBenefits, eq(trustWmb.benefitId, trustBenefits.id))
      .innerJoin(
        optionsTrustBenefitType,
        eq(trustBenefits.benefitType, optionsTrustBenefitType.id),
      )
      .where(
        and(
          inArray(trustWmb.workerId, [...workerIds]),
          eq(trustWmb.year, year),
          eq(trustWmb.month, month),
          eq(optionsTrustBenefitType.name, medicalTypeName),
        ),
      ),
  );
  rows.sort((a, b) => (a.wmbId < b.wmbId ? -1 : 1));
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!out.has(r.workerId) && r.benefitSiriusId) {
      out.set(r.workerId, r.benefitSiriusId);
    }
  }
  return out;
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-carelon",
  name: "SMF - Carelon EAP Eligibility File",
  description:
    "Headerless CSV Carelon EAP eligibility file: one row per subscriber and " +
    "covered dependent with a Carelon monthly benefit record in the as-of " +
    "month; premium tier is mlk/other from the member's medical coverage.",
  benefitSiriusIds: ["CARELONEAP"],
  outputFormat: "csv",
  // Legacy `edi_csv_hide_header`: the delivered file has no header row.
  csvIncludeHeaderRow: false,
  configSchema: {
    type: "object",
    properties: {
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "CARELONEAP",
        description:
          "Sirius ID of the trust benefit whose monthly benefit records populate the file.",
      },
      mlkBenefitSiriusId: {
        type: "string",
        title: "MLK Medical Benefit Sirius ID",
        default: "M",
        description:
          "Members whose medical coverage is this benefit get the 'mlk' premium tier; all others get 'other'.",
      },
      medicalBenefitTypeName: {
        type: "string",
        title: "Medical Benefit Type Name",
        default: "Medical",
        description:
          "Name of the trust benefit type that counts as medical coverage.",
      },
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      asOfDate: {
        type: "string",
        format: "date",
        title: "As-of Date",
        description:
          "Include workers with a monthly benefit record in this date's month (defaults to today).",
      },
    },
  },
  getColumns() {
    return [
      { id: "relCode", header: "Rel Code", type: "string", width: 80 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "DOB", type: "string", width: 100 },
      { id: "sex", header: "Sex", type: "string", width: 60 },
      { id: "grpNum", header: "Medical Coverage", type: "string", width: 130 },
      { id: "premiumTier", header: "Premium Tier", type: "string", width: 110 },
      { id: "tierCode", header: "Tier", type: "string", width: 70 },
      { id: "memberStatus", header: "Status", type: "string", width: 70 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "coverageEnd", header: "Coverage End", type: "string", width: 110 },
    ];
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const units = await buildMemberUnits(keys, ctx);
    const medicalBySubscriber = await medicalCoverageByWorker(
      units.map((u) => u.wmb.workerId),
      ctx,
      cfg.medicalBenefitTypeName,
    );
    const out: Array<Record<string, unknown>> = [];
    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const medicalCoverageId = medicalBySubscriber.get(wmb.workerId) ?? "";
      const premiumTier =
        medicalCoverageId === cfg.mlkBenefitSiriusId ? "mlk" : "other";
      const shared = {
        subscriberSsn: padSsn(subscriber.ssn),
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(unit.coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open (blank).
        coverageEnd: "",
        grpNum: medicalCoverageId,
        memberStatus: unit.isCobra ? "C" : "A",
        premiumTier,
      };
      out.push({
        pk: wmb.id,
        ...shared,
        relCode: "01",
        memberName: displayName(subscriber),
        memberSsn: padSsn(subscriber.ssn),
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleInitial: (subscriber.middleName ?? "").slice(0, 1),
        birthDate: ymdCompact(subscriber.birthDate),
        sex: carelonSex(subscriber.genderCode),
        phone: phoneDigits(subscriber.phoneNumber),
        tierCode: carelonTierCode(
          unit.dependents.map((d) => d.relationSiriusId),
        ),
        ...carelonAddressFields(subscriber, subscriber),
      });
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          relCode: carelonRelCode(dep.relationSiriusId),
          memberName: displayName(dep),
          memberSsn: padSsn(dep.ssn),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleInitial: (dep.middleName ?? "").slice(0, 1),
          birthDate: ymdCompact(dep.birthDate),
          sex: carelonSex(dep.genderCode),
          phone: phoneDigits(dep.phoneNumber),
          // Legacy: TIERCD is blank on dependent rows.
          tierCode: "",
          ...carelonAddressFields(dep, subscriber),
        });
      }
    }
    return out;
  },

  encodeRow(row) {
    return encodeCsvRow(CSV_FIELDS, row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `CARELON_${stamp}.csv`;
  },
});
