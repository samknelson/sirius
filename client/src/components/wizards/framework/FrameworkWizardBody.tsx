import { useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { WizardStepper } from "@/components/wizards/WizardStepper";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { wizardComponentRegistry } from "@/plugins/wizards/registry";
import { SchemaFormStep } from "./SchemaFormStep";
import type { WizardManifest, WizardStepManifest } from "./types";

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
  const { toast } = useToast();

  const navigateMutation = useMutation({
    mutationFn: async (direction: "next" | "previous") =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/navigate`, {
        direction,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to change step",
        variant: "destructive",
      });
    },
  });

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

  const canProceed = currentStep?.state === "completed";

  return (
    <>
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
              onNext={() => navigateMutation.mutate("next")}
              onPrevious={() => navigateMutation.mutate("previous")}
              isLoading={navigateMutation.isPending}
              canProceed={canProceed}
            />
          </CardContent>
        </Card>
      )}

      {currentStep && (
        <StepBody
          wizardId={wizardId}
          wizardType={wizardType}
          data={data}
          step={currentStep}
        />
      )}
    </>
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
  if (step.schema) {
    return <SchemaFormStep wizardId={wizardId} step={step} data={data} />;
  }
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
  return (
    <Card>
      <CardContent className="py-8 text-center text-muted-foreground">
        Nothing to render for this step.
      </CardContent>
    </Card>
  );
}
