import { Check, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WizardData } from "@shared/schema";
import { WizardStep } from "@/lib/wizard-types";

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: string;
  progress?: WizardData['progress'];
  onNext?: () => void;
  onPrevious?: () => void;
  isLoading?: boolean;
  canProceed?: boolean;
}

export function WizardStepper({ 
  steps, 
  currentStep, 
  progress = {},
  onNext,
  onPrevious,
  isLoading = false,
  canProceed = true,
}: WizardStepperProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === steps.length - 1;
  const nextDisabled = isLastStep || isLoading || !canProceed;

  return (
    <div className="w-full space-y-6">
      {!canProceed && onNext && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please complete all required items in this step before proceeding to the next step.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-4">
        {onPrevious && (
          <Button
            variant="outline"
            onClick={onPrevious}
            disabled={isFirstStep || isLoading}
            data-testid="button-previous-step"
            className="shrink-0"
          >
            <ChevronLeft size={16} className="mr-2" />
            Previous
          </Button>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const stepProgress = progress?.[step.id];
              const status = stepProgress?.status || 'pending';
              const isCompleted = status === 'completed';
              const isInProgress = status === 'in_progress' || step.id === currentStep;
              const isPending = status === 'pending' && index > currentIndex;

              return (
                <div key={step.id} className="flex-1 flex items-center min-w-0">
                  <div className="flex flex-col items-center flex-1 min-w-0">
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
                        className={`relative flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors shrink-0 ${
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
                    <div className="mt-2 text-center w-full px-1">
                      <p
                        className={`text-sm font-medium truncate ${
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
                        <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block truncate">
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

        {onNext && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={onNext}
                    disabled={nextDisabled}
                    data-testid="button-next-step"
                    className="shrink-0"
                  >
                    Next
                    <ChevronRight size={16} className="ml-2" />
                  </Button>
                </span>
              </TooltipTrigger>
              {!canProceed && !isLastStep && !isLoading && (
                <TooltipContent>
                  <p>Complete this step to proceed</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {onNext && (
        <div className="text-sm text-muted-foreground text-center">
          Step {currentIndex + 1} of {steps.length}
        </div>
      )}
    </div>
  );
}
