import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Server, AlertTriangle, CheckCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type SystemMode = "dev" | "test" | "live";

interface SystemModeResponse {
  mode: SystemMode;
}

const modeDescriptions: Record<SystemMode, { label: string; description: string; color: string }> = {
  dev: {
    label: "Development",
    description: "Development mode - safe for testing without affecting real data or services",
    color: "bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-600",
  },
  test: {
    label: "Test",
    description: "Test mode - for validation and staging before going live",
    color: "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-600",
  },
  live: {
    label: "Live",
    description: "Live mode - production environment with real transactions and data",
    color: "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-600",
  },
};

export default function SystemModePage() {
  const { toast } = useToast();

  const { data: systemMode, isLoading } = useQuery<SystemModeResponse>({
    queryKey: ["/api/system-mode"],
  });

  const updateModeMutation = useMutation({
    mutationFn: async (mode: SystemMode) => {
      return await apiRequest("PUT", "/api/system-mode", { mode });
    },
    onSuccess: (_, mode) => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-mode"] });
      toast({
        title: "System Mode Updated",
        description: `System mode has been changed to ${modeDescriptions[mode].label}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update system mode",
        variant: "destructive",
      });
    },
  });

  const handleModeChange = (mode: string) => {
    updateModeMutation.mutate(mode as SystemMode);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="heading-system-mode">System Mode</h2>
        <p className="text-muted-foreground mt-1">
          Control the application's operating mode to manage behavior across different environments
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Select System Mode
          </CardTitle>
          <CardDescription>
            The system mode affects how the application behaves and whether certain operations are enabled
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <RadioGroup
              value={systemMode?.mode || "dev"}
              onValueChange={handleModeChange}
              className="space-y-4"
              disabled={updateModeMutation.isPending}
            >
              {(Object.keys(modeDescriptions) as SystemMode[]).map((mode) => {
                const { label, description, color } = modeDescriptions[mode];
                const isSelected = systemMode?.mode === mode;
                
                return (
                  <div
                    key={mode}
                    className={`relative flex items-start gap-4 p-4 rounded-md border-2 transition-colors ${
                      isSelected ? color : "border-transparent bg-muted/30"
                    }`}
                  >
                    <RadioGroupItem
                      value={mode}
                      id={`mode-${mode}`}
                      className="mt-1"
                      data-testid={`radio-mode-${mode}`}
                    />
                    <div className="flex-1">
                      <Label
                        htmlFor={`mode-${mode}`}
                        className="text-base font-medium cursor-pointer flex items-center gap-2"
                      >
                        {label}
                        {isSelected && (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        )}
                        {mode === "live" && (
                          <span className="inline-flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                            <AlertTriangle className="h-3 w-3" />
                            Production
                          </span>
                        )}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        {description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mode Effects</CardTitle>
          <CardDescription>
            How the system mode affects application behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 text-sm">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-gray-500 mt-1.5" />
              <div>
                <span className="font-medium">Development (dev)</span>
                <p className="text-muted-foreground">
                  Disables live payment processing, uses test APIs, and allows experimental features
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-yellow-500 mt-1.5" />
              <div>
                <span className="font-medium">Test</span>
                <p className="text-muted-foreground">
                  Enables test mode for external services, validates integrations before going live
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 mt-1.5" />
              <div>
                <span className="font-medium">Live</span>
                <p className="text-muted-foreground">
                  Full production mode - enables real payment processing and live API connections
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
