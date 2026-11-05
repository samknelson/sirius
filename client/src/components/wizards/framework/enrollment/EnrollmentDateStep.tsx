import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchemaForm, isSchemaFormValid } from "@/components/json-schema-form/SchemaForm";
import { apiRequest } from "@/lib/queryClient";
import type { WizardStepManifest } from "../types";
import { useNextSubmission } from "../NextSubmission";

/** Enrollment-only external submission; generic schema steps keep their Save. */
export function EnrollmentDateStep({ wizardId, step, data }: {
  wizardId: string; step: WizardStepManifest; data?: any;
}) {
  const [formData, setFormData] = useState<Record<string, unknown>>(() => ({
    startYmd: data?.forcedStartYmd || data?.startYmd || step.schema?.properties?.startYmd?.default,
  }));
  const ready = isSchemaFormValid(step.schema, formData);
  const busy = useNextSubmission({
    ready,
    guidance: "Enter a valid effective date. Next saves the date before continuing; only administrators may override the computed date.",
    submit: async () => {
      if (!ready) throw new Error("Enter a valid effective date.");
      return apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, { input: formData });
    },
  });
  return <Card>
    <CardHeader><CardTitle>{step.name}</CardTitle></CardHeader>
    <CardContent>
      <SchemaForm schema={step.schema} uiSchema={step.uiSchema} formData={formData}
        disabled={busy} liveValidate
        onChange={event => setFormData(event.formData ?? {})}
        onSubmit={() => { /* Next is the sole forward action, including Enter. */ }}>
        <span />
      </SchemaForm>
      <p className="text-sm text-muted-foreground mt-4">Next saves this date before continuing. It does not post the election.</p>
    </CardContent>
  </Card>;
}
