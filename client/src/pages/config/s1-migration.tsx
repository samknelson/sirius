/**
 * S1 Migration dashboard (read-only).
 *
 * Pre-flight + results observability for the S1 → S2 migration. Execution
 * lives in the CLI runbook (scripts/s1-migration/RUNBOOK.md) as a one-off
 * task inside the HIPAA boundary — this page only reads staging state,
 * the sirius_id collision pre-scan, run reports, and parity results.
 * Gated: admin + component `sitespecific.bao.s1migration`.
 */
import { useState } from "react";
import { rejectCountsOf } from "@/lib/s1-run-rejects";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  MinusCircle,
  XCircle,
} from "lucide-react";

interface BundleRow {
  bundle: string;
  rows: number;
  lastExtractedAt: string | null;
}
interface IdMapRow {
  entity: string;
  loader: string;
  rows: number;
  stubs: number;
}
interface StatusPayload {
  stagingPresent: boolean;
  bundles: BundleRow[];
  termCount: number | null;
  rawLedgerRows: number | null;
  idMap: IdMapRow[];
  target: {
    policies: number | null;
    trustProviders: number | null;
    trustBenefits: number | null;
    workers: number | null;
    contacts: number | null;
  };
}
interface CollisionsPayload {
  stagingPresent: boolean;
  idMapPresent: boolean;
  stagedClaims: number;
  decisions: SiriusIdOwnershipDecision[];
  decisionsTruncated: boolean;
  actionCounts: Partial<Record<SiriusIdOwnershipAction, number>>;
  hardBlockers: number;
  pendingRekeys: number;
  planHash: string | null;
}
type SiriusIdOwnershipAction =
  | "correct"
  | "new_claim_reserved"
  | "mapped_rekey"
  | "displace_generated"
  | "source_duplicate"
  | "source_id_missing"
  | "source_id_non_numeric"
  | "source_id_out_of_range"
  | "blocked_mapping_missing"
  | "blocked_mapping_ambiguous"
  | "blocked_owner_native"
  | "blocked_owner_mapping_ambiguous"
  | "blocked_owner_entitlement_unknown";
interface SiriusIdOwnershipDecision {
  sourceNid: number;
  siriusId: number | null;
  action: SiriusIdOwnershipAction;
  claimantWorkerId: string | null;
  currentOwnerWorkerId: string | null;
  detail: string;
}
interface RunRow {
  id: number;
  startedAt: string;
  finishedAt: string;
  args: Record<string, unknown>;
  report: Record<string, unknown>;
}
interface RunsPayload {
  stagingPresent: boolean;
  runs: RunRow[];
}

function runName(run: RunRow): string {
  const a = run.args;
  if (typeof a.loader === "string") return a.loader;
  if (typeof a.harness === "string") return a.harness;
  if (run.report && Array.isArray((run.report as { reports?: unknown[] }).reports)) return "stage";
  return "run";
}

/** PASS / FAIL / counters classification from whatever the report recorded. */
function runOutcome(run: RunRow): { label: string; ok: boolean | null } {
  const r = run.report as {
    result?: unknown;
    failures?: unknown[];
    verifyFailures?: unknown;
    mismatches?: unknown;
  };
  if (r.result === "PASS") return { label: "PASS", ok: true };
  if (r.result === "FAIL") return { label: "FAIL", ok: false };
  if (Array.isArray(r.failures)) {
    return r.failures.length === 0
      ? { label: "PASS", ok: true }
      : { label: `FAIL (${r.failures.length})`, ok: false };
  }
  if (typeof r.verifyFailures === "number") {
    return r.verifyFailures === 0
      ? { label: "verified", ok: true }
      : { label: `verify failures: ${r.verifyFailures}`, ok: false };
  }
  if (typeof r.mismatches === "number") {
    return r.mismatches === 0
      ? { label: "counts verified", ok: true }
      : { label: `mismatches: ${r.mismatches}`, ok: false };
  }
  return { label: "completed", ok: null };
}

function rejectsOf(run: RunRow): Record<string, number> {
  return rejectCountsOf(run.report);
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function durationS(run: RunRow): string {
  const a = new Date(run.startedAt).getTime();
  const b = new Date(run.finishedAt).getTime();
  if (isNaN(a) || isNaN(b)) return "—";
  return `${Math.max(0, Math.round((b - a) / 100) / 10)}s`;
}

type CheckState = "pass" | "fail" | "pending";

/** Latest parity run → readiness state; indeterminate outcomes stay pending. */
function parityState(run: RunRow | undefined): CheckState {
  if (!run) return "pending";
  const ok = runOutcome(run).ok;
  if (ok === null) return "pending";
  return ok ? "pass" : "fail";
}
function CheckIcon({ state }: { state: CheckState }) {
  if (state === "pass") return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
  if (state === "fail") return <XCircle className="h-4 w-4 text-destructive" />;
  return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
}

const OWNERSHIP_ACTION_LABEL: Record<SiriusIdOwnershipAction, string> = {
  correct: "Correct",
  new_claim_reserved: "Reserved for new worker",
  mapped_rekey: "Repairable mapped rekey",
  displace_generated: "Repairable generated allocation",
  source_duplicate: "S1 duplicate — blocker",
  source_id_missing: "Missing S1 ID — blocker",
  source_id_non_numeric: "Non-numeric S1 ID — blocker",
  source_id_out_of_range: "Out-of-range S1 ID — blocker",
  blocked_mapping_missing: "Missing mapping — blocker",
  blocked_mapping_ambiguous: "Ambiguous mapping — blocker",
  blocked_owner_native: "Native owner — review blocker",
  blocked_owner_mapping_ambiguous: "Ambiguous owner mapping — blocker",
  blocked_owner_entitlement_unknown: "Owner entitlement unknown — blocker",
};

function isRepairableAction(action: SiriusIdOwnershipAction): boolean {
  return action === "mapped_rekey" || action === "displace_generated";
}

export default function S1MigrationDashboard() {
  usePageTitle("S1 Migration");
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  const statusQ = useQuery<StatusPayload>({ queryKey: ["/api/s1-migration/status"] });
  const collisionsQ = useQuery<CollisionsPayload>({ queryKey: ["/api/s1-migration/collisions"] });
  const runsQ = useQuery<RunsPayload>({ queryKey: ["/api/s1-migration/runs"] });

  const status = statusQ.data;
  const collisions = collisionsQ.data;
  const runs = runsQ.data?.runs ?? [];

  const latestRun = (name: string): RunRow | undefined =>
    runs.find((r) => runName(r) === name);
  const latestBalance = latestRun("verify-balance-parity");
  const latestMonth = latestRun("verify-month-parity");

  const ownershipReady =
    collisions == null
      ? null
      : collisions.hardBlockers === 0 && collisions.pendingRekeys === 0;

  const checks: Array<{ id: string; label: string; state: CheckState; detail: string }> = [
    {
      id: "staging",
      label: "S1 mirrored into staging",
      state: status ? (status.stagingPresent && status.bundles.length > 0 ? "pass" : "fail") : "pending",
      detail: status?.stagingPresent
        ? `${status.bundles.length} bundles, ${status.bundles.reduce((n, b) => n + b.rows, 0)} rows`
        : "run stage.ts --all",
    },
    {
      id: "collisions",
      label: "Sirius ID ownership preflight ready",
      state: ownershipReady == null ? "pending" : ownershipReady ? "pass" : "fail",
      detail:
        ownershipReady === false
          ? collisions && collisions.hardBlockers > 0
            ? `${collisions.hardBlockers} ownership blocker(s) require source-data or mapping review`
            : `${collisions?.pendingRekeys ?? 0} approved repair action(s) must be applied before the ordinary loader runs`
          : collisions
            ? `${collisions.stagedClaims} authoritative staged claims scanned`
            : "",
    },
    {
      id: "trust",
      label: "Trust config derived from staging",
      state: status
        ? (status.target.trustProviders ?? 0) > 0 && (status.target.trustBenefits ?? 0) > 0
          ? "pass"
          : "fail"
        : "pending",
      detail: status
        ? `${status.target.trustProviders ?? 0} providers, ${status.target.trustBenefits ?? 0} benefits`
        : "",
    },
    {
      id: "policies",
      label: "Policies seeded",
      state: status ? ((status.target.policies ?? 0) >= 7 ? "pass" : "fail") : "pending",
      detail: status ? `${status.target.policies ?? 0} of 7 expected` : "",
    },
    {
      id: "workers",
      label: "Workers loaded",
      state: status ? ((status.target.workers ?? 0) > 0 ? "pass" : "fail") : "pending",
      detail: status
        ? `${status.target.workers ?? 0} workers / ${status.target.contacts ?? 0} contacts`
        : "",
    },
    {
      id: "balance-parity",
      label: "Balance parity",
      state: parityState(latestBalance),
      detail: latestBalance
        ? `${runOutcome(latestBalance).label} at ${fmtTs(latestBalance.finishedAt)}`
        : "not yet run",
    },
    {
      id: "month-parity",
      label: "Month parity",
      state: parityState(latestMonth),
      detail: latestMonth
        ? `${runOutcome(latestMonth).label} at ${fmtTs(latestMonth.finishedAt)}`
        : "not yet run",
    },
  ];

  const loading = statusQ.isLoading || collisionsQ.isLoading || runsQ.isLoading;

  return (
    <div className="space-y-6" data-testid="page-s1-migration">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Database className="h-6 w-6" /> S1 Migration
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Read-only pre-flight and results for the S1 → S2 data migration. Execution runs from
          the CLI runbook with app traffic stopped — this page never writes.
        </p>
      </div>

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && (
        <>
          <Card data-testid="card-readiness">
            <CardHeader>
              <CardTitle>Readiness</CardTitle>
              <CardDescription>Gates the run must clear, in runbook order</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2" data-testid={`check-${c.id}`}>
                    <span className="mt-0.5">
                      <CheckIcon state={c.state} />
                    </span>
                    <span className="font-medium">{c.label}</span>
                    <span className="text-sm text-muted-foreground">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="card-collisions">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Sirius ID ownership preflight
                {ownershipReady === false && (
                  <Badge variant="destructive" data-testid="badge-collisions-fatal">
                    action required
                  </Badge>
                )}
                {ownershipReady === true && (
                  <Badge variant="secondary" data-testid="badge-collisions-clean">clean</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Read-only evidence using exact S1 worker mappings. The ordinary contacts/workers
                loader will not apply a repair. Valid S1 member numbers are never changed to
                resolve an S2 migration allocation conflict.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!collisions?.stagingPresent && (
                <p className="text-sm text-muted-foreground">Staging not present yet.</p>
              )}
              {collisions?.stagingPresent && (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="outline">{collisions.stagedClaims} staged claims</Badge>
                    <Badge variant="outline">
                      {collisions.hardBlockers} review blocker{collisions.hardBlockers === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline">
                      {collisions.pendingRekeys} repairable rekey{collisions.pendingRekeys === 1 ? "" : "s"}
                    </Badge>
                    {!collisions.idMapPresent && (
                      <Badge variant="destructive">id_map missing — review required</Badge>
                    )}
                  </div>
                  {collisions.pendingRekeys > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Repairable migration-generated assignments still require the separately
                      approved, hash-checked CLI repair while writers are paused. This page cannot
                      apply changes.
                    </p>
                  )}
                  {collisions.decisionsTruncated && (
                    <p className="text-sm text-muted-foreground">
                      Showing the first 200 ownership decisions — the full diagnostic has more.
                    </p>
                  )}
                  {collisions.decisions.length > 0 && (
                    <Table data-testid="table-collision-duplicates">
                      <TableHeader>
                        <TableRow>
                          <TableHead>S1 worker nid</TableHead>
                          <TableHead>sirius_id</TableHead>
                          <TableHead>Category / intended action</TableHead>
                          <TableHead>Evidence</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {collisions.decisions.map((decision) => (
                          <TableRow key={`${decision.sourceNid}-${decision.siriusId}`}>
                            <TableCell className="font-mono">{decision.sourceNid}</TableCell>
                            <TableCell className="font-mono">{decision.siriusId ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant={
                                decision.action.startsWith("blocked_") ||
                                decision.action === "source_duplicate" ||
                                decision.action.startsWith("source_id_")
                                  ? "destructive"
                                  : isRepairableAction(decision.action) ? "secondary" : "outline"
                              }>
                                {OWNERSHIP_ACTION_LABEL[decision.action]}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{decision.detail}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-staging">
            <CardHeader>
              <CardTitle>Staging mirror</CardTitle>
              <CardDescription>
                {status?.stagingPresent
                  ? `${status.termCount ?? 0} taxonomy terms · ${status.rawLedgerRows ?? 0} raw AR ledger rows`
                  : "s1_staging has not been created on this database"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {status?.stagingPresent && status.bundles.length > 0 && (
                <Table data-testid="table-staging-bundles">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bundle</TableHead>
                      <TableHead className="text-right">Rows</TableHead>
                      <TableHead>Last staged</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.bundles.map((b) => (
                      <TableRow key={b.bundle}>
                        <TableCell className="font-mono">{b.bundle}</TableCell>
                        <TableCell className="text-right">{b.rows}</TableCell>
                        <TableCell>{b.lastExtractedAt ? fmtTs(b.lastExtractedAt) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {status?.stagingPresent && status.idMap.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Load progress (id_map)</p>
                  <Table data-testid="table-idmap">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Entity</TableHead>
                        <TableHead>Loader</TableHead>
                        <TableHead className="text-right">Mapped</TableHead>
                        <TableHead className="text-right">Stubs</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {status.idMap.map((m) => (
                        <TableRow key={`${m.entity}-${m.loader}`}>
                          <TableCell className="font-mono">{m.entity}</TableCell>
                          <TableCell className="font-mono">{m.loader}</TableCell>
                          <TableCell className="text-right">{m.rows}</TableCell>
                          <TableCell className="text-right">{m.stubs}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-runs">
            <CardHeader>
              <CardTitle>Run history</CardTitle>
              <CardDescription>
                Stage, loader, and parity harness reports recorded by each run (most recent first)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runs.length === 0 && (
                <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
              )}
              {runs.length > 0 && (
                <Table data-testid="table-runs">
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead>Run</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Rejects</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const outcome = runOutcome(run);
                      const rejects = rejectsOf(run);
                      const rejectEntries = Object.entries(rejects);
                      const expanded = expandedRun === run.id;
                      const rows = [
                        <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                            <TableCell className="w-8">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setExpandedRun(expanded ? null : run.id)}
                                data-testid={`button-expand-run-${run.id}`}
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-mono">{runName(run)}</TableCell>
                            <TableCell>{fmtTs(run.startedAt)}</TableCell>
                            <TableCell>{durationS(run)}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  outcome.ok === false
                                    ? "destructive"
                                    : outcome.ok
                                      ? "secondary"
                                      : "outline"
                                }
                              >
                                {outcome.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {rejectEntries.length === 0 ? (
                                <span className="text-muted-foreground text-sm">none</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {rejectEntries.map(([reason, count]) => (
                                    <Badge key={reason} variant="outline" className="font-mono">
                                      {reason}: {String(count)}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                        </TableRow>,
                      ];
                      if (expanded) {
                        rows.push(
                          <TableRow key={`${run.id}-detail`}>
                            <TableCell colSpan={6}>
                              <pre
                                className="text-xs bg-muted rounded p-3 overflow-x-auto max-h-96"
                                data-testid={`report-run-${run.id}`}
                              >
                                {JSON.stringify({ args: run.args, report: run.report }, null, 2)}
                              </pre>
                            </TableCell>
                          </TableRow>,
                        );
                      }
                      return rows;
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
