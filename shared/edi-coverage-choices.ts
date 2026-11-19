/** Run-owned EDI evidence, not source coverage corrections. */

/** Which rule applied when a check or a generated run read coverage. */
export type EdiCoverageRule = "exclude-conflicting" | "refuse-conflicting";

/** Code-defined values kept inside run-owned data; never a stored option. */
export type EdiCoverageExclusionReason =
  | "conflicting-coverage"
  | "subscriber-excluded"
  | "termination-conflict"
  | "termination-subscriber-excluded"
  | "family-member-conflict"
  | "supplemental-conflict";
export type EdiCoverageEntryReason = EdiCoverageExclusionReason | "in-run-conflict";

/** One wording for the screen, the download and the built-in help. */
export const EDI_COVERAGE_REASONS: Record<EdiCoverageEntryReason, { label: string; meaning: string }> = {
  "conflicting-coverage": {
    label: "Conflicting coverage",
    meaning: "The person has more than one coverage record for this benefit and month with a different subscriber or dependent source, or a different COBRA classification. Every record for the month was left out of the file.",
  },
  "subscriber-excluded": {
    label: "Subscriber excluded",
    meaning: "The dependent's subscriber was left out of the file for this month because of conflicting coverage, so the dependent was left out as well.",
  },
  "termination-conflict": {
    label: "Termination not reported: conflicting last month",
    meaning: "The person's coverage ended, but their last covered month has conflicting records, so no termination was reported for them.",
  },
  "termination-subscriber-excluded": {
    label: "Termination not reported: subscriber conflict",
    meaning: "The dependent's coverage ended, but the subscriber's coverage for the last covered month has conflicting records, so no termination was reported for the dependent.",
  },
  "family-member-conflict": {
    label: "Family member not counted: conflicting last month",
    meaning: "A family member covered alongside someone whose coverage ended has conflicting records for that last covered month. The family member was left out when the ended family's coverage counts and tier were worked out; the termination itself is still reported.",
  },
  "supplemental-conflict": {
    label: "Supplemental coverage not used",
    meaning: "The member stays in the file. Their conflicting coverage for another benefit was not used to work out plan or tier fields.",
  },
  "in-run-conflict": {
    label: "Earlier conflict in the current coverage run",
    meaning: "An earlier month of the person's current coverage run has conflicting records. A record of the member's own class exists in that month, so the coverage start date is unchanged and the member stays in the file.",
  },
};

/** One coverage record named by an exclusion or a warning. */
export interface EdiCoverageRecord {
  id: string;
  employerId: string;
  employerLabel: string;
  employerSiriusId: string | null;
  /** Null for the person's own (subscriber) coverage. */
  sourceRelationId: string | null;
  subscriberWorkerId: string | null;
  subscriberLabel: string;
  isCobra: boolean;
}
/** One person, benefit and coverage month, with every record involved. */
export interface EdiCoverageEntry {
  kind: "exclusion" | "warning";
  reason: EdiCoverageEntryReason;
  workerId: string;
  personLabel: string;
  benefitId: string;
  benefitLabel: string;
  /** yyyy-mm */
  month: string;
  records: EdiCoverageRecord[];
}
/**
 * A conflict listed outside any feed run (the Conflicting Coverage report).
 * No file is involved, so nothing was excluded and no reason applies.
 */
export type EdiCoverageConflict = Omit<EdiCoverageEntry, "kind" | "reason">;
/** What the Conflicting Coverage report's Results step reads. */
export type EdiCoverageConflictReport = { generated: false } | {
  generated: true;
  generatedAt: string;
  /** yyyy-mm, inclusive. */
  fromMonth: string;
  toMonth: string;
  conflictCount: number;
  /** Coverage records named by the conflicts. */
  recordCount: number;
  peopleCount: number;
  /** The feed rule in force when the list is viewed. */
  rule: EdiCoverageRule;
  conflicts: EdiCoverageConflict[];
};
export interface EdiCoverageAcknowledgement {
  acknowledgedBy: string;
  acknowledgedAt: string;
  exclusionDigest: string;
  exclusionCount: number;
  rule: EdiCoverageRule;
}
/** Saved with a generated run; small enough to travel with every load. */
export interface EdiCoverageRunSummary {
  rule: EdiCoverageRule;
  exclusionCount: number;
  warningCount: number;
  byReason: Partial<Record<EdiCoverageEntryReason, number>>;
  fingerprint: string;
  exclusionDigest: string;
  acknowledgement: EdiCoverageAcknowledgement | null;
}

/** A source choice saved by an older run. Shown read-only; no longer accepted. */
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

export interface EdiCoverageReview {
  applicable: boolean;
  /** The saved check matches the current settings and rule. */
  ready?: boolean;
  rule?: EdiCoverageRule;
  fingerprint?: string;
  revision?: string;
  checkedAt?: string;
  /** People with coverage in the months the check read. */
  population?: number;
  timings?: { phase: string; milliseconds: number }[];
  exclusionDigest?: string;
  exclusionCount?: number;
  warningCount?: number;
  byReason?: Partial<Record<EdiCoverageEntryReason, number>>;
  /** The saved list was shortened for the screen; the download is complete. */
  shown?: { exclusions: number; warnings: number };
  exclusions: EdiCoverageEntry[];
  warnings: EdiCoverageEntry[];
  acknowledgement: EdiCoverageAcknowledgement | null;
  /** The list saved with the generated file, when one exists. */
  generated: EdiCoverageRunSummary | null;
  legacyDecisions: EdiCoverageDecision[];
}
