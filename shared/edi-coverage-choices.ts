/** Run-owned EDI evidence, not source coverage corrections. */
export interface EdiCoverageCandidate {
  id: string;
  workerId: string;
  benefitId: string;
  year: number;
  month: number;
  employerId: string;
  employerSiriusId: string | null;
  sourceRelationId: string | null;
  personLabel: string;
  benefitLabel: string;
  employerLabel: string;
  subscriberLabel: string;
  subscriberWorkerId: string | null;
  isCobra: boolean;
  familyIssue: string | null;
}
export interface EdiCoverageDecision {
  key: string;
  evidence: string;
  selectedId: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  candidates: EdiCoverageCandidate[];
}
export interface EdiCoverageConflict {
  key: string;
  evidence: string;
  candidates: EdiCoverageCandidate[];
  decision: EdiCoverageDecision | null;
  stale: boolean;
}
export interface EdiCoverageReview {
  ready?: boolean;
  fingerprint?: string;
  revision?: string;
  applicable: boolean;
  conflicts: EdiCoverageConflict[];
  decisionsUsed: EdiCoverageDecision[];
}
