import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";
import {
  type EdiCsvField,
  encodeCsvRow,
  encodeCsvHeaderRow,
  str,
  ymdCompact,
  buildMemberUnits,
  displayName,
  type EdiPerson,
  type EdiDependent,
  type EdiPostal,
} from "../base";

/**
 * SMF — Hinge Health (physical therapy) eligibility CSV.
 *
 * Port of the legacy PHP generator (Sirius_Smf_Report_Edi_Hinge): a simple
 * 15-column CSV with a header row — one row per subscriber and one per
 * covered dependent — for every worker holding a monthly benefit record
 * (trust_wmb) for the configured benefit in the as-of month.
 *
 * Legacy notes carried over:
 *  - subscriber_id is always the SUBSCRIBER's Sirius ID (dependents ride
 *    under their subscriber's id).
 *  - Dependent address/email fall back to the subscriber's — except for
 *    QMSCO dependents, which never inherit the subscriber's address.
 *  - `language` had no source in the legacy data either; emitted blank.
 */

const CSV_FIELDS: EdiCsvField[] = [
  { name: "subscriber_id", get: (r) => str(r.subscriberId) },
  { name: "first_name", get: (r) => str(r.firstName) },
  { name: "last_name", get: (r) => str(r.lastName) },
  { name: "dob", get: (r) => str(r.birthDate) },
  { name: "relationship", get: (r) => str(r.relationship) },
  { name: "sex", get: (r) => str(r.sex) },
  { name: "address1", get: (r) => str(r.address1) },
  { name: "address2", get: (r) => str(r.address2) },
  { name: "city", get: (r) => str(r.city) },
  { name: "state", get: (r) => str(r.state) },
  { name: "zip", get: (r) => str(r.zip) },
  { name: "email", get: (r) => str(r.email) },
  { name: "start_date", get: (r) => str(r.coverageStart) },
  { name: "term_date", get: (r) => str(r.coverageEnd) },
  { name: "language", get: (r) => str(r.language) },
];

/** Exported for the smoke test. */
export const HINGE_CSV_FIELDS = CSV_FIELDS;

/** Relation-type sirius id → Hinge relationship label (legacy mapping). */
export function hingeRelationship(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "EE";
  if (["DB", "ES", "SP"].includes(relationSiriusId)) return "Spouse";
  if (["G", "C", "AC", "H", "SC"].includes(relationSiriusId)) return "Child";
  if (relationSiriusId === "QMSCO") return "Q";
  return "Other";
}

/** Gender option code → M/F/U (legacy: blank stays blank). */
export function hingeSex(code: string | null): string {
  if (!code) return "";
  return code === "M" || code === "F" ? code : "U";
}

/** 5-digit zip from a postal record. */
function zip5(postal: EdiPostal | null): string {
  return String(postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
}

/**
 * Legacy `hinge_column` semantics: use the member's own value; when blank,
 * fall back to the subscriber's — unless the member is a QMSCO dependent.
 */
export function hingeAddressFields(
  member: EdiPerson,
  subscriber: EdiPerson,
  isQmsco: boolean,
): { address1: string; address2: string; city: string; state: string; zip: string; email: string } {
  const own = member.postal;
  const pick = <T>(ownV: T | null | undefined, subV: T | null | undefined): T | "" =>
    (ownV ?? "") !== "" ? (ownV as T) : isQmsco ? "" : ((subV ?? "") as T | "");
  return {
    address1: str(pick(own?.street, subscriber.postal?.street)),
    address2: "",
    city: str(pick(own?.city, subscriber.postal?.city)),
    state: str(pick(own?.state, subscriber.postal?.state)),
    zip: str(pick(zip5(own ?? null) || null, zip5(subscriber.postal ?? null) || null)),
    email: str(pick(member.email, subscriber.email)),
  };
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-hinge",
  name: "SMF - Hinge Eligibility File",
  description:
    "CSV Hinge Health eligibility file (15 columns with header row): one row " +
    "per subscriber and covered dependent with a Hinge monthly benefit record " +
    "in the as-of month.",
  benefitSiriusIds: ["HINGEPT"],
  outputFormat: "csv",
  configSchema: {
    type: "object",
    properties: {
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "HINGEPT",
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
      { id: "subscriberId", header: "Subscriber ID", type: "string", width: 110 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "relationship", header: "Relationship", type: "string", width: 110 },
      { id: "birthDate", header: "DOB", type: "string", width: 100 },
      { id: "sex", header: "Sex", type: "string", width: 60 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
      { id: "email", header: "Email", type: "string", width: 200 },
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
        subscriberId: String(subscriber.workerSiriusId ?? ""),
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(unit.coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open (blank).
        coverageEnd: "",
        language: "",
      };
      out.push({
        pk: wmb.id,
        ...shared,
        memberName: displayName(subscriber),
        firstName: subscriber.givenName ?? "",
        lastName: subscriber.familyName ?? "",
        birthDate: ymdCompact(subscriber.birthDate),
        relationship: "EE",
        sex: hingeSex(subscriber.genderCode),
        ...hingeAddressFields(subscriber, subscriber, false),
      });
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memberName: displayName(dep),
          firstName: dep.givenName ?? "",
          lastName: dep.familyName ?? "",
          birthDate: ymdCompact(dep.birthDate),
          relationship: hingeRelationship(dep.relationSiriusId),
          sex: hingeSex(dep.genderCode),
          ...hingeAddressFields(dep, subscriber, dep.relationSiriusId === "QMSCO"),
        });
      }
    }
    return out;
  },

  encodeCsvHeaderRow() {
    return encodeCsvHeaderRow(CSV_FIELDS);
  },

  encodeRow(row) {
    return encodeCsvRow(CSV_FIELDS, row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `HINGE_${stamp}.csv`;
  },
});
