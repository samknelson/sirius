import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { FeedResults as GenericFeedResults } from "@/components/wizards/framework/feed/FeedResults";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface BaoResultsData {
  withholdingTotal?: string | null;
  withholdingWorkerCount?: number;
  withholdingConsumedByPaymentId?: string | null;
}

/**
 * BAO Monthly Hours review step: the generic feed results, plus the upload's
 * total stored employee withholding. No money moves at upload — the total is
 * what an employer payment must exactly cover (via the "Upload source"
 * allocation method) to credit each worker's ledger.
 */
export function FeedResults(props: WizardStepComponentProps) {
  const { wizardId, step } = props;
  const { data } = useQuery<BaoResultsData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  return (
    <div className="space-y-4">
      {data?.withholdingTotal && (
        <Card>
          <CardContent className="pt-6" data-testid="text-withholding-total">
            <p className="text-2xl font-bold">${data.withholdingTotal}</p>
            <p className="text-sm text-muted-foreground">
              Employee withholding recorded for {data.withholdingWorkerCount} worker
              {data.withholdingWorkerCount === 1 ? "" : "s"}.{" "}
              {data.withholdingConsumedByPaymentId
                ? "This upload has been consumed by an employer payment — worker ledgers are credited."
                : "Workers are credited when an employer payment is posted with this upload as its allocation source."}
            </p>
          </CardContent>
        </Card>
      )}
      <GenericFeedResults {...props} />
    </div>
  );
}
