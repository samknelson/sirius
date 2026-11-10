/** Database-free contracts shared by the real fleet and scheduler. */
export interface FinancialSyncApprovals {
  payment?: string;
  ar?: string;
  checkpoint?: string;
}

/** Approvals are deliberate, single-use command arguments, never profile data.
 * Refuse malformed/ignored inputs before staging or any target write. */
export function parseFinancialSyncApprovals(argv: string[]): FinancialSyncApprovals {
  const flags = ["--approve-payment-links", "--approve-ledger-links", "--financial-links-checkpoint"];
  if (argv.some(arg => arg === "--approve-financial-links" || arg.startsWith("--approve-financial-links="))) {
    throw new Error("Use stream-specific --approve-payment-links or --approve-ledger-links on sync");
  }
  const values = flags.map(flag => {
    if (argv.some(arg => arg.startsWith(`${flag}=`))) throw new Error(`${flag} requires a separate value`);
    const positions = argv.flatMap((arg, index) => arg === flag ? [index] : []);
    if (positions.length > 1) throw new Error(`${flag} may be supplied only once`);
    if (!positions.length) return undefined;
    const value = argv[positions[0] + 1];
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  });
  const [payment, ar, checkpoint] = values;
  if (!payment && !ar && !checkpoint) return {};
  if (!checkpoint || (!payment && !ar)) throw new Error("Financial-link approval requires a checkpoint and at least one stream hash");
  if ([payment, ar].some(hash => hash !== undefined && !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Financial-link approval requires reviewed stream-specific SHA-256 evidence");
  }
  if (!argv.includes("--skip-stage")) {
    throw new Error("Financial-link approval requires --skip-stage to retain the reviewed staging checkpoint");
  }
  return { payment, ar, checkpoint };
}

export function financialApprovalArgs(stepId: string, approval: FinancialSyncApprovals): string[] {
  const hash = stepId === "payments" ? approval.payment : stepId === "ledger" ? approval.ar : undefined;
  return hash ? ["--approve-financial-links", hash, "--financial-links-checkpoint", approval.checkpoint!] : [];
}

export interface FinancialIdentitySummary {
  status: "pass" | "fail";
  blocked: number;
  mismatched: number;
  attributionMismatches: number;
  counts: Record<string, number>;
}

/** A child's PASS alone cannot stand in for the independent identity audit.
 * Copy aggregates only; never forward rebind candidates or raw row evidence. */
export function financialIdentitySummary(value: unknown): FinancialIdentitySummary {
  if (!value || typeof value !== "object") throw new Error("financial identity evidence missing");
  const v = value as Record<string, unknown>;
  const validCount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const counts = v.counts;
  if (!validCount(v.blocked) || !validCount(v.mismatched) ||
      !counts || typeof counts !== "object" || Array.isArray(counts) ||
      !Object.values(counts).every(validCount) ||
      !validCount((counts as Record<string, unknown>).attribution_mismatches)) {
    throw new Error("financial identity evidence malformed");
  }
  const attributionMismatches = (counts as Record<string, number>).attribution_mismatches;
  return {
    status: v.blocked || v.mismatched || attributionMismatches ? "fail" : "pass",
    blocked: v.blocked, mismatched: v.mismatched, attributionMismatches,
    counts: { ...counts } as Record<string, number>,
  };
}
