import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Users } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Employer } from "@/lib/employer-types";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface CardcheckDefinition {
  id: string;
  name: string;
}

/**
 * Escape-hatch Inputs step for the BTU invalid-cardcheck report wizard.
 * Ported from the legacy report step: cardcheck-definition (required) +
 * optional employer pickers. Persists through the fixed dispatcher submit
 * route instead of a wizard-specific save endpoint.
 */
export function InputsForm({ wizardId, step, data }: WizardStepComponentProps) {
  const { toast } = useToast();
  const filters = (data?.config?.filters as {
    cardcheckDefinitionId?: string;
    employerId?: string;
  }) || {};

  const [cardcheckDefinitionId, setCardcheckDefinitionId] = useState<string>(
    filters.cardcheckDefinitionId || "",
  );
  const [employerId, setEmployerId] = useState<string>(
    filters.employerId || "__none__",
  );

  const { data: cardcheckDefinitions = [], isLoading: definitionsLoading } =
    useQuery<CardcheckDefinition[]>({
      queryKey: ["/api/cardcheck/definitions"],
    });

  const { data: employers = [], isLoading: employersLoading } = useQuery<
    Employer[]
  >({
    queryKey: ["/api/employers"],
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: {
          filters: {
            cardcheckDefinitionId: cardcheckDefinitionId || undefined,
            employerId: employerId === "__none__" ? undefined : employerId,
          },
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({ title: "Saved", description: "Report configuration saved." });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  if (definitionsLoading || employersLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
          <CardDescription>Loading options...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          BTU Workers Without Valid Cardchecks
        </CardTitle>
        <CardDescription>
          Configure the parameters to find workers with missing or mismatched
          cardchecks
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Report Description
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              This report identifies workers who either do not have a signed
              cardcheck of the specified type, or who have a signed cardcheck
              with a bargaining unit that differs from their current worker
              bargaining unit.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cardcheckDefinition" className="text-sm font-medium">
              Cardcheck Definition{" "}
              <span className="text-destructive">*</span>
            </Label>
            <Select
              value={cardcheckDefinitionId}
              onValueChange={setCardcheckDefinitionId}
            >
              <SelectTrigger
                id="cardcheckDefinition"
                data-testid="select-cardcheck-definition"
              >
                <SelectValue placeholder="Select a cardcheck definition" />
              </SelectTrigger>
              <SelectContent>
                {cardcheckDefinitions.map((def) => (
                  <SelectItem
                    key={def.id}
                    value={def.id}
                    data-testid={`option-definition-${def.id}`}
                  >
                    {def.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Required. Select the cardcheck definition to check against.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="employer" className="text-sm font-medium">
              Home Employer (Optional)
            </Label>
            <Select value={employerId} onValueChange={setEmployerId}>
              <SelectTrigger id="employer" data-testid="select-employer">
                <SelectValue placeholder="All employers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" data-testid="option-employer-all">
                  All Employers
                </SelectItem>
                {employers.map((emp) => (
                  <SelectItem
                    key={emp.id}
                    value={emp.id}
                    data-testid={`option-employer-${emp.id}`}
                  >
                    {emp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Optionally filter to workers with a specific home employer.
            </p>
          </div>
        </div>

        {!cardcheckDefinitionId && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md">
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Please select a cardcheck definition to proceed.
            </p>
          </div>
        )}

        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !cardcheckDefinitionId}
          data-testid="button-save-inputs"
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
