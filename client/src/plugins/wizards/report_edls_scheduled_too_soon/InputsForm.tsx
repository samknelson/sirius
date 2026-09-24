import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SchemaForm, type IChangeEvent } from "@/components/json-schema-form/SchemaForm";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

/** Add `days` to a YYYY-MM-DD string, returning YYYY-MM-DD (UTC-safe). */
function addDays(isoDate: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const d = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Bespoke settings form for the EDLS Scheduled Too Soon report. Same as
 * the generic SchemaFormStep, plus one behavior: when the start date
 * changes, the end date is re-defaulted to start + 10 days (the user can
 * still override it afterwards — only a start-date change resets it).
 */
export function InputsForm({ wizardId, step, data }: WizardStepComponentProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Record<string, unknown>>(
    (data?.config as Record<string, unknown>) ?? {},
  );

  const submitMutation = useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({ title: "Saved", description: "Inputs saved successfully." });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to save inputs",
        variant: "destructive",
      });
    },
  });

  const handleChange = (e: IChangeEvent) => {
    const next = { ...(e.formData as Record<string, unknown>) };
    const prevStart = formData.startDate;
    const nextStart = next.startDate;
    if (
      typeof nextStart === "string" &&
      nextStart !== prevStart
    ) {
      const defaultEnd = addDays(nextStart, 10);
      if (defaultEnd) next.endDate = defaultEnd;
    }
    setFormData(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{step.name}</CardTitle>
      </CardHeader>
      <CardContent>
        {step.description && (
          <p className="text-sm text-muted-foreground mb-4">
            {step.description}
          </p>
        )}
        <SchemaForm
          schema={step.schema}
          uiSchema={step.uiSchema}
          formData={formData}
          onChange={handleChange}
          onSubmit={(e: IChangeEvent) => submitMutation.mutate(e.formData)}
        >
          <div className="mt-4">
            <Button
              type="submit"
              disabled={submitMutation.isPending}
              data-testid="button-save-inputs"
            >
              {submitMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </SchemaForm>
      </CardContent>
    </Card>
  );
}
