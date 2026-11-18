import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/queryClient";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import type { EdiCoverageCandidate, EdiCoverageConflict, EdiCoverageDecision } from "@shared/edi-coverage-choices";
import { hasValidCoverageDecision, useCoverageReview } from "./use-coverage-review";

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

function ConflictReview({ conflict, locked, pending, onSave }: {
  conflict: EdiCoverageConflict;
  locked: boolean;
  pending: boolean;
  onSave: (input: { key: string; evidence: string; selectedId: string; reason: string }) => void;
}) {
  const id = useId();
  const valid = hasValidCoverageDecision(conflict);
  const [selectedId, setSelectedId] = useState(valid ? conflict.decision!.selectedId : "");
  const [reason, setReason] = useState(valid ? conflict.decision!.reason : "");
  const selected = conflict.candidates.find(candidate => candidate.id === selectedId);
  return <Card className="overflow-hidden border-l-4 border-l-primary/60">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle className="break-words text-base">
          {conflict.candidates[0]
            ? `${conflict.candidates[0].personLabel} · ${conflict.candidates[0].benefitLabel} · ${conflict.candidates[0].year}-${String(conflict.candidates[0].month).padStart(2, "0")}`
            : "Previously approved coverage is no longer required"}
        </CardTitle>
        <Badge variant={valid ? "secondary" : "outline"}>{conflict.stale ? "Stale — review again" : valid ? "Resolved" : "Unresolved"}</Badge>
      </div>
      <CardDescription>
        Select one source for this coverage. Other sources in this conflict will be excluded from generation.
        <span className="mt-1 block break-all text-xs">Conflict ID: {conflict.key}</span>
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {!conflict.candidates.length && <Alert variant="destructive"><AlertDescription>
        Previously approved evidence is no longer part of this run. Review and save Parameters to clear incompatible approvals, then refresh Coverage sources.
      </AlertDescription></Alert>}
      {conflict.decision && <><Audit decision={conflict.decision} />
        {!valid && <p className="text-sm text-destructive">The saved choice is no longer valid. Review the current evidence and explicitly save a new decision.</p>}
      </>}
      <fieldset disabled={locked || pending} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Coverage source</legend>
        {conflict.candidates.map((candidate, index) => <div key={candidate.id}
          className={`rounded-md border p-4 transition-colors ${selectedId === candidate.id ? "border-primary/60 bg-primary/5" : "bg-card hover:border-primary/40"}`}>
          <div className="flex flex-wrap items-center gap-3">
            <input type="radio" id={`${id}-${index}`} name={id} value={candidate.id}
              checked={selectedId === candidate.id} onChange={() => setSelectedId(candidate.id)}
              disabled={!!candidate.familyIssue} className="h-4 w-4 accent-primary" />
            <Label htmlFor={`${id}-${index}`} className="flex-1 cursor-pointer">{candidate.personLabel} · {candidate.benefitLabel}</Label>
            <Badge variant="outline">{selectedId ? selectedId === candidate.id ? "Selected" : "Excluded" : "Not selected"}</Badge>
          </div>
          <CandidateDetails candidate={candidate} />
          {candidate.familyIssue && <p className="mt-3 text-sm text-destructive">This source cannot be selected until its family issue is corrected.</p>}
        </div>)}
        {!conflict.candidates.length && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No current candidates. Refresh evidence or correct the source coverage before reviewing.</p>}
        <div className="space-y-2 pt-2">
          <Label htmlFor={`${id}-reason`}>Reason for this choice <span className="text-muted-foreground">(required)</span></Label>
          <Textarea id={`${id}-reason`} value={reason} onChange={event => setReason(event.target.value)}
            required placeholder="Explain why this is the correct coverage source." />
        </div>
      </fieldset>
      <p className="text-xs text-muted-foreground">Saving invalidates previously generated output. This decision belongs to this wizard run; it does not change source coverage data.</p>
      <Button disabled={locked || pending || !selected || !!selected.familyIssue || !reason.trim()}
        onClick={() => onSave({ key: conflict.key, evidence: conflict.evidence, selectedId, reason: reason.trim() })}>
        {pending ? "Saving decision…" : "Save decision"}
      </Button>
    </CardContent>
  </Card>;
}

function Snapshot({ decision }: { decision: EdiCoverageDecision }) {
  return <details className="rounded-md border bg-muted/20 p-4">
    <summary className="cursor-pointer break-words text-sm font-medium">{decision.key}</summary>
    <div className="mt-4 space-y-3">
      <Audit decision={decision} />
      <p className="break-all text-xs text-muted-foreground">Selected candidate ID: {decision.selectedId}</p>
      {decision.candidates.map(candidate => <div key={candidate.id} className="rounded-md border p-3">
        <Badge variant={candidate.id === decision.selectedId ? "secondary" : "outline"}>
          {candidate.id === decision.selectedId ? "Selected in report" : "Excluded from report"}
        </Badge>
        <CandidateDetails candidate={candidate} />
      </div>)}
    </div>
  </details>;
}

export function CoverageSources({ wizardId, data }: WizardStepComponentProps) {
  const { review, save, refresh, running, generating, statusUnavailable, progress, start, ready } = useCoverageReview(wizardId);
  const locked = running || start.isPending || !ready || data?.progress?.run?.status === "in_progress" || statusUnavailable || review.isFetching || review.isError;
  return <div className="space-y-5">
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Coverage sources</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={(!statusUnavailable && running) || start.isPending || save.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" />{statusUnavailable ? "Refresh status" : "Refresh evidence"}
          </Button>
        </div>
        <CardDescription>Review competing coverage sources before generating the EDI file. No new choice is selected for you.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {generating && <Alert><AlertDescription>Generation is active. Decisions are read-only until generation finishes.</AlertDescription></Alert>}
        {statusUnavailable && <Alert variant="destructive"><AlertDescription>Current status is unavailable. This does not mean the work failed. Editing is disabled; use Refresh status to reconnect.</AlertDescription></Alert>}
        {!statusUnavailable && progress?.status === "in_progress" && <div role="status" className="space-y-2">
          <progress className="h-4 w-full" max={100} value={progress.percentComplete ?? undefined} aria-label="Coverage evidence progress" />
          <p>{progress.phase || "Checking coverage evidence"}{progress.total ? ` · ${progress.processed ?? 0}/${progress.total}` : ""}</p>
          <p className="text-sm text-muted-foreground">Decisions, completion, settings and generation are blocked while checking. You may leave and return to this run.</p>
          {(!Number.isFinite(Date.parse(progress.heartbeatAt ?? "")) || Date.now() - Date.parse(progress.heartbeatAt!) > 120000) &&
            <p>Heartbeat is missing or stale. Work may be interrupted; do not start another check. Ask an administrator to investigate.</p>}
        </div>}
        {!statusUnavailable && progress?.status === "failed" && <Alert variant="destructive"><AlertDescription>
          {progress.error || "The evidence check failed."} No pending decision or completion was accepted. Use Refresh evidence, review the result, then submit your action again.
        </AlertDescription></Alert>}
        {start.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(start.error, "Could not confirm evidence check admission.")}</AlertDescription></Alert>}
        {review.isLoading && !running && <div role="status" aria-label="Loading coverage sources" className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {review.isError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>
          {getApiErrorMessage(review.error, "Could not load coverage sources.")} Use Refresh evidence to retry.
        </AlertDescription></Alert>}
        {save.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(save.error, "Could not save the decision.")} Review the refreshed evidence before trying again.</AlertDescription></Alert>}
        {save.isSuccess && save.data.runId === progress?.runId && progress?.status === "completed" && ready && <p role="status" className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 className="h-4 w-4" />
          {"action" in save.variables ? "Coverage review completed. Select Next to continue to Generate." : "Decision saved. Complete coverage review when all choices are ready."}
        </p>}
        {review.data && ready && (!review.data.applicable ? <p className="rounded-md bg-muted/50 p-4 text-sm">Not applicable. This hours-only configuration does not require coverage source decisions.</p> :
          <p className="text-sm text-muted-foreground">{review.data.conflicts.length ? `${review.data.conflicts.filter(conflict => !hasValidCoverageDecision(conflict)).length} of ${review.data.conflicts.length} conflicts need review. Save each decision separately.` : "No competing coverage sources need review. You can continue to generation."}</p>)}
      </CardContent>
    </Card>
    {ready && review.data?.applicable && review.data.conflicts.map(conflict => <ConflictReview
      key={`${wizardId}:${conflict.key}:${conflict.evidence}:${JSON.stringify(conflict.decision)}:${conflict.stale}`}
      conflict={conflict} locked={locked} pending={save.isPending}
      onSave={input => save.mutate(input)} />)}
    {review.data && <Button
      disabled={locked || save.isPending || review.data.conflicts.some(conflict => !hasValidCoverageDecision(conflict))}
      onClick={() => save.mutate({ action: "complete" })}
    >{save.isPending ? "Saving..." : "Complete coverage review"}</Button>}
    {!!review.data?.decisionsUsed.length && <Card>
      <CardHeader><CardTitle className="text-base">Decisions used in the completed report</CardTitle>
        <CardDescription>Read-only metadata snapshot from the completed report, not the current choices. It changes only when output is generated again.</CardDescription></CardHeader>
      <CardContent className="space-y-3">{review.data.decisionsUsed.map((decision, index) => <Snapshot key={`${decision.key}-${index}`} decision={decision} />)}</CardContent>
    </Card>}
  </div>;
}
