/** Display-only evidence from retained relation-sourced WMBs, not election intent. */
export interface CoveredDependent {
  personId: string;
  name: string;
  /** Label of the retained source relationship; never inferred from today's election. */
  relationship: string | null;
  benefits: Array<{ id: string; name: string; icon: string | null; color: string | null }>;
}

export type DependentCoverageEvidence =
  | { state: "available"; dependents: CoveredDependent[] }
  | { state: "unavailable"; dependents: null };
