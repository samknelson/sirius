/**
 * Deliberately narrow report projections. Never copy arbitrary loader detail,
 * compared values or stderr into persisted failure evidence.
 */
export const DIAGNOSTIC_SAMPLE_LIMIT = 25;
export const CONTACT_WORKER_ASSERTIONS = [
  "contact_mapping_missing", "contact_row_missing", "placeholder_email_present",
  "shared_email_owner_missing", "shared_email_nonowner_present",
  "worker_mapping_missing", "worker_still_stub", "worker_row_missing",
  "worker_sirius_id_mismatch", "worker_source_sirius_id_invalid",
  "worker_legacy_nid_missing", "worker_contact_mismatch", "worker_ssn_mismatch",
  "worker_ssn_transfer_ownership",
] as const;
type Assertion = typeof CONTACT_WORKER_ASSERTIONS[number];
type Sample = { code: Assertion; contactNid?: number; workerNid?: number;
  contactId?: string; workerId?: string; relatedContactNid?: number;
  expectedContactId?: string; affectedContacts?: number; ownerCount?: number };
export interface VerificationDiagnostics {
  counts: Partial<Record<Assertion, number>>;
  samples: Sample[];
  sampleLimit: number;
  samplesTruncated: boolean;
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function safeSample(v: unknown): Record<string, number | string> {
  const row = object(v), out: Record<string, number | string> = {};
  for (const key of ["contactNid", "workerNid", "relatedContactNid", "affectedContacts", "ownerCount",
    "nid", "ledgerId", "accountNid", "payerNid", "tid"]) {
    if (count(row[key])) out[key] = row[key];
  }
  for (const key of ["contactId", "workerId", "expectedContactId", "rowId", "paymentId"]) {
    if (uuid(row[key])) out[key] = row[key];
  }
  return out;
}
export class VerificationEvidence {
  failures = 0;
  private counts: VerificationDiagnostics["counts"] = {};
  private samples: Sample[] = [];
  add(code: Assertion, identifiers: Omit<Sample, "code"> = {}) {
    this.failures++;
    this.counts[code] = (this.counts[code] ?? 0) + 1;
    if (this.samples.length < DIAGNOSTIC_SAMPLE_LIMIT) {
      this.samples.push({ code, ...safeSample(identifiers) });
    }
  }
  report(): VerificationDiagnostics {
    return { counts: { ...this.counts }, samples: [...this.samples],
      sampleLimit: DIAGNOSTIC_SAMPLE_LIMIT, samplesTruncated: this.failures > this.samples.length };
  }
}
/** Also narrows received envelopes; optional for older/unrelated loaders. */
export function projectVerificationDiagnostics(value: unknown): VerificationDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = object(value), counts: VerificationDiagnostics["counts"] = {};
  for (const code of CONTACT_WORKER_ASSERTIONS) {
    if (count(object(v.counts)[code])) counts[code] = object(v.counts)[code] as number;
  }
  const raw = Array.isArray(v.samples) ? v.samples : [];
  const samples = raw.slice(0, DIAGNOSTIC_SAMPLE_LIMIT).flatMap(s => {
    const code = object(s).code as Assertion;
    return CONTACT_WORKER_ASSERTIONS.includes(code) ? [{ code, ...safeSample(s) }] : [];
  });
  return { counts, samples, sampleLimit: DIAGNOSTIC_SAMPLE_LIMIT,
    samplesTruncated: v.samplesTruncated === true ||
      Object.values(counts).reduce((sum, n) => sum + n, 0) > samples.length };
}
const PAYMENT_REASONS = [
  "status_missing", "status_unmapped", "amount_missing", "bad_amount", "date_missing", "bad_date",
  "account_ref_missing", "account_unensured", "payer_ref_missing", "payer_unmapped",
  "payment_type_missing", "payment_type_term_unmapped", "payment_type_option_missing",
  "currency_mismatch", "payment_create_failed", "payment_update_failed", "mapped_row_missing",
  "historical_identity_repair_required",
];
const MISMATCH_REASONS = [
  "ar_bad_amount", "ar_account_ref_missing", "ar_account_unmapped", "ar_missing_in_s2",
  "ar_amount_mismatch", "ar_account_mismatch", "ar_extra_in_s2", "ar_unparsable_key",
  "payment_status_missing", "payment_status_unmapped", "payment_amount_missing", "payment_bad_amount",
  "payment_account_ref_missing", "payment_account_unmapped", "payment_missing_in_s2",
  "payment_amount_mismatch", "payment_status_mismatch", "payment_account_mismatch",
  "payment_extra_in_s2", "payment_provenance_missing", "payment_duplicate_in_s2",
];
function reasonEvidence(countsValue: unknown, samplesValue: unknown, reasons: string[]) {
  const counts: Record<string, number> = {}, samples: Record<string, unknown[]> = {};
  const samplesTruncated: Record<string, boolean> = {};
  for (const reason of reasons) {
    const n = object(countsValue)[reason];
    if (!count(n)) continue;
    counts[reason] = n;
    const raw = object(samplesValue)[reason];
    samples[reason] = Array.isArray(raw) ? raw.slice(0, DIAGNOSTIC_SAMPLE_LIMIT).map(safeSample) : [];
    samplesTruncated[reason] = n > samples[reason].length;
  }
  return { counts, samples, sampleLimit: DIAGNOSTIC_SAMPLE_LIMIT, samplesTruncated };
}
export function projectPaymentRejects(counts: unknown, detail: unknown) {
  return reasonEvidence(counts, object(detail).rejectSamples, PAYMENT_REASONS);
}
const money = (v: unknown) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v) && v.length < 40;
function stream(value: unknown) {
  const v = object(value), out: Record<string, unknown> = {};
  for (const k of ["s1Count", "s2Count"]) if (count(v[k])) out[k] = v[k];
  if (typeof v.driftCents === "number" && Number.isSafeInteger(v.driftCents)) out.driftCents = v.driftCents;
  for (const k of ["s1Sum", "s2Sum"]) if (money(v[k])) out[k] = v[k];
  return out;
}
function drift(value: unknown) {
  const v = object(value), out: Record<string, unknown> = { ar: stream(v.ar), payments: stream(v.payments) };
  for (const k of ["netS1", "netS2"]) if (money(v[k])) out[k] = v[k];
  return out;
}
/** The harness owns these fixed messages. Refuse any other text, not redact-and-copy. */
function safeBalanceFailure(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 240) return false;
  if (v === "financial participant/payer identity or per-entity/account attribution mismatch") return true;
  const mismatch = /^mismatch class not allowed: ([a-z_]+)=\d+$/.exec(v);
  if (mismatch) return MISMATCH_REASONS.includes(mismatch[1]);
  return /^(aggregate|account [0-9a-f-]{36}): drift beyond tolerance \(\d+c\) — ar=-?\d+\.\d{2} payments=-?\d+\.\d{2}$/i.test(v);
}
export function projectBalanceDiagnostics(value: unknown) {
  const v = object(value);
  const reasons = reasonEvidence(v.mismatches, v.mismatchSamples, MISMATCH_REASONS);
  const accounts = Array.isArray(v.perAccount) ? v.perAccount : [];
  // Prioritize failed accounts when a pathological report exceeds the cap.
  const ordered = [...accounts.filter(a => object(a).ok === false), ...accounts.filter(a => object(a).ok !== false)];
  const rawFailures = Array.isArray(v.failures) ? v.failures : [];
  return {
    failures: rawFailures.filter(safeBalanceFailure).slice(0, DIAGNOSTIC_SAMPLE_LIMIT),
    failureCount: rawFailures.length,
    failuresTruncated: rawFailures.length > DIAGNOSTIC_SAMPLE_LIMIT,
    mismatches: reasons.counts, mismatchSamples: reasons.samples,
    sampleLimit: reasons.sampleLimit, samplesTruncated: reasons.samplesTruncated,
    aggregate: drift(v.aggregate), unattributed: drift(v.unattributed),
    perAccount: ordered.slice(0, DIAGNOSTIC_SAMPLE_LIMIT).flatMap(a => {
      const row = object(a);
      return uuid(row.accountId) ? [{ accountId: row.accountId, ...drift(row),
        ...(typeof row.ok === "boolean" ? { ok: row.ok } : {}) }] : [];
    }),
    accountCount: accounts.length, accountsTruncated: accounts.length > DIAGNOSTIC_SAMPLE_LIMIT,
  };
}
