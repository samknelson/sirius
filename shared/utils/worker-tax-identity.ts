import { validateSSN } from "./ssn";

/** Stable options row identity as well as machine key; never inferred by name. */
export const ALTERNATE_TAX_ID = "system:alternate-tax-id";
export const ALTERNATE_TAX_NAME = "Alternate Tax ID";

export type TaxIdentity =
  | { kind: "ssn" | "alternate"; value: string }
  | { kind: "review"; message: string };

/** Structural validation only, not proof of issuance, ownership or a new person.
 * Numeric separators are spaces, hyphens, dots and slashes. Letters and other meaningful
 * characters are never stripped/padded/case-folded. Reject known shared markers
 * BEFORE the legacy SSN parser can strip them or pad a repeated-digit dummy.
 */
export function classifyTaxIdentity(input: unknown): TaxIdentity {
  const review = (message: string): TaxIdentity => ({ kind: "review", message });
  if (input == null || String(input).trim() === "") {
    return review("An identifier is required. Correct the SSN column and validate again.");
  }
  if (typeof input !== "string" && (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0)) {
    return review("The identifier is unusable. Supply the original text and validate again.");
  }
  const raw = String(input).trim();
  const marker = raw.toLowerCase().replace(/[\s/_.-]/g, "");
  if (["na", "none", "null", "unknown", "notavailable", "notapplicable", "pending", "tbd", "missing", "dummy", "test"].includes(marker)
    || /^[xX*?#-]+$/.test(raw)) {
    return review("A shared placeholder cannot identify a worker. Correct the identifier and validate again.");
  }
  const numeric = /^[0-9 ./-]+$/.test(raw);
  const value = numeric ? raw.replace(/[ ./-]/g, "") : raw;
  if (/^(\d)\1+$/.test(value) || value === "0") {
    return review("Repeated-digit placeholders require review. Supply a worker-specific identifier and validate again.");
  }
  // Keep the existing short-numeric SSN parsing behaviour; never feed letters
  // through its lossy non-digit stripping.
  if (numeric) {
    const ssn = validateSSN(value);
    if (ssn.valid && ssn.parsed) return { kind: "ssn", value: ssn.parsed };
  }
  if (value.length < 3 || value.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value)
    || !/\d/.test(value)) {
    return review("The identifier is unusable. Supply a worker-specific tax identifier and validate again.");
  }
  return { kind: "alternate", value };
}

export function normalizeAlternateTaxId(input: unknown): string {
  const identity = classifyTaxIdentity(input);
  if (identity.kind !== "alternate") {
    throw new TaxIdentityReviewError(identity.kind === "review" ? identity.message
      : "Enter a structurally valid SSN in the SSN field, not as an Alternate Tax ID.");
  }
  return identity.value;
}

export class TaxIdentityReviewError extends Error {
  readonly status = 400;
}

/** Safe for response previews and audit snapshots, including changed type edits. */
export function redactTaxIdRecord<T extends { typeId?: string; value?: unknown }>(row: T): T {
  return row?.typeId === ALTERNATE_TAX_ID ? { ...row, value: "[REDACTED]" } : row;
}
