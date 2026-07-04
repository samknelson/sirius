import { useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Building2 } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

/**
 * First onboarding step: capture the employer name. Persists through the
 * fixed dispatcher submit route (no wizard-specific endpoint).
 */
export function EmployerNameStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const employerName = data?.employerName || "";

  const updateMutation = useMutation({
    mutationFn: async (name: string) =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: { employerName: name },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Building2 className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Employer Name</CardTitle>
            <CardDescription>Enter the name for the new employer</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-w-lg">
          <div>
            <Label htmlFor="employer-name" className="text-sm font-medium mb-2 block">
              Employer Name
            </Label>
            <Input
              id="employer-name"
              type="text"
              placeholder="Enter employer name..."
              defaultValue={employerName}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== employerName) {
                  updateMutation.mutate(value);
                }
              }}
              className="w-full"
              data-testid="input-employer-name"
            />
          </div>
          {employerName && (
            <p className="text-sm text-muted-foreground">
              The employer will be created as "
              <span className="font-medium text-foreground">{employerName}</span>"
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
