import { createHash } from "node:crypto";
import type {
  EdiCoverageEntry, EdiCoverageEntryReason, EdiCoverageExclusionReason, EdiCoverageRule,
} from "@shared/edi-coverage-choices";
import { isEdiCobra, type SegmentCoverage } from "./coverage-segments";
import { monthEnd, monthIndex, monthStart } from "./termination-policy";
import type { SegmentStart } from "./coverage-starts";
import type { CoverageBudget } from "./coverage-budget";

/**
 * The conflict rule for carrier feeds. Pure: no database, no settings read.
 *
 * A conflict is more than one coverage record for the same person, benefit and
 * month with a different subscriber/dependent source or COBRA classification.
 * Source coverage records are never changed; a feed only decides what it reads.
 */
export type EvidenceRow = SegmentCoverage & { employerSiriusId: string | null };
export interface EvidenceRelation {
  id: string; worker1: string; worker2: string;
  startYmd: string | null; endYmd: string | null;
  relationType?: string | null; dataFingerprint?: string | null;
}

export const coverageKey = (r: Pick<SegmentCoverage, "workerId" | "benefitId" | "year" | "month">) =>
  `${r.workerId}|${r.benefitId}|${r.year}-${String(r.month).padStart(2, "0")}`;

const classOf = (r: SegmentCoverage) => `${r.sourceRelationId ?? ""}|${isEdiCobra(r.employerSiriusId)}`;
export function competingSources(rows: readonly SegmentCoverage[]): boolean {
  return new Set(rows.map(classOf)).size > 1;
}

/** The family relationship names this dependent and overlaps the coverage month. */
export function relationCoversMonth(relation: EvidenceRelation | undefined, row: SegmentCoverage): relation is EvidenceRelation {
  if (!relation || relation.worker2 !== row.workerId) return false;
  const index = monthIndex(row.year, row.month);
  return !(relation.startYmd && relation.startYmd > monthEnd(index)) &&
    !(relation.endYmd && relation.endYmd < monthStart(index));
}

/** Every record of one person, benefit and month that a feed leaves out, and why. */
export interface ExcludedGroup {
  reason: EdiCoverageEntryReason;
  rows: EvidenceRow[];
}
/**
 * Never excluded, with the temporary rule on or off: a dependent whose
 * subscriber holds no coverage of their own is not a conflict, and leaving the
 * dependent out would extend the temporary rule to a different data problem.
 */
export interface RefusedGroup {
  reason: EdiCoverageEntryReason | "subscriber-missing";
  rows: EvidenceRow[];
}

/**
 * The months a file uses directly: every candidate of a conflicting month goes,
 * then every dependent whose subscriber's month went with it. One level is
 * enough — a subscriber's own record is never relation-sourced.
 */
export function applyConflictRule(
  rows: readonly EvidenceRow[], relations: ReadonlyMap<string, EvidenceRelation>,
): { excludedIds: Set<string>; groups: ExcludedGroup[]; refused: RefusedGroup[] } {
  const months = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const key = coverageKey(row);
    const group = months.get(key);
    if (group) group.push(row); else months.set(key, [row]);
  }
  const excludedIds = new Set<string>();
  const groups: ExcludedGroup[] = [];
  const refused: RefusedGroup[] = [];
  const sorted = (group: EvidenceRow[]) => [...group].sort((a, b) => a.id.localeCompare(b.id));
  const exclude = (reason: EdiCoverageExclusionReason, group: EvidenceRow[]) => {
    for (const row of group) excludedIds.add(row.id);
    groups.push({ reason, rows: sorted(group) });
  };
  const conflicted = new Set<string>();
  for (const [key, group] of months) if (competingSources(group)) {
    conflicted.add(key);
    exclude("conflicting-coverage", group);
  }
  for (const [key, group] of months) {
    const row = group[0];
    if (conflicted.has(key) || !row.sourceRelationId) continue;
    const relation = relations.get(row.sourceRelationId);
    if (!relationCoversMonth(relation, row)) { refused.push({ reason: "subscriber-missing", rows: sorted(group) }); continue; }
    const parent = coverageKey({ ...row, workerId: relation.worker1 });
    if (conflicted.has(parent)) exclude("subscriber-excluded", group);
    else if (!(months.get(parent) ?? []).some(r => !r.sourceRelationId))
      refused.push({ reason: "subscriber-missing", rows: sorted(group) });
  }
  return { excludedIds, groups, refused };
}

const describeRow = (r: EvidenceRow) =>
  `WMB ${r.id} (employer ${r.employerId}, Sirius ID ${r.employerSiriusId ?? "none"}, ${isEdiCobra(r.employerSiriusId) ? "COBRA" : "non-COBRA"}, ${r.sourceRelationId ? `dependent via relation ${r.sourceRelationId}` : "subscriber"})`;
const REFUSAL: Record<RefusedGroup["reason"], string> = {
  "conflicting-coverage": "conflicting coverage",
  "subscriber-excluded": "dependent of a subscriber with conflicting coverage",
  "subscriber-missing": "dependent whose family relationship or subscriber coverage is missing for the month (standalone subscriber coverage cannot be invented)",
  "termination-conflict": "ended coverage with a conflicting last covered month",
  "termination-subscriber-excluded": "ended dependent whose subscriber has conflicting coverage",
  "family-member-conflict": "family member of an ended subscriber with conflicting coverage in the last covered month",
  "supplemental-conflict": "conflicting supplemental coverage",
  "in-run-conflict": "conflicting coverage earlier in the current coverage run",
};

/** Name the records and exclude nothing. */
export function correctionRequired(groups: readonly RefusedGroup[]): Error {
  const shown = groups.slice(0, 20).map(({ reason, rows }) => {
    const first = rows[0];
    return `${REFUSAL[reason]} for person ${first.workerId}, benefit ${first.benefitId}, coverage month ${monthStart(monthIndex(first.year, first.month)).slice(0, 7)}: ${rows.map(describeRow).join("; ")}`;
  });
  return new Error(`Correction required: ${groups.length} person-month(s) this file uses cannot be reported. ${shown.join(". ")}${groups.length > shown.length ? `. ${groups.length - shown.length} more are not listed here` : ""}. Correct the coverage records and check again; nothing was excluded.`);
}

/** Stable across JSONB key order and query ordering. */
export function evidenceHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(
    Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
  return v;
}

/** Same canonical bytes as evidenceHash, without one large synchronous copy. */
export async function evidenceHashRecords(records: Record<string, Iterable<unknown>>): Promise<string> {
  const hash = createHash("sha256");
  hash.update("{");
  let first = true;
  for (const key of Object.keys(records).sort()) {
    hash.update(`${first ? "" : ","}${JSON.stringify(key)}:[`);
    first = false;
    let i = 0;
    for (const row of records[key]) {
      hash.update(`${i ? "," : ""}${JSON.stringify(canonical(row))}`);
      if (i % 500 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      i++;
    }
    hash.update("]");
  }
  return hash.update("}").digest("hex");
}

/** What a generated run was told to leave out. Order-independent. */
export function exclusionDigest(rule: EdiCoverageRule, entries: readonly EdiCoverageEntry[]): string {
  return evidenceHash({ rule, entries: entries
    .map(e => `${e.reason}|${e.workerId}|${e.benefitId}|${e.month}|${e.records.map(r => r.id).sort().join(",")}`).sort() });
}

/**
 * The bounded evidence one check or one generation works from. Ephemeral:
 * only the lists, the counts and the fingerprint are ever saved with a run.
 */
export interface CoverageEvidence {
  rule: EdiCoverageRule;
  /** Coverage records the run must not read, in any month it uses. */
  excludedIds: ReadonlySet<string>;
  /** Segment starts by anchor coverage record id. */
  starts: Map<string, SegmentStart>;
  /** Null when the run reports no terminations. */
  terminationCandidates: import("./termination-population").TerminationCandidate[] | null;
  exclusions: EdiCoverageEntry[];
  warnings: EdiCoverageEntry[];
  exclusionDigest: string;
  fingerprint: string;
  /** People with coverage in the months this run reads. */
  population: number;
  /** Per-phase wall time, in the order the phases ran. */
  timings: { phase: string; milliseconds: number }[];
  budget: CoverageBudget;
}

/** Applied before every deduplication, suppression and family join. */
export function retainCoverage<T>(rows: readonly T[], evidence: CoverageEvidence | undefined, id: (r: T) => string): T[] {
  return evidence ? rows.filter(r => !evidence.excludedIds.has(id(r))) : [...rows];
}
