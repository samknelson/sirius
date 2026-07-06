import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SchemaForm, type IChangeEvent } from "@/components/json-schema-form/SchemaForm";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepManifest } from "./types";

interface SchemaFormStepProps {
  wizardId: string;
  step: WizardStepManifest;
  data?: any;
}

/**
 * The DEFAULT wizard step UX: a server-provided JSON schema rendered by
 * the shared SchemaForm. Adding a `form` step needs ZERO client files —
 * the server declares the schema and this component renders + submits it
 * through the fixed dispatcher route.
 */
export function SchemaFormStep({ wizardId, step, data }: SchemaFormStepProps) {
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
          onChange={(e: IChangeEvent) => setFormData(e.formData)}
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
