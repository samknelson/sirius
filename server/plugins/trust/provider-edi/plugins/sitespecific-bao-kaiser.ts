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
 * BAO — Kaiser Permanente eligibility EDI file.
 *
 * Port of the legacy PHP generator's record encoding. Produces a
 * fixed-width file with one record per subscriber ("A" record) and one per
 * covered dependent ("D" record) for every worker who holds a monthly
 * benefit record (trust_wmb) for the configured benefit in the as-of month
 * (membership/dependent assembly comes from the shared EDI base).
 *
 * Fixed-width layout: `EDI_FIELDS` below defines every output field in
 * order with its exact width (FILLER fields emit spaces). A row is the
 * concatenation of each field value left-justified and space-padded (or
 * zero-padded where noted) to its width.
 */

// Exact port of the legacy PHP `edi_fields()` layout (field order, widths,
// and FILLERs). Fields with no `get` emit spaces.
const EDI_FIELDS: EdiField[] = [
  { name: "Region Code", width: 3, get: (r) => str(r.regionCode) },
  { name: "Record Type", width: 1, get: () => "1" },
  { name: "Customer ID", width: 9, get: (r) => str(r.customerId) },
  { name: "Enrollment Unit", width: 4, get: (r) => str(r.enrollmentUnit) },
  { name: "FILLER1", width: 36 },
  { name: "Activity Date", width: 8, get: (r) => str(r.activityDate) },
  { name: "Transaction Type", width: 1 },
  { name: "Record Code", width: 1, get: (r) => str(r.recordCode) },
  { name: "FILLER2", width: 38 },
  { name: "Last Name", width: 25, get: (r) => str(r.lastName) },
  { name: "First Name", width: 25, get: (r) => str(r.firstName) },
  { name: "Middle Name", width: 25, get: (r) => str(r.middleName) },
  { name: "Account Role", width: 2, get: (r) => str(r.accountRole) },
  { name: "FILLER3", width: 10 },
  { name: "Birth Date", width: 8, get: (r) => str(r.birthDate) },
  { name: "Marital Status", width: 2 },
  { name: "FILLER4", width: 10 },
  { name: "Gender", width: 2, get: (r) => str(r.gender) },
  { name: "FILLER5", width: 5 },
  { name: "FILLER6", width: 1 },
  { name: "FILLER7", width: 2 },
  { name: "Subscriber SSN", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "Member SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "FILLER8", width: 2 },
  { name: "Employee ID", width: 9 },
  { name: "Supplemental ID", width: 16, get: (r) => str(r.supplementalId) },
  { name: "Employer ID", width: 4 },
  { name: "Employment Status", width: 2 },
  { name: "FILLER9", width: 5 },
  { name: "Hire Date", width: 8 },
  { name: "Home Phone", width: 10, get: (r) => str(r.phone) },
  { name: "Work", width: 10 },
  { name: "FILLER10", width: 30 },
  { name: "Address Line 1", width: 40, get: (r) => str(r.street) },
  { name: "Address Line 2", width: 40 },
  { name: "FILLER11", width: 30 },
  { name: "City", width: 45, get: (r) => str(r.city) },
  { name: "FILLER12", width: 45 },
  { name: "State", width: 2, get: (r) => str(r.state) },
  { name: "ZIP Code", width: 5, get: (r) => str(r.zip) },
  { name: "FILLER13", width: 2 },
  { name: "ZIP Plus 4", width: 4 },
  { name: "FILLER14", width: 45 },
  { name: "Enrollment  Reason", width: 2 },
  { name: "FILLER15", width: 10 },
  { name: "Effective Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "FILLER16", width: 8 },
  { name: "FILLER17", width: 2 },
  { name: "FILLER18", width: 10 },
  { name: "Termination Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "FILLER19", width: 2 },
  { name: "FILLER20", width: 8 },
  { name: "Current Eligibility Status", width: 1 },
  { name: "Current Dues Amount", width: 7, get: (r) => str(r.duesAmount) },
  { name: "Current Rate Code", width: 5 },
  { name: "Retroactivity Date", width: 8 },
  { name: "Retroactive Dues Amount", width: 7 },
  { name: "Retroactive Rate Code", width: 5 },
  { name: "Additional Retroactivity", width: 220 },
  { name: "FILLER21", width: 7 },
  { name: "Eligibility Date", width: 8 },
  { name: "Dues Amount or Rate Code", width: 7 },
  { name: "Eligibility Status", width: 1 },
  { name: "Additional Eligibility Grid Information", width: 160 },
  { name: "FILLER22", width: 36 },
];

/** Encode one persisted row as a fixed-width Kaiser record (exported for the format check script). */
export function encodeKaiserRow(row: Record<string, unknown>): string {
  return encodeFixedWidthRow(EDI_FIELDS, row);
}

/** Exported for the format check script. */
export const KAISER_EDI_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  EDI_FIELDS.map((f) => ({ name: f.name, width: f.width }));

/**
 * Legacy `kaiser_encode_number`: amount in dollars → cents with the last
 * digit replaced by a signed-overpunch character, zero-padded to 7 wide.
 * kaiserEncodeNumber(0) === "000000{".
 */
export function kaiserEncodeNumber(amount: number, width = 7): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const digits = String(cents).padStart(width, "0").slice(-width);
  const lastDigit = Number(digits[digits.length - 1]);
  const positives = ["{", "A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const negatives = ["}", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
  const overpunch = amount < 0 ? negatives[lastDigit] : positives[lastDigit];
  return digits.slice(0, -1) + overpunch;
}

/**
 * Relation-type sirius id → Kaiser account role.
 * S1-taxonomy rulings (2026-08-05): RP (QMSCO variant) is a child role like
 * QMSCO; EX (Ex Spouse, retired "ES") is NEVER spouse-like or self — it
 * emits blank so a covered ex-spouse surfaces as a data error in the file
 * rather than being enrolled as the subscriber or a spouse.
 */
export function accountRole(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "01";
  if (relationSiriusId === "DP") return "05";
  if (
    ["C", "AC", "H", "SC", "G"].includes(relationSiriusId) ||
    isQmscoRelation(relationSiriusId)
  )
    return "06";
  if (relationSiriusId === "SP") return "07";
  if (relationSiriusId === "EX") return "";
  return "01";
}

/** Gender option code → Kaiser gender code (01 male / 02 female / 03 other). */
function genderCode(code: string | null): string {
  if (code === "M") return "01";
  if (code === "F") return "02";
  return "03";
}

/** Coverage start is floored at the Kaiser go-live date. */
const COVERAGE_START_FLOOR = "2025-08-01";

interface KaiserConfigData {
  regionCode?: string;
  customerId?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<KaiserConfigData> {
  const d = (ctx.configData ?? {}) as KaiserConfigData;
  return {
    regionCode: d.regionCode || "SCR",
    customerId: d.customerId || "000226111",
  };
}

/**
 * Activity date option: file creation date (default) vs first of the
 * current month (legacy uses today's month, not the as-of month).
 */
function readActivityDate(ctx: TrustProviderEdiContext): string {
  const input = ctx.input ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const mode = input.activityDateMode === "first_of_month" ? "first_of_month" : "creation_date";
  const activity = mode === "first_of_month" ? `${today.slice(0, 7)}-01` : today;
  return ymdCompact(activity);
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-bao-kaiser",
  name: "BAO - Kaiser Eligibility File",
  description:
    "Fixed-width Kaiser Permanente eligibility file: one record per subscriber " +
    "with a Kaiser monthly benefit record in the as-of month, plus one per covered dependent.",
  requiredComponent: "sitespecific.bao",
  // Default membership: wmb rows for these benefits in the as-of month
  // (config-level benefitSiriusId still overrides per config).
  benefitSiriusIds: ["K"],
  configSchema: {
    type: "object",
    properties: {
      regionCode: {
        type: "string",
        title: "Region Code",
        default: "SCR",
        description: "Kaiser region code placed at the start of every record.",
      },
      customerId: {
        type: "string",
        title: "Customer ID",
        default: "000226111",
        description: "Kaiser customer/group number (9 digits).",
      },
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "K",
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
      activityDateMode: {
        type: "string",
        title: "Activity Date",
        enum: ["creation_date", "first_of_month"],
        default: "creation_date",
        description:
          "Whether records carry the file creation date or the first of the as-of month.",
      },
    },
  },
  getColumns() {
    return [
      { id: "recordCode", header: "Record", type: "string", width: 80 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "accountRole", header: "Role", type: "string", width: 70 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "gender", header: "Gender", type: "string", width: 80 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "coverageEnd", header: "Coverage End", type: "string", width: 110 },
      { id: "enrollmentUnit", header: "Enrollment Unit", type: "string", width: 110 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const activityDate = readActivityDate(ctx);
    const units = await buildMemberUnits(keys, ctx);
    const out: Array<Record<string, unknown>> = [];

    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const subscriberSsn = padSsn(subscriber.ssn);
      const coverageStartYmd =
        unit.coverageStartYmd < COVERAGE_START_FLOOR
          ? COVERAGE_START_FLOOR
          : unit.coverageStartYmd;

      const shared = {
        regionCode: cfg.regionCode,
        customerId: cfg.customerId,
        // COBRA members carry the Kaiser enrollment unit 7000.
        enrollmentUnit: unit.isCobra ? "7000" : "0000",
        activityDate,
        subscriberSsn,
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open,
        // matching how an election with null endYmd encoded (blank).
        coverageEnd: "",
        // Premiums are not modeled here yet; the legacy generator encodes
        // the (zero) amount, producing "000000{".
        duesAmount: kaiserEncodeNumber(0),
      };

      // Subscriber record ("A").
      out.push({
        pk: wmb.id,
        ...shared,
        recordCode: "A",
        memberSsn: subscriberSsn,
        memberName: displayName(subscriber),
        accountRole: "01",
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleName: subscriber.middleName ?? "",
        gender: genderCode(subscriber.genderCode),
        birthDate: ymdCompact(subscriber.birthDate),
        ...postalFields(subscriber.postal),
        phone: phoneDigits(subscriber.phoneNumber),
        supplementalId: "",
      });

      // Dependent records ("D") — dependents carry their own address and
      // phone (legacy generator reads them from the member's record).
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          recordCode: "D",
          memberSsn: padSsn(dep.ssn),
          memberName: displayName(dep),
          accountRole: accountRole(dep.relationSiriusId),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleName: dep.middleName ?? "",
          gender: genderCode(dep.genderCode),
          birthDate: ymdCompact(dep.birthDate),
          ...postalFields(dep.postal),
          phone: phoneDigits(dep.phoneNumber),
          supplementalId: isQmscoRelation(dep.relationSiriusId) ? "08" : "",
        });
      }
    }
    return out;
  },

  encodeRow(row) {
    return encodeKaiserRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `KAISER_${stamp}.txt`;
  },
});
