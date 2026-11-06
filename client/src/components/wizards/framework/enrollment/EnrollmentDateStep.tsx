import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchemaForm, isSchemaFormValid } from "@/components/json-schema-form/SchemaForm";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { WizardStepManifest } from "../types";
import { useNextSubmission } from "../NextSubmission";

function initialFormData(step: WizardStepManifest, data?: Record<string, unknown>) {
  const properties = step.schema?.properties ?? {};
  const initial: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    const value = key === "startYmd"
      ? data?.forcedStartYmd ?? data?.startYmd ?? (property as any)?.default
      : data?.[key] ?? (property as any)?.default;
    if (value !== undefined) initial[key] = value;
  }
  return initial;
}

/** Enrollment-only schema submission through Next; unopted forms keep Save. */
export function EnrollmentSubmitOnNextStep({ wizardId, wizardType, step, data }: {
  wizardId: string; wizardType: string; step: WizardStepManifest; data?: any;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>(
    () => initialFormData(step, data),
  );
  const ready = isSchemaFormValid(step.schema, formData);
  const navigating = useNextSubmission({
    ready,
    guidance: step.id === "effective_date"
      ? "Enter a valid effective date. Next saves it before continuing; only administrators may override the computed date."
      : "Complete the required fields. Next saves your displayed choices before continuing.",
    submit: async () => {
      if (!ready) throw new Error("Complete the required fields before continuing.");
      await apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, { input: formData });
      await queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      if (wizardType === "bao_cobra_enrollment" && step.id === "coverage") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}/dispatch/covered_people/data`] }),
          queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}/dispatch/review/data`] }),
        ]);
      }
      if (wizardType === "life_event_enrollment" && step.id === "event_type") {
        await queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}/dispatch/dependents/data`] });
      }
    },
  });
  const isDate = step.id === "effective_date";
  return <Card>
    <CardHeader><CardTitle>{step.name}</CardTitle></CardHeader>
    <CardContent>
      <SchemaForm schema={step.schema} uiSchema={step.uiSchema} formData={formData}
        disabled={navigating} liveValidate
        experimental_defaultFormStateBehavior={{
          arrayMinItems: { populate: "never" },
          constAsDefaults: "skipOneOf",
        }}
        onChange={event => setFormData(event.formData ?? {})}
        onSubmit={() => { /* Next is the sole forward action, including Enter. */ }}>
        <span />
      </SchemaForm>
      <p className="text-sm text-muted-foreground mt-4">
        {isDate
          ? "Next saves this date before continuing. It does not post the election."
          : "Next saves these choices before continuing. It does not post the election."}
      </p>
    </CardContent>
  </Card>;
}
