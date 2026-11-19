import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RunProgressView } from "@/components/wizards/framework/RunProgressView";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { useCoverageReview } from "./use-coverage-review";
import { formatWhen } from "./CoverageEntries";

export function RunView(props: WizardStepComponentProps) {
  const { review, refresh, ready, running, statusUnavailable, needsAcknowledgement } = useCoverageReview(props.wizardId, false);
  const coverageBlocker = review.isError || statusUnavailable
    ? "Coverage could not be checked. Refresh the coverage check before generating."
    : running
      ? "Coverage checking or generation is active."
      : !ready
        ? "Open Coverage sources and check coverage before generating."
        : review.isPending || review.isFetching
          ? "Checking coverage sources before generation."
          : needsAcknowledgement
            ? `This file would leave out ${review.data?.exclusionCount} coverage record group(s). Ask an administrator to open Coverage sources, review the exclusion list and acknowledge it before generating.`
            : undefined;
  const acknowledged = ready && review.data?.applicable ? review.data.acknowledgement : null;
  return <div className="space-y-4">
    {(needsAcknowledgement || review.isError) && <Alert>
      <AlertDescription>
        <p>{coverageBlocker}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void refresh()} disabled={review.isFetching}>Refresh coverage check</Button>
      </AlertDescription>
    </Alert>}
    {acknowledged && <p role="status" className="rounded-md border p-3 text-sm">
      This file will leave out {acknowledged.exclusionCount} coverage record group(s), acknowledged by {acknowledged.acknowledgedBy} on {formatWhen(acknowledged.acknowledgedAt)}.
      Generation reads coverage again and stops if the list has changed.
    </p>}
    <RunProgressView {...props} step={{ ...props.step, runBlocker: props.step.runBlocker || coverageBlocker }} />
  </div>;
}
