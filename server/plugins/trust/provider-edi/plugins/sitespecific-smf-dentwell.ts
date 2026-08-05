import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";
import {
  type EdiCsvField,
  encodeCsvRow,
  encodeCsvHeaderRow,
  csvEscape,
  str,
  ymdCompact,
  padSsn,
  phoneDigits,
  readAsOfYmd,
  buildMemberUnits,
  displayName,
} from "../base";

/**
 * SMF — Dentwell (LA Dental Center) eligibility CSV.
 *
 * Port of the legacy PHP generator (Sirius_Smf_Report_Edi_Dentwell): a CSV
 * with a header row plus file-level header ("H") and trailer ("T") records —
 * one "E" detail row per subscriber and covered dependent for every worker
 * holding a monthly benefit record (trust_wmb) for the configured benefit in
 * the as-of month.
 *
 * Legacy notes carried over:
 *  - SubscriberNumber is always the SUBSCRIBER's SSN.
 *  - Members carry their OWN address/phone/email (no subscriber fallback).
 *  - Header record: H,<group id (blank)>,<as-of date YYYYMMDD>.
 *  - Trailer record: T,<subscriber count>,<dependent count>.
 */

const CSV_FIELDS: EdiCsvField[] = [
  { name: "Record Type", get: () => "E" },
  { name: "SubscriberNumber", get: (r) => str(r.subscriberSsn) },
  { name: "MemberType", get: (r) => str(r.memberType) },
  { name: "EffectiveDate", get: (r) => str(r.coverageStart) },
  { name: "TerminationDate", get: (r) => str(r.coverageEnd) },
  { name: "Status", get: () => "" },
  { name: "LastName", get: (r) => str(r.lastName) },
  { name: "FirstName", get: (r) => str(r.firstName) },
  { name: "MiddleName", get: (r) => str(r.middleName) },
  { name: "DateOfBirth", get: (r) => str(r.birthDate) },
  { name: "Address1", get: (r) => str(r.street) },
  { name: "Address2", get: () => "" },
  { name: "City", get: (r) => str(r.city) },
  { name: "State", get: (r) => str(r.state) },
  { name: "Zip", get: (r) => str(r.zip) },
  { name: "HomePhone", get: (r) => str(r.phone) },
  { name: "Email", get: (r) => str(r.email) },
  { name: "Gender", get: (r) => str(r.gender) },
  { name: "RelationshipCode", get: (r) => str(r.relationshipCode) },
];

/** Exported for the smoke test. */
export const DENTWELL_CSV_FIELDS = CSV_FIELDS;

/**
 * Relation-type sirius id → Dentwell relationship code. Legacy comment:
 * 18 = Self, 01 = Spouse/Domestic Partner, 19 = child of any flavor,
 * 08 = QMSCO child. Unknown types emit blank like the legacy generator.
 */
export function dentwellRelationshipCode(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "18";
  if (["C", "G", "AC", "H"].includes(relationSiriusId)) return "19";
  if (["SP", "DP"].includes(relationSiriusId)) return "01";
  if (relationSiriusId === "QMSCO") return "08";
  return "";
}

/** Gender option code → M/F/U (legacy: blank stays blank). */
export function dentwellGender(code: string | null): string {
  if (!code) return "";
  return code === "M" || code === "F" ? code : "U";
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-dentwell",
  name: "SMF - Dentwell Eligibility File",
  description:
    "CSV Dentwell dental eligibility file with H/T header and trailer " +
    "records: one row per subscriber and covered dependent with a Dentwell " +
    "monthly benefit record in the as-of month.",
  benefitSiriusIds: ["LADC"],
  outputFormat: "csv",
  configSchema: {
    type: "object",
    properties: {
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "LADC",
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
      { id: "subscriberSsn", header: "Subscriber SSN", type: "string", width: 120 },
      { id: "relationshipCode", header: "Rel Code", type: "string", width: 80 },
      { id: "birthDate", header: "DOB", type: "string", width: 100 },
      { id: "gender", header: "Gender", type: "string", width: 70 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "coverageEnd", header: "Coverage End", type: "string", width: 110 },
    ];
  },

  async processBatch(keys, ctx) {
    const units = await buildMemberUnits(keys, ctx);
    const out: Array<Record<string, unknown>> = [];
    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const shared = {
        subscriberSsn: padSsn(subscriber.ssn),
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(unit.coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open (blank).
        coverageEnd: "",
      };
      const person = (p: typeof subscriber | (typeof unit.dependents)[number]) => ({
        memberName: displayName(p),
        lastName: p.familyName ?? "",
        firstName: p.givenName ?? "",
        middleName: p.middleName ?? "",
        birthDate: ymdCompact(p.birthDate),
        street: p.postal?.street ?? "",
        city: p.postal?.city ?? "",
        state: p.postal?.state ?? "",
        zip: String(p.postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
        phone: phoneDigits(p.phoneNumber),
        email: p.email ?? "",
        gender: dentwellGender(p.genderCode),
      });
      out.push({
        pk: wmb.id,
        ...shared,
        memberType: "SUB",
        relationshipCode: "18",
        ...person(subscriber),
      });
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memberType: "DEP",
          relationshipCode: dentwellRelationshipCode(dep.relationSiriusId),
          ...person(dep),
        });
      }
    }
    return out;
  },

  encodeCsvHeaderRow() {
    return encodeCsvHeaderRow(CSV_FIELDS);
  },

  // Legacy "H" header record: H,<group id (blank)>,<as-of date YYYYMMDD>.
  encodeFileHeader(ctx: TrustProviderEdiContext) {
    return ["H", "", ymdCompact(readAsOfYmd(ctx))].map(csvEscape).join(",");
  },

  // Legacy "T" trailer record: T,<subscriber count>,<dependent count>.
  encodeFileTrailer(_ctx, aggregates) {
    let subs = 0;
    let deps = 0;
    for (const row of aggregates.detailRows) {
      if (row.memberType === "SUB") subs++;
      else deps++;
    }
    return ["T", String(subs), String(deps)].map(csvEscape).join(",");
  },

  encodeRow(row) {
    return encodeCsvRow(CSV_FIELDS, row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `DENTWELL_${stamp}.csv`;
  },
});
