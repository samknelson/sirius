import { useCallback, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { WizardStepper } from "@/components/wizards/WizardStepper";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { wizardComponentRegistry } from "@/plugins/wizards/registry";
import { SchemaFormStep } from "./SchemaFormStep";
import type { WizardManifest, WizardStepManifest } from "./types";
import { NextSubmissionContext, type NextSubmission } from "./NextSubmission";

interface FrameworkWizardBodyProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  manifest: WizardManifest;
}

/**
 * Renders a framework (plugin-based) wizard's active step + the stepper,
 * driven entirely by the server-computed manifest. Step bodies resolve
 * one of two ways:
 *   - a `schema` → the shared SchemaForm (default, zero client files);
 *   - a `component` → the auto-discovered escape-hatch React component.
 * Navigation goes through the fixed dispatcher `navigate` route.
 */
export function FrameworkWizardBody({
  wizardId,
  wizardType,
  data,
  manifest,
}: FrameworkWizardBodyProps) {
  // Both draft state and registrations belong to one record/active step.
  return <ActiveWizardBody key={`${wizardId}:${manifest.currentStep}`}
    wizardId={wizardId} wizardType={wizardType} data={data} manifest={manifest} />;
}

function ActiveWizardBody({
  wizardId,
  wizardType,
  data,
  manifest,
}: FrameworkWizardBodyProps) {
  const { toast } = useToast();
  const [submission, register] = useState<NextSubmission | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const registerSubmission = useCallback((value: NextSubmission | null) => register(value), []);

  const currentStep =
    manifest.steps.find((s) => s.id === manifest.currentStep) ??
    manifest.steps[0];

  // Map manifest step states into the shape WizardStepper understands.
  const progress = Object.fromEntries(
    manifest.steps.map((s) => [
      s.id,
      { status: s.state === "failed" ? "in_progress" : s.state },
    ]),
  ) as any;

  const canProceed = currentStep?.submitOnNext
    ? !!submission?.ready && !submission.busy
    : currentStep?.state === "completed";
  const navigate = async (direction: "next" | "previous") => {
    if (locked.current || submission?.busy || (direction === "next" && !canProceed)) return;
    locked.current = true;
    setNavigating(true);
    setError("");
    let saved = false;
    try {
      if (direction === "next" && currentStep?.submitOnNext) {
        await submission!.submit();
        saved = true;
      }
      await apiRequest("POST", `/api/wizards/${wizardId}/dispatch/navigate`, {
        direction,
        ...(currentStep?.submitOnNext ? { expectedStep: currentStep.id } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    } catch (err) {
      const message = `${saved ? "Your entry was saved, but the step could not change." : "Could not continue."} ${err instanceof Error ? err.message : "Request failed."} Check your entry and connection, then try Next again.`;
      setError(message);
      toast({ title: "Unable to continue", description: message, variant: "destructive" });
    } finally {
      locked.current = false;
      setNavigating(false);
    }
  };

  return (
    <NextSubmissionContext.Provider value={{ register: registerSubmission, navigating }}>
      {manifest.steps.length > 0 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <WizardStepper
              steps={manifest.steps.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
              }))}
              currentStep={currentStep?.id ?? manifest.steps[0].id}
              progress={progress}
              onNext={() => void navigate("next")}
              onPrevious={() => void navigate("previous")}
              isLoading={navigating || submission?.busy}
              canProceed={canProceed}
              guidance={currentStep?.submitOnNext ? submission?.guidance : undefined}
            />
          </CardContent>
        </Card>
      )}

      {error && <p role="alert" className="mb-4 text-destructive">{error}</p>}
      {currentStep && (
        <StepBody
          wizardId={wizardId}
          wizardType={wizardType}
          data={data}
          step={currentStep}
        />
      )}
    </NextSubmissionContext.Provider>
  );
}

function StepBody({
  wizardId,
  wizardType,
  data,
  step,
}: {
  wizardId: string;
  wizardType: string;
  data?: any;
  step: WizardStepManifest;
}) {
  // An explicit escape-hatch component always wins — a step may carry BOTH
  // a schema and a component (the component typically wraps SchemaForm with
  // bespoke behavior, e.g. dependent field defaults).
  if (step.component) {
    const Component = wizardComponentRegistry.resolve(step.component);
    return (
      <Component
        wizardId={wizardId}
        wizardType={wizardType}
        step={step}
        data={data}
      />
    );
  }
  if (step.schema) {
    return <SchemaFormStep wizardId={wizardId} wizardType={wizardType} step={step} data={data} />;
  }
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        Nothing to render for this step.
      </CardContent>
    </Card>
  );
}
