import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
  type EdiBatchAggregates,
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
} from "../base";
import { clientGroupIdsByWorker, readModeIndicator } from "./sitespecific-smf-shared";

/**
 * SMF — Delta Dental eligibility EDI file.
 *
 * Port of the legacy `edi_delta.inc`. Fixed-width, 2000-character records:
 * a "10" header record (group ID, reporting/as-of date, production/test
 * indicator, file-create date), one "30" detail record per subscriber and
 * covered dependent, and a "90" trailer whose record count is the number
 * of detail records + 2 (header + trailer), matching the legacy count.
 *
 * The medical-plan-derived client group ID (MLK → SMM00, HealthNet →
 * SMH00, Kaiser → SMK00) is computed per subscriber and carried on each
 * row for the preview/report; as in the legacy layout it is not part of
 * the fixed-width detail record itself.
 *
 * QMSCO responsible-party ("Contact ...") fields have no source in the
 * current model and emit spaces.
 */

const GROUP_ID = "17975";

const HEADER_FIELDS: EdiField[] = [
  { name: "Record Type", width: 2, get: () => "10" },
  { name: "Group ID", width: 5, get: (r) => str(r.groupId) },
  { name: "Division ID", width: 5 },
  { name: "Reporting Date", width: 8, get: (r) => str(r.reportingDate) },
  { name: "File Type", width: 1, get: (r) => str(r.fileType) },
  { name: "Report Set ID", width: 12 },
  { name: "File create date", width: 8, get: (r) => str(r.fileCreateDate) },
  { name: "File create time", width: 6 },
  { name: "Filler", width: 1953 },
];

const TRAILER_FIELDS: EdiField[] = [
  { name: "Record Type", width: 2, get: () => "90" },
  { name: "Record Count", width: 7, get: (r) => str(r.recordCount) },
  { name: "Filler", width: 1991 },
];

// Exact port of the legacy detail `edi_fields()` layout (order and widths).
const DETAIL_FIELDS: EdiField[] = [
  { name: "Record Type", width: 2, get: () => "30" },
  { name: "Group ID", width: 5, get: (r) => str(r.groupId) },
  { name: "Division ID", width: 5, get: (r) => str(r.divisionId) },
  { name: "Employer Reference ID", width: 12 },
  { name: "Employment Class", width: 4 },
  { name: "Incentive Start Date", width: 8 },
  { name: "Waiting Period Start Date", width: 8 },
  { name: "Primary Subscriber ID", width: 16, get: (r) => str(r.subscriberSsn) },
  { name: "Subscriber Alternate ID", width: 16 },
  { name: "Case ID", width: 16 },
  { name: "Member SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "Member Last Name", width: 35, get: (r) => str(r.lastName) },
  { name: "Member First Name", width: 25, get: (r) => str(r.firstName) },
  { name: "Member Middle Name", width: 25, get: (r) => str(r.middleName) },
  { name: "Member Name Suffix", width: 10 },
  { name: "Gender", width: 1, get: (r) => str(r.gender) },
  { name: "Date of Birth", width: 8, get: (r) => str(r.birthDate) },
  { name: "Ethnicity Code", width: 4 },
  { name: "Language Code", width: 2 },
  { name: "Medicare Indicator", width: 1 },
  { name: "Member Classification", width: 4, get: (r) => str(r.memberClassification) },
  { name: "Business Level 4", width: 12 },
  { name: "Business Level 5", width: 12 },
  { name: "Business Level 6", width: 12 },
  { name: "Business Level 7", width: 12 },
  { name: "Benefit Package ID", width: 8 },
  { name: "Benefit Package Effective Date", width: 8 },
  { name: "Benefit Package Termination Date", width: 8 },
  { name: "Eligibility Effective Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "Eligibility Termination Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "Mailing Address 1", width: 55, get: (r) => str(r.street) },
  { name: "Mailing Address 2", width: 55 },
  { name: "Mailing Address 3", width: 55 },
  { name: "Mailing Address City", width: 30, get: (r) => str(r.city) },
  { name: "Mailing Address State", width: 2, get: (r) => str(r.state) },
  { name: "Mailing Address Zip Code", width: 15, get: (r) => str(r.zip) },
  { name: "Mailing Address Country", width: 3 },
  { name: "Service Area", width: 2 },
  { name: "Residence Address 1", width: 55 },
  { name: "Residence Address 2", width: 55 },
  { name: "Residence Address 3", width: 55 },
  { name: "Residence Address City", width: 30 },
  { name: "Residence Address State", width: 2 },
  { name: "Residence Address Zip Code", width: 15 },
  { name: "Residence Address Country", width: 3 },
  { name: "Member Home Phone", width: 14, get: (r) => str(r.phone) },
  { name: "Member Work Phone", width: 14 },
  { name: "Member Work Phone Extension", width: 5 },
  { name: "Member Cell Phone", width: 14 },
  { name: "Member Email Address", width: 64 },
  { name: "Contact Last Name", width: 35 },
  { name: "Contact First Name", width: 25 },
  { name: "Contact Middle Name", width: 25 },
  { name: "Contact Name Suffix", width: 10 },
  { name: "Contact Address 1", width: 55 },
  { name: "Contact Address 2", width: 55 },
  { name: "Contact Address 3", width: 55 },
  { name: "Contact City", width: 30 },
  { name: "Contact State", width: 2 },
  { name: "Contact Zip Code", width: 15 },
  { name: "Contact Country", width: 3 },
  { name: "Contact Phone", width: 14 },
  { name: "Contact Phone Extension", width: 5 },
  { name: "Contact Email Address", width: 64 },
  { name: "Provider Practice Location ID", width: 12 },
  { name: "MPNA Effective Date", width: 8 },
  { name: "MPNA Termination Date", width: 8 },
  { name: "Provider Termination Reason Code", width: 4 },
  { name: "Network ID", width: 12 },
  { name: "NPI", width: 10 },
  { name: "COB Other Carrier Name", width: 50 },
  { name: "COB Other Carrier Group/Policy #", width: 12 },
  { name: "COB Other Carrier  Address 1", width: 55 },
  { name: "COB Other Carrier  Address 2", width: 55 },
  { name: "COB Other Carrier  City", width: 30 },
  { name: "COB Other Carrier  State", width: 2 },
  { name: "COB Other Carrier  Zip Code", width: 15 },
  { name: "COB Other Carrier Subscriber Last Name", width: 35 },
  { name: "COB Other Carrier Subscriber First Name", width: 25 },
  { name: "COB Other Carrier Subscriber ID", width: 12 },
  { name: "Other Carrier Subscriber DOB", width: 8 },
  { name: "COB Effective Date", width: 8 },
  { name: "COB Termination Date", width: 8 },
  { name: "834 Action Codes", width: 3 },
  { name: "Group Reporting Data 1", width: 50 },
  { name: "Group Reporting Data 2", width: 146 },
  { name: "Reserved", width: 192 },
];

/** Exported for smoke tests / format checks. */
export const DELTA_DETAIL_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  DETAIL_FIELDS.map((f) => ({ name: f.name, width: f.width }));

export const DELTA_RECORD_WIDTH = DETAIL_FIELDS.reduce((a, f) => a + f.width, 0);
export const DELTA_HEADER_WIDTH = HEADER_FIELDS.reduce((a, f) => a + f.width, 0);
export const DELTA_TRAILER_WIDTH = TRAILER_FIELDS.reduce((a, f) => a + f.width, 0);

export function encodeDeltaRow(row: Record<string, unknown>): string {
  return encodeFixedWidthRow(DETAIL_FIELDS, row);
}

export function encodeDeltaHeader(ctx: TrustProviderEdiContext): string {
  const today = new Date().toISOString().slice(0, 10);
  return encodeFixedWidthRow(HEADER_FIELDS, {
    groupId: GROUP_ID,
    reportingDate: ymdCompact(readAsOfYmd(ctx)),
    fileType: readModeIndicator(ctx),
    fileCreateDate: ymdCompact(today),
  });
}

export function encodeDeltaTrailer(aggregates: EdiBatchAggregates): string {
  return encodeFixedWidthRow(TRAILER_FIELDS, {
    // Legacy trailer counts every record in the file: details + header + trailer.
    recordCount: String(aggregates.detailRecordCount + 2),
  });
}

/**
 * Relation-type sirius id → Delta member classification.
 * S1-taxonomy rulings (2026-08-05): RP (QMSCO variant) → 13 like QMSCO;
 * EX (Ex Spouse, retired "ES") is explicitly blank — never spouse-like.
 */
export function deltaMemberClassification(
  relationSiriusId: string | null,
): string {
  if (!relationSiriusId) return "10";
  if (["C", "AC", "SC"].includes(relationSiriusId)) return "30";
  if (relationSiriusId === "SP") return "20";
  if (relationSiriusId === "DP") return "21";
  if (relationSiriusId === "H") return "32";
  if (relationSiriusId === "G") return "40";
  if (relationSiriusId === "QMSCO" || relationSiriusId === "RP") return "13";
  if (relationSiriusId === "EX") return "";
  return "";
}

/** Gender option code → Delta code (M/F, else U). */
function deltaGender(code: string | null): string {
  if (code === "M") return "M";
  if (code === "F") return "F";
  return "U";
}

/** COBRA members carry division 09002; everyone else 00002. */
export function deltaDivisionId(isCobra: boolean): string {
  return isCobra ? "09002" : "00002";
}

function zip15(postalCode: string | null | undefined): string {
  return String(postalCode ?? "").replace(/\D/g, "").slice(0, 15);
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-delta",
  name: "SMF - Delta Dental Eligibility File",
  description:
    "Fixed-width Delta Dental eligibility file with header and trailer " +
    "records: one detail record per subscriber and covered dependent for " +
    "the dental benefit in the as-of month, with the medical-plan-derived " +
    "client group ID.",
  benefitSiriusIds: ["D"],
  ediFields: DETAIL_FIELDS,
  configSchema: {
    type: "object",
    properties: {
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "D",
        description:
          "Sirius ID of the dental benefit whose monthly benefit records populate the file.",
      },
      medicalPlanGroupMap: {
        type: "object",
        title: "Medical Plan → Client Group ID",
        additionalProperties: { type: "string" },
        description:
          "Maps a medical benefit Sirius ID to the Delta client group ID " +
          "(default: M→SMM00, H→SMH00, K/KE→SMK00).",
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
      mode: {
        type: "string",
        title: "Mode",
        enum: ["P", "T"],
        default: "P",
        description:
          'Header "production / test indicator": P = production data, T = test data.',
      },
    },
  },
  getColumns() {
    return [
      { id: "memberClassification", header: "Class", type: "string", width: 70 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "divisionId", header: "Division", type: "string", width: 90 },
      { id: "clientGroupId", header: "Client Group", type: "string", width: 110 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  async processBatch(keys, ctx: TrustProviderEdiContext) {
    const units = await buildMemberUnits(keys, ctx);
    const groupIds = await clientGroupIdsByWorker(ctx, units);
    const out: Array<Record<string, unknown>> = [];

    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const shared = {
        groupId: GROUP_ID,
        divisionId: deltaDivisionId(unit.isCobra),
        clientGroupId: groupIds.get(wmb.workerId) ?? "",
        subscriberSsn: padSsn(subscriber.ssn),
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(unit.coverageStartYmd),
        coverageEnd: "",
      };

      // Subscriber detail record.
      out.push({
        pk: wmb.id,
        ...shared,
        memberSsn: padSsn(subscriber.ssn),
        memberName: displayName(subscriber),
        memberClassification: deltaMemberClassification(null),
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleName: subscriber.middleName ?? "",
        gender: deltaGender(subscriber.genderCode),
        birthDate: ymdCompact(subscriber.birthDate),
        street: subscriber.postal?.street ?? "",
        city: subscriber.postal?.city ?? "",
        state: subscriber.postal?.state ?? "",
        zip: zip15(subscriber.postal?.postalCode),
        phone: phoneDigits(subscriber.phoneNumber),
      });

      // Dependent detail records.
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memberSsn: padSsn(dep.ssn),
          memberName: displayName(dep),
          memberClassification: deltaMemberClassification(dep.relationSiriusId),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleName: dep.middleName ?? "",
          gender: deltaGender(dep.genderCode),
          birthDate: ymdCompact(dep.birthDate),
          street: dep.postal?.street ?? "",
          city: dep.postal?.city ?? "",
          state: dep.postal?.state ?? "",
          zip: zip15(dep.postal?.postalCode),
          phone: phoneDigits(dep.phoneNumber),
        });
      }
    }
    return out;
  },

  encodeFileHeader(ctx) {
    return encodeDeltaHeader(ctx);
  },

  encodeFileTrailer(_ctx, aggregates) {
    return encodeDeltaTrailer(aggregates);
  },

  encodeRow(row) {
    return encodeDeltaRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `DELTA_${stamp}.txt`;
  },
});
