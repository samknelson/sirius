/** SSN list filters are body-only. Invalid fragments must never turn into an unfiltered list. */
export class WorkerSsnFilterError extends Error {
  constructor() {
    super("Enter a full SSN or exactly the last four digits.");
  }
}

export type WorkerSsnFilter = { mode: "full" | "last4"; digits: string };

export function parseWorkerSsnFilter(value: unknown): WorkerSsnFilter {
  if (typeof value !== "string" || !/^[\d\s-]+$/.test(value)) {
    throw new WorkerSsnFilterError();
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length === 9) return { mode: "full", digits };
  if (digits.length === 4) return { mode: "last4", digits };
  throw new WorkerSsnFilterError();
}