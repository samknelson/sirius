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
  padSsn,
  phoneDigits,
  buildMemberUnits,
  displayName,
  isQmscoRelation,
  type EdiPerson,
} from "../base";

/**
 * SMF — MLK Community Healthcare eligibility CSV.
 *
 * Port of the legacy PHP generator (Sirius_Smf_Report_Edi_MLK): a wide CSV
 * with a header row — one row per subscriber ("M") and covered dependent
 * ("D") — for every worker holding a monthly benefit record (trust_wmb)
 * for the configured benefit in the as-of month.
 *
 * Legacy notes carried over:
 *  - POLICY/PLAN/GROUP/LOB/ERN are constants (config-overridable here).
 *  - MEM ACCT is the subscriber's account number; DEP ACCT the member's own.
 *    The legacy alternate-ID fields (field_sirius_id2/id3, "U…"-prefixed
 *    external account numbers) have no counterpart in the new schema, so
 *    both columns carry the worker Sirius ID (the legacy fallback value).
 *  - Address/phone fall back to the subscriber's when the member's own is
 *    blank — except for QMSCO dependents, which never inherit.
 *  - FILE DT is the file creation date (YYYYMMDD).
 */

const CSV_FIELDS: EdiCsvField[] = [
  { name: "POLICY", get: (r) => str(r.policy) },
  { name: "PLAN", get: (r) => str(r.plan) },
  { name: "GROUP", get: (r) => str(r.group) },
  { name: "FILE DT", get: (r) => str(r.fileDate) },
  { name: "MEM ACCT", get: (r) => str(r.memAcct) },
  { name: "DEP ACCT", get: (r) => str(r.depAcct) },
  { name: "MEM/DEP", get: (r) => str(r.memDep) },
  { name: "LN", get: (r) => str(r.lastName) },
  { name: "FN", get: (r) => str(r.firstName) },
  { name: "MI", get: (r) => str(r.middleInitial) },
  { name: "DEP REL", get: (r) => str(r.depRel) },
  { name: "BD", get: (r) => str(r.birthDate) },
  { name: "SEX", get: (r) => str(r.sex) },
  { name: "SSN", get: (r) => str(r.subscriberSsn) },
  { name: "DEP SSN", get: (r) => str(r.memberSsn) },
  { name: "PHONE", get: (r) => str(r.phone) },
  { name: "ADDR1", get: (r) => str(r.address1) },
  { name: "ADDR2", get: () => "" },
  { name: "CITY", get: (r) => str(r.city) },
  { name: "ST", get: (r) => str(r.state) },
  { name: "ZIP", get: (r) => str(r.zip) },
  { name: "EFF DT", get: (r) => str(r.coverageStart) },
  { name: "TERM DT", get: (r) => str(r.coverageEnd) },
  { name: "PCP", get: () => "" },
  { name: "LOB", get: (r) => str(r.lob) },
  { name: "ERN", get: (r) => str(r.ern) },
  { name: "EMPLOYER", get: () => "" },
  { name: "EMAIL", get: (r) => str(r.email) },
];

/** Exported for the smoke test. */
export const MLK_CSV_FIELDS = CSV_FIELDS;

/**
 * Relation-type sirius id → MLK dependent relationship code. Legacy
 * comment: 01 = Self, 05 = Domestic Partner, 06 = child of any flavor,
 * 07 = Spouse, 08 = QMSCO child. Unknown types emit blank.
 * S1-taxonomy rulings (2026-08-05): SC (Step Child) added to the child
 * family (legacy omitted it — "child of any flavor" now really is);
 * RP → 08 like QMSCO; EX (Ex Spouse, retired "ES") is explicitly blank —
 * never spouse-like.
 */
export function mlkDepRel(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "01";
  if (["C", "G", "AC", "H", "SC"].includes(relationSiriusId)) return "06";
  if (relationSiriusId === "SP") return "07";
  if (relationSiriusId === "DP") return "05";
  if (relationSiriusId === "QMSCO" || relationSiriusId === "RP") return "08";
  if (relationSiriusId === "EX") return "";
  return "";
}

/** Gender option code → M/F/U (unknown/blank → U, like legacy). */
export function mlkSex(code: string | null): string {
  return code === "M" || code === "F" ? code : "U";
}

/**
 * Legacy `mlk_column` semantics: the member's own address/phone, falling
 * back to the subscriber's when blank — unless the member is QMSCO.
 */
export function mlkAddressFields(
  member: EdiPerson,
  subscriber: EdiPerson,
  isQmsco: boolean,
): { phone: string; address1: string; city: string; state: string; zip: string } {
  const pick = (ownV: string, subV: string): string =>
    ownV !== "" ? ownV : isQmsco ? "" : subV;
  const zip5 = (p: EdiPerson) =>
    String(p.postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  return {
    phone: pick(phoneDigits(member.phoneNumber), phoneDigits(subscriber.phoneNumber)),
    address1: pick(str(member.postal?.street), str(subscriber.postal?.street)),
    city: pick(str(member.postal?.city), str(subscriber.postal?.city)),
    state: pick(str(member.postal?.state), str(subscriber.postal?.state)),
    zip: pick(zip5(member), zip5(subscriber)),
  };
}

interface MlkConfigData {
  policy?: string;
  plan?: string;
  group?: string;
  lob?: string;
  ern?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<MlkConfigData> {
  const d = (ctx.configData ?? {}) as MlkConfigData;
  return {
    policy: d.policy || "MLKH",
    plan: d.plan || "1",
    group: d.group || "SMC",
    lob: d.lob || "COMMERCIAL",
    ern: d.ern || "C0991",
  };
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-smf-mlk",
  name: "SMF - MLK Eligibility File",
  description:
    "CSV MLK Community Healthcare eligibility file: one row per subscriber " +
    "and covered dependent with an MLK monthly benefit record in the as-of " +
    "month, including policy/plan/group constants and member/dependent SSNs.",
  benefitSiriusIds: ["M"],
  outputFormat: "csv",
  configSchema: {
    type: "object",
    properties: {
      policy: { type: "string", title: "Policy", default: "MLKH" },
      plan: { type: "string", title: "Plan", default: "1" },
      group: { type: "string", title: "Group", default: "SMC" },
      lob: { type: "string", title: "Line of Business", default: "COMMERCIAL" },
      ern: { type: "string", title: "ERN", default: "C0991" },
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "M",
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
      { id: "memDep", header: "Mem/Dep", type: "string", width: 80 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "depRel", header: "Dep Rel", type: "string", width: 80 },
      { id: "memAcct", header: "Mem Acct", type: "string", width: 100 },
      { id: "depAcct", header: "Dep Acct", type: "string", width: 100 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "DOB", type: "string", width: 100 },
      { id: "sex", header: "Sex", type: "string", width: 60 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "coverageEnd", header: "Coverage End", type: "string", width: 110 },
    ];
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const fileDate = ymdCompact(new Date().toISOString().slice(0, 10));
    const units = await buildMemberUnits(keys, ctx);
    const out: Array<Record<string, unknown>> = [];
    for (const unit of units) {
      const { wmb, subscriber } = unit;
      const shared = {
        policy: cfg.policy,
        plan: cfg.plan,
        group: cfg.group,
        lob: cfg.lob,
        ern: cfg.ern,
        fileDate,
        memAcct: String(subscriber.workerSiriusId ?? ""),
        subscriberSsn: padSsn(subscriber.ssn),
        subscriberName: displayName(subscriber),
        coverageStart: ymdCompact(unit.coverageStartYmd),
        // Monthly benefit records have no end date; coverage is open (blank).
        coverageEnd: "",
      };
      out.push({
        pk: wmb.id,
        ...shared,
        memDep: "M",
        depAcct: String(subscriber.workerSiriusId ?? ""),
        depRel: "01",
        memberName: displayName(subscriber),
        memberSsn: padSsn(subscriber.ssn),
        lastName: subscriber.familyName ?? "",
        firstName: subscriber.givenName ?? "",
        middleInitial: (subscriber.middleName ?? "").slice(0, 1),
        birthDate: ymdCompact(subscriber.birthDate),
        sex: mlkSex(subscriber.genderCode),
        email: subscriber.email ?? "",
        ...mlkAddressFields(subscriber, subscriber, false),
      });
      for (const dep of unit.dependents) {
        out.push({
          pk: `${wmb.id}:${dep.relationId}`,
          ...shared,
          memDep: "D",
          depAcct: String(dep.workerSiriusId ?? ""),
          depRel: mlkDepRel(dep.relationSiriusId),
          memberName: displayName(dep),
          memberSsn: padSsn(dep.ssn),
          lastName: dep.familyName ?? "",
          firstName: dep.givenName ?? "",
          middleInitial: (dep.middleName ?? "").slice(0, 1),
          birthDate: ymdCompact(dep.birthDate),
          sex: mlkSex(dep.genderCode),
          email: dep.email ?? "",
          ...mlkAddressFields(dep, subscriber, isQmscoRelation(dep.relationSiriusId)),
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
    return `MLK_${stamp}.csv`;
  },
});
