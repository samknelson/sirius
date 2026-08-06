import { asc, eq } from "drizzle-orm";
import { workerHours } from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";
import {
  type EdiField,
  encodeFixedWidthRow,
  str,
  ymdCompact,
  padSsn,
  phoneDigits,
  readAsOfYmd,
  buildMemberUnits,
  displayName,
  postalFields,
  isQmscoRelation,
} from "../base";

/**
 * BAO — HealthNet eligibility EDI file.
 *
 * Port of the legacy PHP generator's record encoding
 * (Sirius_Smf_Report_Edi_Healthnet). Produces a fixed-width file with one
 * record per member — the subscriber ("M") and each covered dependent
 * ("P"/"D"/"S"/"Q") get their own row in the same 54-field layout — for
 * every worker who holds a monthly benefit record (trust_wmb) for the
 * configured benefit in the as-of month (membership/dependent assembly
 * comes from the shared EDI base).
 *
 * Fixed-width layout: `EDI_FIELDS` below defines every output field in
 * order with its exact width. A row is the concatenation of each field
 * value left-justified and space-padded to its width.
 */

// Exact port of the legacy PHP `edi_fields()` layout (field order and
// widths). Fields with no `get` emit spaces.
const EDI_FIELDS: EdiField[] = [
  { name: "Health Net Group Number", width: 6, get: (r) => str(r.groupNumber) },
  { name: "Reserved 1", width: 2 },
  { name: "File Date", width: 8, get: (r) => str(r.fileDate) },
  { name: "Transaction Type (Activity Flag)", width: 1 },
  { name: "Coverage Begin Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "Subscriber SSN", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "Dependent SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "Member Type", width: 1, get: (r) => str(r.memberType) },
  { name: "Reserved 2", width: 3 },
  { name: "Last Name & Suffix", width: 17, get: (r) => str(r.lastName) },
  { name: "First Name", width: 10, get: (r) => str(r.firstName) },
  { name: "Middle Initial", width: 1, get: (r) => str(r.middleInitial) },
  { name: "Gender", width: 1, get: (r) => str(r.gender) },
  { name: "Date of Birth", width: 8, get: (r) => str(r.birthDate) },
  { name: "Address Line 1", width: 25, get: (r) => str(r.street) },
  { name: "Address Line 2", width: 25 },
  { name: "City", width: 17, get: (r) => str(r.city) },
  { name: "State", width: 2, get: (r) => str(r.state) },
  { name: "Zip Code", width: 5, get: (r) => str(r.zip) },
  { name: "Zip Code +4 Extension", width: 4 },
  { name: "Work Telephone", width: 10, get: (r) => str(r.phone) },
  { name: "Residence Telephone", width: 10 },
  { name: "Provider ID", width: 4 },
  { name: "Physician Last Name", width: 20 },
  { name: "Physician First Name", width: 20 },
  { name: "Physician Middle Initial", width: 1 },
  { name: "4-Digit PPG ID", width: 4 },
  { name: "6-Digit PCP ID", width: 6 },
  { name: "Current Patient Indicator", width: 1 },
  { name: "Hire Date", width: 8, get: (r) => str(r.hireDate) },
  { name: "Employee Number", width: 6 },
  { name: "Department", width: 6 },
  { name: "COBRA End Date", width: 6 },
  { name: "Pay Status Code", width: 2, get: (r) => str(r.payStatusCode) },
  { name: "Contract Type", width: 1, get: (r) => str(r.contractType) },
  { name: "Number Covered", width: 2, get: (r) => str(r.numberCovered) },
  { name: "Coverage End Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "Foreign Address Flag", width: 1 },
  { name: "Correspondence Indicator", width: 3 },
  { name: "Ethnicity Indicator", width: 3 },
  { name: "Student Indicator", width: 1 },
  { name: "Medicare Part A Indicator", width: 1 },
  { name: "Medicare Part B Indicator", width: 1 },
  { name: "Medicare Parts A & B Indicator", width: 1 },
  { name: "Medicare Part D Indicator", width: 1 },
  { name: "Disabled Indicator", width: 1 },
  { name: "Filler 1", width: 13 },
  {
    name: "Health Insurance Claim Number (for Medicare COB)",
    width: 13,
  },
  { name: "Coordination of Benefits", width: 1 },
  { name: "Insurance Line Code", width: 3, get: () => "HMO" },
  { name: "Current Premium Amount", width: 8 },
  { name: "Retroactive Debit Amount", width: 8 },
  { name: "Retroactive Credit Amount", width: 8 },
  { name: "Record End Designator", width: 5, get: () => "HNPES" },
];

/** Encode one persisted row as a fixed-width HealthNet record (exported for the format check script). */
export function encodeHealthnetRow(row: Record<string, unknown>): string {
  return encodeFixedWidthRow(EDI_FIELDS, row);
}

/** Exported for the format check script. */
export const HEALTHNET_EDI_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  EDI_FIELDS.map((f) => ({ name: f.name, width: f.width }));

/**
 * Relation-type sirius id → HealthNet member type. Legacy comment:
 * M = Self (subscriber), P = Domestic Partner, S = Spouse, Q = QMSCO,
 * D = child of any other flavor. Unknown types fall back to M like the
 * legacy generator did.
 * S1-taxonomy rulings (2026-08-05): RP (QMSCO variant) → Q like QMSCO;
 * EX (Ex Spouse, retired "ES") is NEVER spouse-like or self — it emits
 * blank so a covered ex-spouse surfaces as a data error, not an enrollee.
 */
export function memberType(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "M";
  if (relationSiriusId === "DP") return "P";
  if (["C", "AC", "H", "SC", "G"].includes(relationSiriusId)) return "D";
  if (relationSiriusId === "SP") return "S";
  if (isQmscoRelation(relationSiriusId)) return "Q";
  if (relationSiriusId === "EX") return "";
  return "M";
}

/** Gender option code → HealthNet gender (F/M; unknown defaults to F like legacy). */
function genderCode(code: string | null): string {
  return code === "M" ? "M" : "F";
}

interface HealthnetConfigData {
  groupNumber?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<HealthnetConfigData> {
  const d = (ctx.configData ?? {}) as HealthnetConfigData;
  return {
    groupNumber: d.groupNumber || "LB391A",
  };
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-bao-healthnet",
  name: "BAO - HealthNet Eligibility File",
  description:
    "Fixed-width HealthNet eligibility file: one record per member (subscriber " +
    "plus each covered dependent) with a HealthNet monthly benefit record in the as-of month.",
  requiredComponent: "sitespecific.bao",
  // Default membership: wmb rows for these benefits in the as-of month
  // (config-level benefitSiriusId still overrides per config).
  benefitSiriusIds: ["H"],
  configSchema: {
    type: "object",
    properties: {
      groupNumber: {
        type: "string",
        title: "Group Number",
        default: "LB391A",
        description: "HealthNet group number placed at the start of every record.",
      },
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "H",
        description:
          "Sirius ID of the trust benefit whose monthly benefit records populate the file.",
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
      { id: "memberType", header: "Member Type", type: "string", width: 100 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "gender", header: "Gender", type: "string", width: 80 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "payStatusCode", header: "Pay Status", type: "string", width: 90 },
      { id: "contractType", header: "Contract Type", type: "string", width: 100 },
      { id: "numberCovered", header: "Covered", type: "string", width: 80 },
      { id: "hireDate", header: "Hire Date", type: "string", width: 100 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const asOfYmd = readAsOfYmd(ctx);
    // Legacy: File Date is always the file creation date.
    const fileDate = ymdCompact(new Date().toISOString().slice(0, 10));
    const units = await buildMemberUnits(keys, ctx);
    const out: Array<Record<string, unknown>> = [];

    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const subscriberSsn = padSsn(subscriber.ssn);
      const subscriberName = displayName(subscriber);
      const coverageStartYmd = unit.coverageStartYmd;

      // Hire date (subscriber only, requires an employer on the record):
      // legacy takes the MIN of the as-of date, the worker's first hours
      // month, and the coverage begin/end dates.
      let hireDate = "";
      if (wmb.employerId) {
        const candidates = [asOfYmd, coverageStartYmd];
        const [firstHours] = await ctx.storage.readOnly.query(async (db) =>
          db
            .select({ year: workerHours.year, month: workerHours.month })
            .from(workerHours)
            .where(eq(workerHours.workerId, wmb.workerId))
            .orderBy(asc(workerHours.year), asc(workerHours.month))
            .limit(1),
        );
        if (firstHours) {
          candidates.push(
            `${String(firstHours.year).padStart(4, "0")}-${String(firstHours.month).padStart(2, "0")}-01`,
          );
        }
        candidates.sort();
        hireDate = ymdCompact(candidates[0]);
      }

      const deps = unit.dependents;
      const contractType = deps.length === 0 ? "1" : deps.length === 1 ? "2" : "3";
      const numberCovered = String(deps.length + 1);
      const payStatusCode = unit.isCobra ? "CO" : "AC";

      const shared = {
        groupNumber: cfg.groupNumber,
        fileDate,
        subscriberSsn,
        subscriberName,
        coverageStart: ymdCompact(coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open (blank).
        coverageEnd: "",
      };

      // Subscriber record ("M").
      out.push({
        pk: wmb.id,
        ...shared,
        memberType: "M",
        memberSsn: subscriberSsn,
        memberName: subscriberName,
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleInitial: (subscriber.middleName ?? "").slice(0, 1),
        gender: genderCode(subscriber.genderCode),
        birthDate: ymdCompact(subscriber.birthDate),
        ...postalFields(subscriber.postal),
        phone: phoneDigits(subscriber.phoneNumber),
        hireDate,
        payStatusCode,
        contractType,
        numberCovered,
      });

      // Dependent records — same layout; subscriber-only fields blank.
      // Dependents carry their own address (legacy reads the member's
      // record); phone/hire/pay-status/contract/covered are blank.
      for (const dep of deps) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memberType: memberType(dep.relationSiriusId),
          memberSsn: padSsn(dep.ssn),
          memberName: displayName(dep),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleInitial: (dep.middleName ?? "").slice(0, 1),
          gender: genderCode(dep.genderCode),
          birthDate: ymdCompact(dep.birthDate),
          ...postalFields(dep.postal),
          phone: "",
          hireDate: "",
          payStatusCode: "",
          contractType: "",
          numberCovered: "",
        });
      }
    }
    return out;
  },

  encodeRow(row) {
    return encodeHealthnetRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `HEALTHNET_${stamp}.txt`;
  },
});
