/**
 * Carrier-neutral coverage facts. Dates are calendar months (YYYY-MM-01).
 * Storage row IDs are deliberately absent: recomputation may replace them.
 */
export const COVERAGE_SPAN_PLUGIN = "worker-benefit-coverage-spans";
export interface CoverageSourceRecord {
  id: string;
  workerId: string;
  benefitId: string;
  year: number;
  month: number;
  employerId: string;
  employerSiriusId: string | null;
  sourceRelationId: string | null;
}
export interface CoverageFamilyIdentity {
  id: string;
  worker1: string;
  worker2: string;
}
export type CoverageEndingReason = "confirmed-continuation-failure" | "retained-coverage-inference";
export interface CoverageEnding {
  /** First month without coverage, NOT the last covered month. */
  month: string;
  reason: CoverageEndingReason;
  eventId: string;
  eventData: unknown;
  scanId?: string;
}
export interface CoverageSpanFact {
  workerId: string;
  benefitId: string;
  sourceRelationId: string | null;
  subscriberWorkerId: string | null;
  isCobra: boolean;
  startMonth: string;
  /** Class continuity can cross excluded historical months; issues remain visible. */
  continuityStartMonth: string;
  lastCoveredMonth: string;
  usable: boolean;
  ending: CoverageEnding | null;
}
export type CoverageIssueReason =
  | "conflicting-coverage"
  | "subscriber-excluded"
  | "invalid-family-identity"
  | "subscriber-missing"
  | "unsupported-termination"
  | "contradicted-inference"
  | "termination-coverage-missing";
export interface CoverageIssueFact {
  workerId: string;
  benefitId: string;
  month: string;
  reason: CoverageIssueReason;
  records: CoverageSourceRecord[];
  relatedRecords: CoverageSourceRecord[];
  eventId?: string;
  scanId?: string;
}
export interface CoverageSpanPayload {
  spans: CoverageSpanFact[];
  issues: CoverageIssueFact[];
}
