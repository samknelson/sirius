import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Users } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface DependentOption {
  relationId: string;
  name: string;
  relationTypeName: string | null;
}

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

function money(value: string | null): string {
  if (value === null) return "No rate configured";
  return `$${Number(value).toFixed(2)}/mo`;
}

/**
 * Covered-people step of the COBRA election wizard. For a subscriber's own
 * case, the subscriber is always covered and their active dependents can be
 * added; the covered-lives tier (1 / 2 / 3+) and live pricing update with
 * the selection. A dependent's own case covers only that dependent.
 */
export function CobraCoveredPeopleStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const isSubscriberCase = Boolean(data?.isSubscriberCase);
  const savedSelection: string[] = Array.isArray(data?.selectedRelationIds)
    ? (data.selectedRelationIds as string[])
    : [];
  const [selected, setSelected] = useState<string[]>(savedSelection);
  useEffect(() => {
    setSelected(savedSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(savedSelection)]);

  const { data: stepData, isLoading } = useQuery<{
    records: DependentOption[];
    pricing: Pricing;
  }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
  });

  const submitMutation = useMutation({
    mutationFn: async (relationIds: string[]) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { relationIds },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
      });
      toast({ title: "Covered people saved" });
    },
    onError: (error: Error) =>
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      }),
  });

  const records = stepData?.records ?? [];
  const pricing = stepData?.pricing;
  const previewLives = 1 + (isSubscriberCase ? selected.length : 0);
  const previewTier = previewLives <= 1 ? "1" : previewLives === 2 ? "2" : "3+";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Users className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Covered People</CardTitle>
            <CardDescription>
              {isSubscriberCase
                ? "The subscriber is always covered. Add any dependents to cover — the monthly premium depends on how many people are covered (1 / 2 / 3 or more)."
                : "This COBRA case covers only this person; no dependents can be added."}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm" data-testid="row-covered-self">
                <Checkbox checked disabled data-testid="checkbox-covered-self" />
                <span>
                  {(data?.workerName as string) || "This person"}{" "}
                  <span className="text-muted-foreground">(always covered)</span>
                </span>
              </div>
              {isSubscriberCase &&
                records.map((r) => (
                  <div
                    key={r.relationId}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`row-dependent-${r.relationId}`}
                  >
                    <Checkbox
                      checked={selected.includes(r.relationId)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) =>
                          checked
                            ? [...prev, r.relationId]
                            : prev.filter((id) => id !== r.relationId),
                        )
                      }
                      data-testid={`checkbox-dependent-${r.relationId}`}
                    />
                    <span>
                      {r.name}
                      {r.relationTypeName ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({r.relationTypeName})
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              {isSubscriberCase && records.length === 0 && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-dependents">
                  No active dependents on record. Only the subscriber will be
                  covered.
                </p>
              )}
            </div>

            <Alert data-testid="alert-covered-lives">
              <AlertDescription>
                Covered lives: <strong>{previewLives}</strong> (rate tier{" "}
                <strong>{previewTier}</strong>)
                {pricing?.lines?.length ? (
                  <span className="block mt-1">
                    Current saved selection prices at{" "}
                    {pricing.monthlyTotal !== null
                      ? `$${Number(pricing.monthlyTotal).toFixed(2)}/mo (includes $${Number(pricing.adminFee ?? 0).toFixed(2)} COBRA administration fee, 2%)`
                      : "— (missing rate)"}{" "}
                    ({pricing.lines.map((l) => `${l.benefitName}: ${money(l.rate)}`).join(", ")})
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>

            <div className="flex justify-end">
              <Button
                onClick={() => submitMutation.mutate(isSubscriberCase ? selected : [])}
                disabled={submitMutation.isPending}
                data-testid="button-save-covered-people"
              >
                {submitMutation.isPending ? "Saving…" : "Save & Continue"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
