import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Phone, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export interface PhoneValidationConfig {
  mode: "local" | "twilio";
  local: {
    enabled: boolean;
    defaultCountry: string;
    strictValidation: boolean;
  };
  twilio: {
    enabled: boolean;
    lookupType: string[];
  };
  fallback: {
    useLocalOnTwilioFailure: boolean;
    logValidationAttempts: boolean;
  };
}

export default function PhoneNumbersConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: config, isLoading, error } = useQuery<PhoneValidationConfig>({
    queryKey: ["/api/variables/phone_validation_config"],
  });
  const [selectedMode, setSelectedMode] = useState<"local" | "twilio">("local");

  useEffect(() => {
    if (config) {
      setSelectedMode(config.mode);
    }
  }, [config]);

  const updateConfigMutation = useMutation({
    mutationFn: async (newMode: "local" | "twilio") => {
      const updatedConfig: PhoneValidationConfig = {
        mode: newMode,
        local: {
          enabled: newMode === "local",
          defaultCountry: config?.local?.defaultCountry || "US",
          strictValidation: config?.local?.strictValidation ?? true,
        },
        twilio: {
          enabled: newMode === "twilio",
          lookupType: config?.twilio?.lookupType || ["line_type_intelligence", "caller_name"],
        },
        fallback: config?.fallback || {
          useLocalOnTwilioFailure: true,
          logValidationAttempts: true,
        },
      };

      return apiRequest(
        "PUT",
        "/api/variables/phone_validation_config",
        updatedConfig,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/variables/phone_validation_config"],
      });
      toast({
        title: "Configuration Updated",
        description: `Phone validation mode changed to ${selectedMode === "local" ? "Local" : "Twilio Lookup"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update configuration.",
        variant: "destructive",
      });
      setSelectedMode(config?.mode || "local");
    },
  });

  const handleModeChange = (value: string) => {
    const newMode = value as "local" | "twilio";
    setSelectedMode(newMode);
    updateConfigMutation.mutate(newMode);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Phone Numbers Configuration
          </h1>
          <p className="text-muted-foreground mt-2">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Phone Numbers Configuration
          </h1>
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              Failed to load phone validation configuration. Please try again.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const currentMode = config?.mode || "local";
  const isTwilioMode = currentMode === "twilio";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Phone Numbers Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure how phone number validation works throughout the system
        </p>
      </div>

      {/* Current Status */}
      <Alert>
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>Current Mode</AlertTitle>
        <AlertDescription>
          Phone number validation is currently using{" "}
          <strong>{isTwilioMode ? "Twilio Lookup" : "Local"}</strong> mode.
        </AlertDescription>
      </Alert>

      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Validation Mode
          </CardTitle>
          <CardDescription>
            Choose between local pattern validation or Twilio Lookup API
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mode Selection */}
          <div className="space-y-4 p-4 border rounded-lg">
            <div className="space-y-1">
              <Label
                htmlFor="validation-mode"
                className="text-base font-medium"
              >
                Validation Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Select the phone number validation method for your application
              </p>
            </div>
            <Select
              value={selectedMode}
              onValueChange={handleModeChange}
              disabled={updateConfigMutation.isPending}
            >
              <SelectTrigger 
                id="validation-mode"
                className="w-full"
                data-testid="select-validation-mode"
              >
                <SelectValue placeholder="Select validation mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local" data-testid="option-local">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    <div>
                      <div className="font-medium">Local Validation</div>
                      <div className="text-xs text-muted-foreground">Pattern-based validation using libphonenumber-js</div>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="twilio" data-testid="option-twilio">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    <div>
                      <div className="font-medium">Twilio Lookup</div>
                      <div className="text-xs text-muted-foreground">Real-time validation using Twilio Lookup API</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mode-specific information */}
          {isTwilioMode && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertTitle>Twilio Lookup Enabled</AlertTitle>
              <AlertDescription>
                Phone numbers will be validated using Twilio's Lookup API, which provides
                real-time carrier information, caller name, and line type intelligence.
                {config?.fallback?.useLocalOnTwilioFailure && (
                  <> Falls back to local validation if Twilio is unavailable.</>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
