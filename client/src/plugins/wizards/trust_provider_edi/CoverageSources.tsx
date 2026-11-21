import { useId, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/queryClient";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { WizardProgress } from "@/components/wizards/framework/WizardProgress";
import {
  EDI_COVERAGE_REASONS, type EdiCoverageCandidate, type EdiCoverageDecision, type EdiCoverageEntryReason,
  type EdiCoverageReview,
} from "@shared/edi-coverage-choices";
import { useCoverageReview } from "./use-coverage-review";
import { CoverageEntryList, ExclusionDownload, RULE_TEXT, formatWhen } from "./CoverageEntries";

function CandidateDetails({ candidate }: { candidate: EdiCoverageCandidate }) {
  const fields: [string, string | number | null][] = [
    ["Candidate ID", candidate.id],
    ["Person", candidate.personLabel], ["Worker ID", candidate.workerId],
    ["Benefit", candidate.benefitLabel], ["Benefit ID", candidate.benefitId],
    ["Year", candidate.year], ["Month", candidate.month],
    ["Employer", candidate.employerLabel], ["Employer ID", candidate.employerId],
    ["Employer Sirius ID", candidate.employerSiriusId],
    ["Subscriber", candidate.subscriberLabel], ["Subscriber worker ID", candidate.subscriberWorkerId],
    ["Class", candidate.isCobra ? "COBRA" : "Non-COBRA"],
    ["Source relation ID", candidate.sourceRelationId],
    ["Family issue", candidate.familyIssue],
  ];
  return <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
    {fields.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value === null || value === "" ? "None" : value}</dd>
    </div>)}
  </dl>;
}

function Audit({ decision }: { decision: EdiCoverageDecision }) {
  const date = new Date(decision.decidedAt);
  return <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
    <p className="whitespace-pre-wrap break-words"><span className="font-medium">Saved reason: </span>{decision.reason}</p>
    <p className="break-words text-xs text-muted-foreground">
      Decided by {decision.decidedBy} · <time dateTime={decision.decidedAt}>
        {Number.isNaN(date.getTime()) ? decision.decidedAt : date.toLocaleString()}
      </time>
    </p>
  </div>;
}

function Snapshot({ decision }: { decision: EdiCoverageDecision }) {
  return <details className="rounded-md border bg-muted/20 p-4">
    <summary className="cursor-pointer break-words text-sm font-medium">{decision.key}</summary>
    <div className="mt-4 space-y-3">
      <Audit decision={decision} />
      <p className="break-all text-xs text-muted-foreground">Selected candidate ID: {decision.selectedId}</p>
      {decision.candidates.map(candidate => <div key={candidate.id} className="rounded-md border p-3">
        <Badge variant={candidate.id === decision.selectedId ? "secondary" : "outline"}>
          {candidate.id === decision.selectedId ? "Source chosen at the time" : "Source not chosen"}
        </Badge>
        <CandidateDetails candidate={candidate} />
      </div>)}
    </div>
  </details>;
}


/** The acknowledgement names the exact list on screen; a changed list needs a new one. */
function Acknowledgement({ review, locked, pending, onAcknowledge }: {
  review: EdiCoverageReview; locked: boolean; pending: boolean; onAcknowledge: () => void;
}) {
  const id = useId();
  const [checked, setChecked] = useState(false);
  const count = review.exclusionCount ?? 0;
  if (review.acknowledgement) return <p role="status" data-testid="text-acknowledged"
    className="flex items-start gap-2 rounded-md border p-3 text-sm">
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
    <span className="break-words">
      Exclusion list acknowledged by {review.acknowledgement.acknowledgedBy} · <time dateTime={review.acknowledgement.acknowledgedAt}>
        {formatWhen(review.acknowledgement.acknowledgedAt)}</time>. Select Next to continue to Generate.
      Generation reads coverage again and stops if this list has changed.
    </span>
  </p>;
  return <div className="space-y-3 rounded-md border border-destructive/50 p-4">
    <p className="flex items-start gap-2 text-sm font-medium">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <span>A member left out of a replacement membership file may have their coverage ended by the carrier.</span>
    </p>
    <p className="text-sm text-muted-foreground">
      Review every entry under Excluded from this file. To keep a person in the file, correct their coverage records
      and check again. This check and this file never change coverage records.
    </p>
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} disabled={locked || pending}
        onCheckedChange={value => setChecked(value === true)} data-testid="checkbox-acknowledge" />
      <Label htmlFor={id} className="leading-snug">
        I have reviewed the {count} excluded coverage record group{count === 1 ? "" : "s"} and accept that
        these people are left out of this file.
      </Label>
    </div>
    <Button disabled={locked || pending || !checked} onClick={onAcknowledge} data-testid="button-acknowledge">
      {pending ? "Saving acknowledgement…" : "Acknowledge exclusion list"}
    </Button>
  </div>;
}

export function CoverageSources({ wizardId, data }: WizardStepComponentProps) {
  const { review, acknowledge, refresh, running, generating, statusUnavailable, statusLoading, progress, start, ready } = useCoverageReview(wizardId);
  const locked = running || start.isPending || !ready || data?.progress?.run?.status === "in_progress" || statusUnavailable || review.isFetching || review.isError;
  const current = ready && review.data?.applicable ? review.data : null;
  const reasons = Object.entries(current?.byReason ?? {}) as [EdiCoverageEntryReason, number][];
  return <div className="space-y-5">
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Coverage sources</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={(!statusUnavailable && running) || start.isPending || acknowledge.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />{statusUnavailable ? "Refresh status" : "Check coverage again"}
          </Button>
        </div>
        <CardDescription>
          See which coverage records this file leaves out, and why, before generating. Nothing is chosen by hand,
          and coverage records are never changed here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {generating && <Alert><AlertDescription>Generation is active. This step is read-only until generation finishes.</AlertDescription></Alert>}
        {statusUnavailable && !statusLoading && <Alert variant="destructive"><AlertDescription>Current status is unavailable. This does not mean the work failed. Actions are disabled; use Refresh status to reconnect.</AlertDescription></Alert>}
        {(statusLoading || (!statusUnavailable && start.isPending && !running)) &&
          <WizardProgress label="Coverage check admission"
            activity={statusLoading ? "Loading coverage status…" : "Confirming coverage check admission…"} />}
        {!statusUnavailable && progress?.status === "in_progress" && <div className="space-y-2">
          <WizardProgress label="Coverage check progress" percentComplete={progress.percentComplete}
            activity="Checking coverage…" phase={progress.phase}
            counts={progress.total && progress.total > 0
              ? `${progress.processed ?? 0}/${progress.total}`
              : progress.processed && progress.processed > 0 ? `${progress.processed} processed` : undefined} />
          <p className="text-sm text-muted-foreground">Acknowledgement, settings and generation are blocked while checking. You may leave and return to this run.</p>
          {(!Number.isFinite(Date.parse(progress.heartbeatAt ?? "")) || Date.now() - Date.parse(progress.heartbeatAt!) > 120000) &&
            <p>Heartbeat is missing or stale. Work may be interrupted; do not start another check. Ask an administrator to investigate.</p>}
        </div>}
        {!statusUnavailable && progress?.status === "failed" && <Alert variant="destructive"><AlertDescription>
          <p className="font-medium">Saved failed coverage check</p>
          <p className="text-sm">
            {progress.failedAt ? <>Finished <time dateTime={progress.failedAt}>{formatWhen(progress.failedAt)}</time>. </>
              : progress.startedAt ? <>Started <time dateTime={progress.startedAt}>{formatWhen(progress.startedAt)}</time>; finish time was not recorded. </>
                : "This older check has no recorded observation time. "}
            These are historical results, not live maintenance counts.
          </p>
          <span className="whitespace-pre-wrap break-words">{progress.error || "The coverage check failed."}</span>{" "}
          Nothing was excluded or acknowledged. Resolve what the message names, then use Check coverage again.
        </AlertDescription></Alert>}
        {start.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(start.error, "Could not confirm coverage check admission.")}</AlertDescription></Alert>}
        {review.isLoading && !running && <div role="status" aria-label="Loading coverage sources" className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {review.isError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>
          {getApiErrorMessage(review.error, "Could not load coverage sources.")} Use Check coverage again to retry.
        </AlertDescription></Alert>}
        {acknowledge.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(acknowledge.error, "Could not save the acknowledgement.")} Review the refreshed list before trying again.</AlertDescription></Alert>}
        {review.data && ready && !review.data.applicable &&
          <p className="rounded-md bg-muted/50 p-4 text-sm">Not applicable. This hours-only configuration does not read coverage sources.</p>}
        {current && <div className="space-y-3">
          <p className="rounded-md bg-muted/50 p-3 text-sm" data-testid="text-coverage-rule">{current.rule ? RULE_TEXT[current.rule] : ""}</p>
          <p role="status" className="text-sm" data-testid="text-coverage-summary">
            {current.exclusionCount
              ? `${current.exclusionCount} coverage record group${current.exclusionCount === 1 ? " is" : "s are"} left out of this file.`
              : "No coverage is left out of this file. You can continue to Generate."}
            {!!current.warningCount && ` ${current.warningCount} warning${current.warningCount === 1 ? "" : "s"} to review (not excluded).`}
            {current.population != null && ` Checked ${current.population} ${current.population === 1 ? "person" : "people"}`}
            {current.checkedAt && <> on <time dateTime={current.checkedAt}>{formatWhen(current.checkedAt)}</time>.</>}
          </p>
          {!!reasons.length && <ul className="flex flex-wrap gap-2">
            {reasons.map(([reason, count]) => <li key={reason}><Badge variant="outline">{EDI_COVERAGE_REASONS[reason].label}: {count}</Badge></li>)}
          </ul>}
          {(!!current.exclusionCount || !!current.warningCount) && <ExclusionDownload wizardId={wizardId} stepId="coverage" />}
          {!!current.exclusionCount && <Acknowledgement key={current.exclusionDigest} review={current}
            locked={locked} pending={acknowledge.isPending} onAcknowledge={() => acknowledge.mutate()} />}
        </div>}
      </CardContent>
    </Card>
    {current && (!!current.exclusionCount || !!current.warningCount) && <Card>
      <CardContent className="space-y-8 pt-6">
        <CoverageEntryList title="Excluded from this file" entries={current.exclusions} total={current.exclusionCount ?? 0}
          empty="Nothing is excluded." />
        <CoverageEntryList title="Warnings (not excluded)" entries={current.warnings} total={current.warningCount ?? 0}
          empty="No warnings." />
      </CardContent>
    </Card>}
    {current?.generated && <Card>
      <CardHeader><CardTitle className="text-base">Generated file</CardTitle>
        <CardDescription>
          The file generated from this run left out {current.generated.exclusionCount} coverage record group(s)
          {current.generated.exclusionDigest === current.exclusionDigest
            ? ", the same list shown above." : ". The list above has changed since; regenerate before sending."}{" "}
          {RULE_TEXT[current.generated.rule]}
        </CardDescription></CardHeader>
    </Card>}
    {!!review.data?.legacyDecisions?.length && <Card>
      <CardHeader><CardTitle className="text-base">Earlier manual source decisions</CardTitle>
        <CardDescription>
          Saved before conflicting coverage was excluded automatically. Read-only: these choices are kept for the
          record and are not applied when this run is generated again.
        </CardDescription></CardHeader>
      <CardContent className="space-y-3">{review.data.legacyDecisions.map((decision, index) => <Snapshot key={`${decision.key}-${index}`} decision={decision} />)}</CardContent>
    </Card>}
  </div>;
}
