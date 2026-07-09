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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { ClipboardCheck, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface DependentEntry {
  relationId: string;
  name: string;
  ssnLast4: string;
  birthDate: string;
}

/**
 * Final step: review everything and Post (creates the one
 * worker_trust_elections record) or Cancel the enrollment.
 */
export function ReviewPostStep({
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
  const dependents: DependentEntry[] = Array.isArray(data?.dependents)
    ? (data.dependents as DependentEntry[])
    : [];
  const benefitNames: string[] = Array.isArray(data?.benefitNames)
    ? (data.benefitNames as string[])
    : [];
  const signature = data?.signature as { type: string; signedAt: string } | undefined;

  const missing: string[] = [];
  if (!data?.employerId) missing.push("employer and policy");
  if (!Array.isArray(data?.benefitIds) || (data.benefitIds as string[]).length === 0)
    missing.push("at least one benefit");
  if (!data?.startYmd) missing.push("effective date");
  if (!signature) missing.push("signature");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
  const onError = (error: Error) =>
    toast({ title: "Error", description: error.message, variant: "destructive" });

  const postMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { action: "post" } },
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Election posted" });
    },
    onError,
  });

  const cancelMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { action: "cancel" } },
      ),
    onSuccess: () => {
      invalidate();
      toast({ title: "Enrollment canceled" });
    },
    onError,
  });

  if (status === "posted") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-3">
          <CheckCircle2 className="mx-auto text-primary" size={40} />
          <p className="font-medium" data-testid="text-posted">
            Election posted successfully.
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
            This enrollment was canceled. No election was created.
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
              Posting creates the trust election record. Canceling discards the
              enrollment.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Worker</dt>
            <dd data-testid="text-review-worker">
              {(data?.workerName as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Employer</dt>
            <dd data-testid="text-review-employer">
              {(data?.employerName as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Policy</dt>
            <dd data-testid="text-review-policy">
              {(data?.policyName as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Effective date</dt>
            <dd data-testid="text-review-effective-date">
              {(data?.startYmd as string) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Benefits</dt>
            <dd data-testid="text-review-benefits">
              {benefitNames.length > 0 ? benefitNames.join(", ") : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dependents</dt>
            <dd data-testid="text-review-dependents">
              {dependents.length > 0
                ? dependents.map((d) => d.name).join(", ")
                : "None"}
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

        {missing.length > 0 && (
          <Alert variant="destructive" data-testid="alert-review-missing">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Before posting, complete: {missing.join(", ")}.
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
            Cancel Enrollment
          </Button>
          <Button
            onClick={() => postMutation.mutate()}
            disabled={
              missing.length > 0 ||
              postMutation.isPending ||
              cancelMutation.isPending
            }
            data-testid="button-post-election"
          >
            {postMutation.isPending ? "Posting…" : "Post Election"}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this enrollment?</AlertDialogTitle>
            <AlertDialogDescription>
              No election will be created and the enrollment can no longer be
              edited. Dependents already added remain on the worker's record.
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
              Cancel enrollment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
