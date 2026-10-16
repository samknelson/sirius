/** Read-model provenance only; never writes coverage or scan decisions. */
export type CoverageDecisionSource = "recorded" | "scan" | "import" | "pending" | "unavailable";
export const IMPORTED_COVERAGE_NOTE = "Imported coverage history — scanned in the previous system.";
