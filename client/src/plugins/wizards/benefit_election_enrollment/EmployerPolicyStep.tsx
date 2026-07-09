import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Building2 } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface EmploymentOption {
  employerId: string;
  employerName: string;
  home: boolean;
  jobTitle: string | null;
  policyId: string | null;
  policyName: string | null;
  policySource: string | null;
}

/**
 * Step 1: choose the employer (from the worker's active employments) and
 * with it the resolved benefit policy. The home employer is the default.
 */
export function EmployerPolicyStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const selectedEmployerId = (data?.employerId as string) || "";

  const { data: stepData, isLoading } = useQuery<{
    records: EmploymentOption[];
  }>({
    queryKey: [`/api/wizards/${wizardId}/dispatch/${step.id}/data`],
  });

  const options = stepData?.records ?? [];

  const selectMutation = useMutation({
    mutationFn: async (employerId: string) =>
      apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { employerId } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Building2 className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Employer &amp; Policy</CardTitle>
            <CardDescription>
              Choose the employer for this election. The benefit policy is
              determined by the employer.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : options.length === 0 ? (
          <p
            className="text-sm text-muted-foreground py-4 text-center"
            data-testid="text-no-employments"
          >
            This worker has no active employments. An active employment is
            required to enroll in benefits.
          </p>
        ) : (
          <RadioGroup
            value={selectedEmployerId}
            onValueChange={(value) => selectMutation.mutate(value)}
            disabled={selectMutation.isPending}
            className="space-y-2"
          >
            {options.map((opt) => (
              <div
                key={opt.employerId}
                className={`flex items-start gap-3 rounded-lg border p-4 ${
                  selectedEmployerId === opt.employerId
                    ? "border-primary bg-primary/5"
                    : ""
                }`}
                data-testid={`option-employer-${opt.employerId}`}
              >
                <RadioGroupItem
                  value={opt.employerId}
                  id={`employer-${opt.employerId}`}
                  className="mt-1"
                  data-testid={`radio-employer-${opt.employerId}`}
                />
                <Label
                  htmlFor={`employer-${opt.employerId}`}
                  className="flex-1 cursor-pointer space-y-1"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {opt.employerName}
                    {opt.home && <Badge variant="secondary">Home</Badge>}
                  </span>
                  {opt.jobTitle && (
                    <span className="block text-xs text-muted-foreground">
                      {opt.jobTitle}
                    </span>
                  )}
                  <span className="block text-sm text-muted-foreground">
                    {opt.policyName ? (
                      <>
                        Policy: <span className="text-foreground">{opt.policyName}</span>{" "}
                        <span className="text-xs">({opt.policySource})</span>
                      </>
                    ) : (
                      <span className="text-destructive">
                        No policy could be resolved for this employer
                      </span>
                    )}
                  </span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
        {data?.policyName ? (
          <p className="mt-4 text-sm text-muted-foreground" data-testid="text-selected-policy">
            Selected policy:{" "}
            <span className="font-medium text-foreground">
              {data.policyName as string}
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
