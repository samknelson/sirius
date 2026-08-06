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
  isQmscoRelation,
} from "../base";
import { clientGroupIdsByWorker, readModeIndicator } from "./sitespecific-smf-shared";

/**
 * SMF — Express Scripts pharmacy eligibility EDI file.
 *
 * Port of the legacy `edi_expressscripts.inc`. Fixed-width records: an
 * "H" header (client ID/name, processing/as-of date, file creation date,
 * production/test indicator, feed source), one "M" detail record per
 * subscriber and covered dependent, and a "T" trailer whose record count
 * is the number of detail records + 2 (header + trailer), matching the
 * legacy count.
 *
 * The legacy generator split QMSCO members into a separate feed via a
 * run parameter; that is preserved: "exclude" (default) drops QMSCO
 * dependents, "include" emits ONLY QMSCO dependents.
 *
 * Note: the legacy Client ID value "K7GA" is one character wider than the
 * 3-wide header/trailer Client ID fields, so it truncates to "K7G" there —
 * the port reproduces that byte-for-byte. The detail record's Client
 * Identifier field is 3 wide as well.
 */

const CLIENT_ID = "K7GA";
const CLIENT_NAME = "UNITE HERE Local 11 Health Benefit Fund";

const HEADER_FIELDS: EdiField[] = [
  { name: "Record Type", width: 1, get: () => "H" },
  { name: "Client ID", width: 3, get: () => CLIENT_ID },
  { name: "Client Name", width: 60, get: () => CLIENT_NAME },
  { name: "Processing Date", width: 8, get: (r) => str(r.processingDate) },
  { name: "File Creation Date", width: 8, get: (r) => str(r.fileCreationDate) },
  { name: "File Number", width: 8, get: () => "00000000" },
  { name: "Production/Test indicator", width: 1, get: (r) => str(r.mode) },
  { name: "Feed Source Desc", width: 18, get: () => "TPA" },
  { name: "Feed Source ID", width: 5, get: () => "K7G01" },
  { name: "Batch Type", width: 1, get: () => "N" },
  { name: "Term Date", width: 8 },
  { name: "Bypass Record Count", width: 8 },
  { name: "File Type Indicator", width: 1, get: () => "P" },
  { name: "Filler1", width: 14 },
  { name: "ETS Process Key", width: 22 },
  { name: "Filler2", width: 634 },
  { name: "PDP Indicator", width: 1 },
  { name: "Filler3", width: 699 },
];

const TRAILER_FIELDS: EdiField[] = [
  { name: "Record Type", width: 1, get: () => "T" },
  { name: "Client ID", width: 3, get: () => CLIENT_ID },
  { name: "Record Count", width: 7, get: (r) => str(r.recordCount) },
  { name: "Filler1", width: 789 },
  { name: "Reserved /PDP Indicator", width: 1 },
  { name: "Filler2", width: 699 },
];

// Exact port of the legacy detail `edi_fields()` layout (order and widths).
const DETAIL_FIELDS: EdiField[] = [
  { name: "Record Type", width: 1, get: () => "M" },
  { name: "Client Identifier", width: 3, get: () => CLIENT_ID },
  { name: "Participant ID #1", width: 18 },
  { name: "Participant ID #2", width: 18 },
  { name: "Participant Effective Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "Participant First Name", width: 12, get: (r) => str(r.firstName) },
  { name: "Participant Last Name", width: 18, get: (r) => str(r.lastName) },
  { name: "Participant Middle Initial", width: 1, get: (r) => str(r.middleInitial) },
  { name: "Address #1", width: 30, get: (r) => str(r.street) },
  { name: "Address #2", width: 30 },
  { name: "Address #3", width: 30 },
  { name: "Address #4", width: 30 },
  { name: "City", width: 28, get: (r) => str(r.city) },
  { name: "State", width: 2, get: (r) => str(r.state) },
  { name: "Zip Code", width: 5, get: (r) => str(r.zip) },
  { name: "Zip Reserve", width: 4 },
  { name: "Date of Birth", width: 8, get: (r) => str(r.birthDate) },
  { name: "Gender Code", width: 1, get: (r) => str(r.gender) },
  { name: "Contract or Family ID", width: 18, get: (r) => str(r.subscriberSsn) },
  { name: "Dependent ID", width: 5 },
  { name: "Relationship Code", width: 1, get: (r) => str(r.relationshipCode) },
  { name: "Client Group ID", width: 18, get: (r) => str(r.clientGroupId) },
  { name: "PCP ID", width: 18 },
  { name: "Reserved1", width: 8 },
  { name: "Filler1", width: 18 },
  { name: "Reserved2", width: 8 },
  { name: "Transaction Date", width: 8 },
  { name: "Participant Expiration Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "Insurance Code", width: 20 },
  { name: "Reserved3", width: 1 },
  { name: "Reserved4", width: 7 },
  { name: "Filler2", width: 1 },
  { name: "Medicare ID", width: 12 },
  { name: "Reserved5", width: 1 },
  { name: "Reserved6", width: 7 },
  { name: "Copay Waiver Flag", width: 1 },
  { name: "Coverage Code Status", width: 1 },
  { name: "Print ID Card Flag", width: 1 },
  { name: "Admin Hold Eff Date", width: 8 },
  { name: "Admin Hold Exp Date", width: 8 },
  { name: "COB Indicator/ Primary Carrier Flag", width: 1 },
  { name: "Client Specific Data", width: 62 },
  { name: "Reserved7", width: 1 },
  { name: "Member Level Address Type", width: 1, get: (r) => str(r.memberLevelAddressType) },
  { name: "Hospice Indicator", width: 1 },
  { name: "Suspense Indicator", width: 1 },
  { name: "COB Effective date", width: 8 },
  { name: "Contract Type", width: 2, get: (r) => str(r.contractType) },
  { name: "Member SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "Subsidy/ESRD", width: 1 },
  { name: "Phone Number", width: 10 },
  { name: "Demographic Level 1", width: 20 },
  { name: "Demographic Level 2", width: 20 },
  { name: "Demographic Level 3", width: 20 },
  { name: "Demographic Level 4", width: 20 },
  { name: "Demographic Level 5", width: 20 },
  { name: "Demographic Level 6", width: 20 },
  { name: "Participant ID #3", width: 18 },
  { name: "Participant ID #4", width: 18 },
  { name: "County Code", width: 3 },
  { name: "Subsidy Eff Date", width: 8 },
  { name: "Subsidy Exp Date", width: 8 },
  { name: "Application ID", width: 10 },
  { name: "Benefit Option ID", width: 20 },
  { name: "Filler3", width: 14 },
  { name: "Multi-Birth Indicator", width: 1 },
  { name: "Client Specific 2", width: 54 },
  { name: "Record Sequence No.", width: 4 },
  { name: "PDP Indicator", width: 1 },
  { name: "Secondary-Drug-Insurance-Flag", width: 1 },
  { name: "Secondary-Rx-Group", width: 15 },
  { name: "Secondary-Rx-ID", width: 20 },
  { name: "Election Type", width: 1, get: () => "S" },
  { name: "Part D Premium-Amt", width: 6 },
  { name: "Premium-Withhold-Option-C-D", width: 1 },
  { name: "Disenrollment-Indicator", width: 1 },
  { name: "Filler4", width: 87 },
  { name: "Last Name Expanded", width: 35 },
  { name: "First Name Expanded", width: 25 },
  { name: "Middle Initial Expanded", width: 1 },
  { name: "Address Line1 Expanded", width: 55 },
  { name: "Address Line2 Expanded", width: 55 },
  { name: "Address Line3 Expanded", width: 55 },
  { name: "Address City Expanded", width: 30 },
  { name: "Address State Expanded", width: 2 },
  { name: "Address Zip5 Expanded", width: 5 },
  { name: "Address Zip4 Expanded", width: 4 },
  { name: "Address Country Code Expanded", width: 3 },
  { name: "Primary Phone", width: 10, get: (r) => str(r.phone) },
  { name: "Primary Phone Country Calling Code - Reserved for future.", width: 3 },
  { name: "Primary Phone Extension - Reserved for future.", width: 6 },
  { name: "Primary Phone Type", width: 1 },
  { name: "Communication Preference", width: 1 },
  { name: "Filler5", width: 9 },
  { name: "Alternate Phone", width: 10 },
  { name: "Alternate Phone Country Calling Code - Reserved for future.", width: 3 },
  { name: "Alternate Phone Extension - Reserved for future.", width: 6 },
  { name: "Alternate Phone Type", width: 1 },
  { name: "Filler6", width: 1 },
  { name: "Primary Email", width: 80 },
  { name: "Primary Email Type – Reserved for Future", width: 1 },
  { name: "Alternate Email – Reserved for Future", width: 80 },
  { name: "Alternate Email Type – Reserved for Future", width: 1 },
  { name: "Preferred Contact Method – Reserved for Future", width: 1 },
  { name: "Preferred  Language -", width: 3 },
  { name: "Time Zone", width: 5 },
  { name: "Filler7", width: 3 },
  { name: "HCR Plan Indicator", width: 1 },
  { name: "Grace Period Logic Effective Date", width: 8 },
  { name: "Ethnicity Indicator", width: 1 },
  { name: "Filler8", width: 62 },
];

/** Exported for smoke tests / format checks. */
export const ESI_DETAIL_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  DETAIL_FIELDS.map((f) => ({ name: f.name, width: f.width }));

export const ESI_RECORD_WIDTH = DETAIL_FIELDS.reduce((a, f) => a + f.width, 0);
export const ESI_HEADER_WIDTH = HEADER_FIELDS.reduce((a, f) => a + f.width, 0);
export const ESI_TRAILER_WIDTH = TRAILER_FIELDS.reduce((a, f) => a + f.width, 0);

export function encodeEsiRow(row: Record<string, unknown>): string {
  return encodeFixedWidthRow(DETAIL_FIELDS, row);
}

export function encodeEsiHeader(ctx: TrustProviderEdiContext): string {
  const today = new Date().toISOString().slice(0, 10);
  return encodeFixedWidthRow(HEADER_FIELDS, {
    processingDate: ymdCompact(readAsOfYmd(ctx)),
    fileCreationDate: ymdCompact(today),
    mode: readModeIndicator(ctx),
  });
}

export function encodeEsiTrailer(aggregates: EdiBatchAggregates): string {
  return encodeFixedWidthRow(TRAILER_FIELDS, {
    // Legacy trailer counts every record in the file: details + header + trailer.
    recordCount: String(aggregates.detailRecordCount + 2),
  });
}

/**
 * Relation-type sirius id → ESI relationship code.
 * S1-taxonomy ruling (2026-08-05): EX (Ex Spouse, retired "ES") emits blank
 * instead of riding the child-family default "3" — never spouse-like, and
 * visible in carrier-file QA. All child flavors (C/AC/SC/G/QMSCO/RP) stay
 * on the legacy default "3".
 */
export function esiRelationshipCode(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "1";
  if (relationSiriusId === "SP") return "2";
  if (relationSiriusId === "H") return "5";
  if (relationSiriusId === "DP") return "7";
  if (relationSiriusId === "EX") return "";
  return "3";
}

/** Gender option code → ESI code (M/F, else U). */
function esiGender(code: string | null): string {
  if (code === "M") return "M";
  if (code === "F") return "F";
  return "U";
}

function zip5(postalCode: string | null | undefined): string {
  return String(postalCode ?? "").replace(/\D/g, "").slice(0, 5);
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-expressscripts",
  name: "SMF - Express Scripts Eligibility File",
  description:
    "Fixed-width Express Scripts pharmacy eligibility file with header and " +
    "trailer records: one detail record per subscriber and covered " +
    "dependent, with the medical-plan-derived client group ID and a QMSCO " +
    "include/exclude feed split.",
  benefitSiriusIds: ["EXPRESSSCRIPTS"],
  configSchema: {
    type: "object",
    properties: {
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "EXPRESSSCRIPTS",
        description:
          "Sirius ID of the pharmacy benefit whose monthly benefit records populate the file.",
      },
      medicalPlanGroupMap: {
        type: "object",
        title: "Medical Plan → Client Group ID",
        additionalProperties: { type: "string" },
        description:
          "Maps a medical benefit Sirius ID to the ESI client group ID " +
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
      qmsco: {
        type: "string",
        title: "QMSCO",
        enum: ["exclude", "include"],
        default: "exclude",
        description:
          "Separate feeds: exclude QMSCO members (default) or include ONLY QMSCO members.",
      },
    },
  },
  getColumns() {
    return [
      { id: "relationshipCode", header: "Rel", type: "string", width: 60 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "clientGroupId", header: "Client Group", type: "string", width: 110 },
      { id: "contractType", header: "Contract", type: "string", width: 90 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  async processBatch(keys, ctx: TrustProviderEdiContext) {
    const qmscoOnly = (ctx.input ?? {}).qmsco === "include";
    const units = await buildMemberUnits(keys, ctx);
    const groupIds = await clientGroupIdsByWorker(ctx, units);
    const out: Array<Record<string, unknown>> = [];

    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const shared = {
        clientGroupId: groupIds.get(wmb.workerId) ?? "",
        subscriberSsn: padSsn(subscriber.ssn),
        subscriberName: displayName(subscriber),
        contractType: unit.isCobra ? "CB" : "AC",
        coverageStart: ymdCompact(unit.coverageStartYmd),
        coverageEnd: "",
      };

      // Subscriber record — subscribers are never QMSCO, so they are
      // dropped entirely from the QMSCO-only feed (legacy behavior).
      if (!qmscoOnly) {
        out.push({
          pk: wmb.id,
          ...shared,
          memberSsn: padSsn(subscriber.ssn),
          memberName: displayName(subscriber),
          relationshipCode: esiRelationshipCode(null),
          memberLevelAddressType: "",
          lastName: subscriber.familyName ?? "",
          firstName: subscriber.givenName ?? "",
          middleInitial: (subscriber.middleName ?? "").slice(0, 1),
          gender: esiGender(subscriber.genderCode),
          birthDate: ymdCompact(subscriber.birthDate),
          street: subscriber.postal?.street ?? "",
          city: subscriber.postal?.city ?? "",
          state: subscriber.postal?.state ?? "",
          zip: zip5(subscriber.postal?.postalCode),
          phone: phoneDigits(subscriber.phoneNumber),
        });
      }

      // Dependent records, split by the QMSCO feed selector.
      for (const dep of unit.dependents) {
        // RP rides the QMSCO feed too (S1-taxonomy ruling 2026-08-05).
        const isQmsco = isQmscoRelation(dep.relationSiriusId);
        if (isQmsco !== qmscoOnly) continue;
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memberSsn: padSsn(dep.ssn),
          memberName: displayName(dep),
          relationshipCode: esiRelationshipCode(dep.relationSiriusId),
          memberLevelAddressType: isQmsco ? "C" : "",
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleInitial: (dep.middleName ?? "").slice(0, 1),
          gender: esiGender(dep.genderCode),
          birthDate: ymdCompact(dep.birthDate),
          street: dep.postal?.street ?? "",
          city: dep.postal?.city ?? "",
          state: dep.postal?.state ?? "",
          zip: zip5(dep.postal?.postalCode),
          phone: phoneDigits(dep.phoneNumber),
        });
      }
    }
    return out;
  },

  encodeFileHeader(ctx) {
    return encodeEsiHeader(ctx);
  },

  encodeFileTrailer(_ctx, aggregates) {
    return encodeEsiTrailer(aggregates);
  },

  encodeRow(row) {
    return encodeEsiRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `ESI_${stamp}.txt`;
  },
});
