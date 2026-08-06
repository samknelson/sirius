/**
 * Shared pieces for the S1→S2 parity harnesses (verify-balance-parity,
 * verify-month-parity) and the T18/T19 loaders: exact cents math, the
 * canonical S1→S2 payment status table, and small CLI flag helpers.
 *
 * Money is compared as integer CENTS, never floats — parity is cents-exact
 * by definition (N6).
 */

/** Staged S1 money format: up to 8 whole digits, optional 1–2 decimals. */
export const AMOUNT_RE = /^-?\d{1,8}(\.\d{1,2})?$/;

/**
 * Decimal string → integer cents (exact; never floats). Tolerant of DB
 * numeric::text renderings ("50", "50.5", "-6421.35") as well as staged
 * verbatim amounts. Returns null for anything non-numeric — callers turn
 * that into a counted mismatch, never a guess.
 */
export function toCents(amount: string): number | null {
  const s = amount.trim();
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const frac = (m[3] ?? "").padEnd(2, "0");
  if (frac.length > 2 && Number(frac.slice(2)) !== 0) return null; // sub-cent precision would be silent corruption
  const cents = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" ? -cents : cents;
}

export const centsToStr = (c: number) =>
  `${c < 0 ? "-" : ""}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// S1 → S2 payment status table (06 §4.18 / T19). Single source of truth:
// the T19 loader writes with it, the balance-parity harness re-derives the
// expected S2 status from it. Unmapped statuses are fatal on both sides.
// ---------------------------------------------------------------------------

export type S2PaymentStatus = "draft" | "canceled" | "cleared" | "error";

export const PAYMENT_STATUS_MAP: Record<
  string,
  { status: S2PaymentStatus; setCleared?: true; setReceived?: true }
> = {
  cleared: { status: "cleared", setCleared: true },
  canceled: { status: "canceled" },
  failed: { status: "error" },
  pending: { status: "draft" },
  received: { status: "draft", setReceived: true },
};

// ---------------------------------------------------------------------------
// CLI flag helpers (loader-convention argv parsing, no dependency)
// ---------------------------------------------------------------------------

export function flagValue(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

export function listFlag(name: string): string[] {
  const v = flagValue(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export function intFlag(name: string, def: number): number {
  const v = flagValue(name);
  if (v == null) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${v}"`);
  return n;
}

export function numFlag(name: string): number | null {
  const v = flagValue(name);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${v}"`);
  return n;
}

// ---------------------------------------------------------------------------
// Per-stream parity aggregation (balance harness)
// ---------------------------------------------------------------------------

export interface StreamAgg {
  s1Count: number;
  s1Cents: number;
  s2Count: number;
  s2Cents: number;
}

export const emptyStream = (): StreamAgg => ({ s1Count: 0, s1Cents: 0, s2Count: 0, s2Cents: 0 });

export function addS1(a: StreamAgg, cents: number) {
  a.s1Count++;
  a.s1Cents += cents;
}
export function addS2(a: StreamAgg, cents: number) {
  a.s2Count++;
  a.s2Cents += cents;
}

export function streamReport(a: StreamAgg) {
  return {
    s1Count: a.s1Count,
    s2Count: a.s2Count,
    s1Sum: centsToStr(a.s1Cents),
    s2Sum: centsToStr(a.s2Cents),
    driftCents: a.s2Cents - a.s1Cents,
  };
}
