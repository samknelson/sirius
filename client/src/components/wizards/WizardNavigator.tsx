import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface WizardNavigatorProps {
  currentStep: string;
  steps: Array<{ id: string; name: string }>;
  onNext: () => void;
  onPrevious: () => void;
  isLoading?: boolean;
}

export function WizardNavigator({
  currentStep,
  steps,
  onNext,
  onPrevious,
  isLoading = false,
}: WizardNavigatorProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === steps.length - 1;

  return (
    <div className="flex items-center justify-between gap-4 pt-6 border-t border-border">
      <Button
        variant="outline"
        onClick={onPrevious}
        disabled={isFirstStep || isLoading}
        data-testid="button-previous-step"
      >
        <ChevronLeft size={16} className="mr-2" />
        Previous
      </Button>

      <div className="text-sm text-muted-foreground">
        Step {currentIndex + 1} of {steps.length}
      </div>

      <Button
        onClick={onNext}
        disabled={isLastStep || isLoading}
        data-testid="button-next-step"
      >
        Next
        <ChevronRight size={16} className="ml-2" />
      </Button>
    </div>
  );
}
