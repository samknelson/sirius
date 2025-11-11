import { Check } from "lucide-react";
import type { WizardData } from "@shared/schema";

interface WizardStep {
  id: string;
  name: string;
  description?: string;
}

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: string;
  progress?: WizardData['progress'];
}

export function WizardStepper({ steps, currentStep, progress = {} }: WizardStepperProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const stepProgress = progress?.[step.id];
          const status = stepProgress?.status || 'pending';
          const isCompleted = status === 'completed';
          const isInProgress = status === 'in_progress' || step.id === currentStep;
          const isPending = status === 'pending' && index > currentIndex;

          return (
            <div key={step.id} className="flex-1 flex items-center">
              <div className="flex flex-col items-center flex-1">
                <div className="flex items-center w-full">
                  {index > 0 && (
                    <div
                      className={`flex-1 h-0.5 ${
                        isCompleted || (index <= currentIndex && status !== 'pending')
                          ? 'bg-primary'
                          : 'bg-border'
                      }`}
                    />
                  )}
                  <div
                    className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors ${
                      isCompleted
                        ? 'bg-primary border-primary text-primary-foreground'
                        : isInProgress
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-background border-border text-muted-foreground'
                    }`}
                    data-testid={`step-indicator-${step.id}`}
                  >
                    {isCompleted ? (
                      <Check size={20} />
                    ) : (
                      <span className="text-sm font-medium">{index + 1}</span>
                    )}
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 ${
                        index < currentIndex ? 'bg-primary' : 'bg-border'
                      }`}
                    />
                  )}
                </div>
                <div className="mt-2 text-center">
                  <p
                    className={`text-sm font-medium ${
                      isInProgress
                        ? 'text-foreground'
                        : isCompleted
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {step.name}
                  </p>
                  {step.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
