import { z } from "zod";

export const EMPLOYER_SUBMITTED = "employer_submitted" as const;
export const paymentStatuses = ["draft", EMPLOYER_SUBMITTED, "canceled", "cleared", "error"] as const;
export function paymentStatusLabel(status: string) {
  return status === EMPLOYER_SUBMITTED ? "Employer submitted — awaiting review" : status.charAt(0).toUpperCase() + status.slice(1);
}

// Ledger amounts have two decimal places. Never use floating point for comparisons.
export function ledgerMinor(value: string): bigint {
  if (!/^-?\d{1,8}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a valid amount with at most two decimal places.");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (value.startsWith("-") ? -1n : 1n);
}
export function ledgerDecimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export function legalPaymentMinor(value: string, currency: string): bigint {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Check and wire payments require a configured financial currency.");
  const precision = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (precision === 0 && ledgerMinor(value) % 100n !== 0n) throw new Error(`Amounts in ${currency} must be whole numbers.`);
  return ledgerMinor(value);
}

export const legalRemittanceSchema = z.object({
  amount: z.string().trim().max(30).default(""),
  method: z.enum(["check", "wire"]).optional(),
  paymentType: z.string().max(100).optional(),
  merchant: z.string().trim().max(200).optional(),
  checkTransactionNumber: z.string().trim().max(200).optional(),
  timing: z.enum(["planned", "already_sent"]).optional(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")).optional(),
  bankNickname: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict();
export type LegalRemittance = z.infer<typeof legalRemittanceSchema>;

export interface LegalChargeGroup {
  eaId: string;
  accountId: string;
  accountName: string;
  currency: string;
  amount: string;
  entries: number;
  invoicePaths: string[];
}

export interface LegalPopulation {
  totalRows: number;
  distinctWorkers: number;
  unresolvedRows: number;
  unresolvedIdentityRows: number;
  unconfirmedWorkers: number;
  confirmedWorkers: number;
  workersWithBenefits: number;
  workersWithoutBenefits: number;
  benefitReadFailures: number;
  existingGrants: number;
  contactDifferences: { workers: number; email: number; phone: number; address: number; failedWorkers: number; unconfirmedWorkers: number };
  benefits: Array<{ benefitId: string; year: number; month: number; withBenefit: number; withoutBenefit: number; unresolvedWorkers: number }>;
}

export interface LegalConfirmationData {
  completed: boolean;
  historical: boolean;
  population: LegalPopulation | null;
  totals: { newWorkers: number; newGrants: number; workersWithNewGrants: number; processedRows: number; failedRows: number; chargeFailures: number; chargeReadFailed: boolean; unpriceableGrants: number | null } | null;
  accounts: Array<LegalChargeGroup & {
    balance: string | null;
    error?: string;
    invoiceSummaryPath: string;
    methods: Array<{ id: string; name: string; method: "check" | "wire" }>;
    draft: LegalRemittance | null;
    payment: { id: string; status: string; amount: string; paymentType: string; details: unknown } | null;
  }>;
}
