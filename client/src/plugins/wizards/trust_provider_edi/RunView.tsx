import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RunProgressView } from "@/components/wizards/framework/RunProgressView";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { hasValidCoverageDecision, useCoverageReview } from "./use-coverage-review";

export function RunView(props: WizardStepComponentProps) {
  const { review, refresh } = useCoverageReview(props.wizardId);
  const unresolved = review.data?.applicable &&
    review.data.conflicts.some(conflict => !hasValidCoverageDecision(conflict));
  const coverageBlocker = review.isError
    ? "Coverage evidence could not be checked. Refresh evidence before generating."
    : review.isPending || review.isFetching
      ? "Checking coverage sources before generation."
      : unresolved
        ? "Ask an administrator to open the Coverage sources step, review every unresolved or stale conflict, and save each decision before generating."
        : undefined;
  return <div className="space-y-4">
    {(unresolved || review.isError) && <Alert>
      <AlertDescription>
        <p>{coverageBlocker}</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void refresh()} disabled={review.isFetching}>Refresh coverage check</Button>
      </AlertDescription>
    </Alert>}
    <RunProgressView {...props} step={{ ...props.step, runBlocker: props.step.runBlocker || coverageBlocker }} />
  </div>;
}
