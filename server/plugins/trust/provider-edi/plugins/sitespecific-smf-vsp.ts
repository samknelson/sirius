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
  buildMemberUnits,
  displayName,
} from "../base";

/**
 * SMF — VSP vision eligibility EDI file.
 *
 * Port of the legacy `edi_vsp.inc`. A single fixed-width file covering
 * members of BOTH vision benefits — standard ("3") and enhanced ("3E") —
 * via the framework's multi-benefit membership. One record per subscriber
 * ("MEM") and one per covered dependent ("DEP"); every record carries the
 * subscriber's SSN, and each unit's Division-Code encodes which benefit it
 * came from crossed with COBRA status:
 *
 *   standard + non-COBRA → 1001    standard + COBRA → 1002
 *   enhanced + non-COBRA → 2001    enhanced + COBRA → 2002
 *
 * Fields with no data source in the current model (emails, languages,
 * country, coverage end) emit spaces, matching the framework's
 * open-coverage convention.
 */

const STANDARD_SIRIUS_ID = "3";
const ENHANCED_SIRIUS_ID = "3E";

// Exact port of the legacy `edi_fields()` layout (order and widths).
const EDI_FIELDS: EdiField[] = [
  { name: "Subscriber Record ID", width: 3, get: (r) => str(r.recordId) },
  { name: "Full Replacement Files", width: 1, get: () => "R" },
  { name: "Control Number", width: 5, get: (r) => str(r.controlNumber) },
  { name: "Subscriber ID", width: 30 },
  { name: "Subscriber SSN", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "Alternate Subscriber ID", width: 30 },
  { name: "Previous Subscriber ID", width: 30 },
  { name: "Dependent SSN", width: 9, get: (r) => str(r.dependentSsn) },
  { name: "Subscriber Last Name", width: 18, get: (r) => str(r.lastName) },
  { name: "Subscriber First Name", width: 12, get: (r) => str(r.firstName) },
  { name: "Subscriber Middle Initial", width: 1, get: (r) => str(r.middleInitial) },
  { name: "Subscriber Name-Suffix", width: 3 },
  { name: "Gender", width: 1, get: (r) => str(r.gender) },
  { name: "Family-Indicator", width: 1, get: (r) => str(r.familyIndicator) },
  { name: "Date of Birth", width: 8, get: (r) => str(r.birthDate) },
  { name: "Vision Coverage Begin Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "Vision Coverage End Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "Family Indicator Change Effective Date", width: 8 },
  { name: "Division-Code", width: 30, get: (r) => str(r.divisionCode) },
  { name: "Cross-Reference Code", width: 16 },
  { name: "Subscriber Residence Address Line 1", width: 30, get: (r) => str(r.street) },
  { name: "Subscriber Residence Address Line 2", width: 30 },
  { name: "Subscriber Residence City", width: 19, get: (r) => str(r.city) },
  { name: "Subscriber Residence State Code", width: 2, get: (r) => str(r.state) },
  { name: "Subscriber Residence ZIP Code", width: 10, get: (r) => str(r.zip) },
  { name: "Subscriber Residence Phone Number", width: 10, get: (r) => str(r.phone) },
  { name: "Subscriber Residence Country", width: 3 },
  { name: "Subscriber Home Email Address", width: 50 },
  { name: "Subscriber Work Email Address", width: 50 },
  { name: "Subscriber Mailing Address Line 1", width: 30, get: (r) => str(r.street) },
  { name: "Subscriber Mailing Address Line 2", width: 30 },
  { name: "Subscriber Mailing City", width: 19, get: (r) => str(r.city) },
  { name: "Subscriber Mailing State", width: 2, get: (r) => str(r.state) },
  { name: "Subscriber Mailing ZIP Code", width: 10, get: (r) => str(r.zip) },
  { name: "Subscriber Mailing Country", width: 3 },
  { name: "Subscriber Work Phone Number", width: 10, get: (r) => str(r.subscriberPhone) },
  { name: "Subscriber Message Phone", width: 10, get: (r) => str(r.subscriberPhone) },
  { name: "Subscriber Native Language", width: 3 },
  { name: "Subscriber Spoken Language", width: 3 },
  { name: "Subscriber Reading Language", width: 3 },
  { name: "Subscriber Ethnicity", width: 1 },
  { name: "Subscriber Status Code", width: 1, get: (r) => str(r.statusCode) },
  { name: "Subscriber Citizenship Status Code", width: 2 },
  { name: "Subscriber Status", width: 2 },
  { name: "Subscriber Marital Status Code", width: 1 },
  { name: "Subscriber Medicare Plan Code", width: 1 },
  { name: "Filler2", width: 34 },
];

/** Exported for smoke tests / format checks. */
export const VSP_EDI_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  EDI_FIELDS.map((f) => ({ name: f.name, width: f.width }));

export const VSP_RECORD_WIDTH = EDI_FIELDS.reduce((a, f) => a + f.width, 0);

export function encodeVspRow(row: Record<string, unknown>): string {
  return encodeFixedWidthRow(EDI_FIELDS, row);
}

/** Legacy VSP division code: benefit (standard/enhanced) × COBRA. */
export function vspDivisionCode(isEnhanced: boolean, isCobra: boolean): string {
  if (isEnhanced) return isCobra ? "2002" : "2001";
  return isCobra ? "1002" : "1001";
}

/** Relation-type sirius id → VSP family indicator (dependent records). */
export function vspDependentFamilyIndicator(
  relationSiriusId: string | null,
): string {
  if (!relationSiriusId) return "";
  if (relationSiriusId === "SP") return "S";
  if (["DP", "ES"].includes(relationSiriusId)) return "P";
  if (["C", "AC", "QMSCO", "SC", "G"].includes(relationSiriusId)) return "C";
  if (relationSiriusId === "H") return "H";
  return "";
}

/** Subscriber family indicator by dependent count: 0→C, 1→B, more→A. */
export function vspSubscriberFamilyIndicator(dependentCount: number): string {
  if (dependentCount === 0) return "C";
  if (dependentCount === 1) return "B";
  return "A";
}

/** Gender option code → VSP code: M/F pass through, other set values → U. */
function vspGender(code: string | null): string {
  if (!code) return "";
  return code === "M" || code === "F" ? code : "U";
}

function zip10(postalCode: string | null | undefined): string {
  return String(postalCode ?? "").replace(/\D/g, "").slice(0, 10);
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-vsp",
  name: "SMF - VSP Eligibility File",
  description:
    "Fixed-width VSP vision eligibility file covering members of both the " +
    "standard and enhanced vision benefits, with per-benefit division coding " +
    "and subscriber/dependent records.",
  // Multi-benefit membership: standard + enhanced vision in one file.
  benefitSiriusIds: [STANDARD_SIRIUS_ID, ENHANCED_SIRIUS_ID],
  configSchema: {
    type: "object",
    properties: {
      controlNumber: {
        type: "string",
        title: "Control Number",
        default: "52638",
        description: "VSP control number placed on every record.",
      },
      benefitSiriusIds: {
        type: "array",
        title: "Benefit Sirius IDs",
        items: { type: "string" },
        default: [STANDARD_SIRIUS_ID, ENHANCED_SIRIUS_ID],
        description:
          "Sirius IDs of the vision benefits whose monthly benefit records " +
          "populate the file (first is standard, second is enhanced).",
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
      { id: "recordId", header: "Record", type: "string", width: 80 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "familyIndicator", header: "Family Ind", type: "string", width: 90 },
      { id: "divisionCode", header: "Division", type: "string", width: 90 },
      { id: "statusCode", header: "Status", type: "string", width: 70 },
      { id: "subscriberSsn", header: "Subscriber SSN", type: "string", width: 120 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  async processBatch(keys, ctx: TrustProviderEdiContext) {
    const controlNumber =
      typeof ctx.configData?.controlNumber === "string" &&
      ctx.configData.controlNumber
        ? ctx.configData.controlNumber
        : "52638";
    // The enhanced benefit is the SECOND configured sirius id (config
    // override) or the registered "3E" default.
    const configured = Array.isArray(ctx.configData?.benefitSiriusIds)
      ? (ctx.configData.benefitSiriusIds as string[])
      : [STANDARD_SIRIUS_ID, ENHANCED_SIRIUS_ID];
    const enhancedSiriusId = configured[1] ?? ENHANCED_SIRIUS_ID;

    const units = await buildMemberUnits(keys, ctx);
    const out: Array<Record<string, unknown>> = [];

    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const isEnhanced = unit.benefitSiriusId === enhancedSiriusId;
      const divisionCode = vspDivisionCode(isEnhanced, unit.isCobra);
      const subscriberSsn = padSsn(subscriber.ssn);
      const subscriberPhone = phoneDigits(subscriber.phoneNumber);
      const shared = {
        controlNumber,
        subscriberSsn,
        subscriberName: displayName(subscriber),
        subscriberPhone,
        divisionCode,
        statusCode: unit.isCobra ? "C" : "A",
        coverageStart: ymdCompact(unit.coverageStartYmd),
        coverageEnd: "",
      };

      // Subscriber ("MEM") record.
      out.push({
        pk: wmb.id,
        ...shared,
        recordId: "MEM",
        dependentSsn: "",
        memberName: displayName(subscriber),
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleInitial: (subscriber.middleName ?? "").slice(0, 1),
        gender: vspGender(subscriber.genderCode),
        familyIndicator: vspSubscriberFamilyIndicator(unit.dependents.length),
        birthDate: ymdCompact(subscriber.birthDate),
        street: subscriber.postal?.street ?? "",
        city: subscriber.postal?.city ?? "",
        state: subscriber.postal?.state ?? "",
        zip: zip10(subscriber.postal?.postalCode),
        phone: subscriberPhone,
      });

      // Dependent ("DEP") records — member fields carry the dependent's
      // own demographics; the subscriber SSN stays on every record.
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          recordId: "DEP",
          dependentSsn: padSsn(dep.ssn),
          memberName: displayName(dep),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleInitial: (dep.middleName ?? "").slice(0, 1),
          gender: vspGender(dep.genderCode),
          familyIndicator: vspDependentFamilyIndicator(dep.relationSiriusId),
          birthDate: ymdCompact(dep.birthDate),
          street: dep.postal?.street ?? "",
          city: dep.postal?.city ?? "",
          state: dep.postal?.state ?? "",
          zip: zip10(dep.postal?.postalCode),
          phone: phoneDigits(dep.phoneNumber),
        });
      }
    }
    return out;
  },

  encodeRow(row) {
    return encodeVspRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `VSP_${stamp}.txt`;
  },
});
