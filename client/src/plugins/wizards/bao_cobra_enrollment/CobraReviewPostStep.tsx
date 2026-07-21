import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface PricingLine {
  kind: "medical" | "dental";
  benefitName: string;
  rate: string | null;
}

interface Pricing {
  asOfYmd: string;
  coveredLives: number;
  tier: string;
  lines: PricingLine[];
  preFeeTotal: string | null;
  adminFee: string | null;
  adminFeeRate: number;
  monthlyTotal: string | null;
}

const COVERAGE_LABEL: Record<string, string> = {
  medical: "Medical only",
  dental: "Dental only",
  both: "Medical and dental",
};

/**
 * Final step of the COBRA election wizard: review the coverage choice,
 * covered people, and live monthly premium, then Post (records the election
 * on the COBRA case and creates the trust election) or Cancel.
 */
export function CobraReviewPostStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: wizard } = useQuery<{ status?: string }>({
    queryKey: [`/api/wizards/${wizardId}`],
  });
  const status = wizard?.status ?? "draft";

  const { data: stepData, isLoading: pricingLoading } = useQuery<{
    pricing: Pricing;
  }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
    enabled: status === "draft",
  });
  const pricing = stepData?.pricing;

  const coverageChoice = (data?.coverageChoice as string) || "";
  const signature = data?.signature as
    | { type: string; signedAt: string }
    | undefined;
  const coveredLabels: string[] = Array.isArray(data?.selectedRelationLabels)
    ? (data.selectedRelationLabels as string[])
    : [];

  const missing: string[] = [];
  if (!coverageChoice) missing.push("the coverage to continue");
  if (!data?.coveredPeopleConfirmed) missing.push("the covered people");
  if (!signature) missing.push("signature");
  const missingRate = !pricingLoading && pricing?.monthlyTotal === null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
  const onError = (error: Error) =>
    toast({ title: "Error", description: error.message, variant: "destructive" });

  const postMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { action: "post" },
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "COBRA election posted" });
    },
    onError,
  });

  const cancelMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { action: "cancel" },
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "COBRA election canceled" });
    },
    onError,
  });

  if (status === "posted") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto text-primary" size={40} />
          <p className="font-medium" data-testid="text-posted">
            COBRA election posted. The case is now Pending First Payment.
          </p>
          {data?.electionId ? (
            <Link
              href={`/trust/election/${data.electionId as string}`}
              className="text-primary underline-offset-2 hover:underline"
              data-testid="link-posted-election"
            >
              View the election
            </Link>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (status === "canceled") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <XCircle className="mx-auto text-muted-foreground" size={40} />
          <p className="font-medium" data-testid="text-canceled">
            This COBRA election was canceled. The case is unchanged.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <ClipboardCheck className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Review &amp; Post</CardTitle>
            <CardDescription>
              Posting records the election on the COBRA case (status moves to
              Pending First Payment) and creates the trust election for the
              continued coverage.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Covered person</dt>
            <dd data-testid="text-review-worker">
              {(data?.workerName as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Coverage continued</dt>
            <dd data-testid="text-review-coverage">
              {COVERAGE_LABEL[coverageChoice] || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Coverage effective</dt>
            <dd data-testid="text-review-effective">
              {(data?.cobraEffectiveYmd as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Also covering</dt>
            <dd data-testid="text-review-dependents">
              {coveredLabels.length > 0 ? coveredLabels.join(", ") : "No one else"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Signature</dt>
            <dd data-testid="text-review-signature">
              {signature
                ? `Captured (${signature.type}) ${new Date(signature.signedAt).toLocaleString()}`
                : "Not captured"}
            </dd>
          </div>
        </dl>

        <div className="rounded-lg border p-4 space-y-2">
          <p className="text-sm font-medium">Monthly premium</p>
          {pricingLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : pricing ? (
            <div className="space-y-1 text-sm" data-testid="section-pricing">
              {pricing.lines.map((line) => (
                <div
                  key={line.kind}
                  className="flex justify-between"
                  data-testid={`row-price-${line.kind}`}
                >
                  <span>{line.benefitName}</span>
                  <span>
                    {line.rate !== null
                      ? `$${Number(line.rate).toFixed(2)}`
                      : "No rate configured"}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-1">
                <span>Subtotal</span>
                <span data-testid="text-price-subtotal">
                  {pricing.preFeeTotal !== null
                    ? `$${Number(pricing.preFeeTotal).toFixed(2)}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>COBRA administration fee (2%)</span>
                <span data-testid="text-price-admin-fee">
                  {pricing.adminFee !== null
                    ? `$${Number(pricing.adminFee).toFixed(2)}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between font-medium border-t pt-1">
                <span>
                  Total ({pricing.coveredLives} covered, tier {pricing.tier})
                </span>
                <span data-testid="text-price-total">
                  {pricing.monthlyTotal !== null
                    ? `$${Number(pricing.monthlyTotal).toFixed(2)}/mo`
                    : "—"}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose the coverage to continue to see pricing.
            </p>
          )}
        </div>

        {missing.length > 0 && (
          <Alert variant="destructive" data-testid="alert-review-missing">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Before posting, complete: {missing.join(", ")}.
            </AlertDescription>
          </Alert>
        )}
        {missing.length === 0 && missingRate && (
          <Alert variant="destructive" data-testid="alert-review-missing-rate">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No COBRA rate is configured for the selected coverage and
              covered-lives tier. Rates must be set up before this election
              can be posted.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => setConfirmCancel(true)}
            disabled={cancelMutation.isPending || postMutation.isPending}
            data-testid="button-cancel-enrollment"
          >
            Cancel
          </Button>
          <Button
            onClick={() => postMutation.mutate()}
            disabled={
              missing.length > 0 ||
              missingRate ||
              postMutation.isPending ||
              cancelMutation.isPending
            }
            data-testid="button-post-election"
          >
            {postMutation.isPending ? "Posting…" : "Post COBRA Election"}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this COBRA election?</AlertDialogTitle>
            <AlertDialogDescription>
              The COBRA case will be left unchanged and this election draft can
              no longer be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-dialog-back">
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelMutation.mutate()}
              data-testid="button-cancel-dialog-confirm"
            >
              Cancel election
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
