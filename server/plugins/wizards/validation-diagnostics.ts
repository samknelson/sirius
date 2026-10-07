/** Safe phase name only: never relay row values or database error text. */
export class ValidationPhaseError extends Error {
  constructor(readonly phase: "load-parse-map" | "lookups" | "rows", cause: unknown) {
    super(`Validation failed during ${phase}`, { cause });
  }
}
