import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Settings, Loader2, CheckCircle } from "lucide-react";
import { Policy, Variable } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const VARIABLE_NAME = "policy_default";

export default function DefaultPolicyPage() {
  usePageTitle("Default Policy");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");

  const { data: policies = [], isLoading: policiesLoading } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const { data: defaultPolicyVariable, isLoading: variableLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/variables/by-name/${VARIABLE_NAME}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch default policy variable");
        }
        return response.json();
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (defaultPolicyVariable?.value) {
      const value = defaultPolicyVariable.value as string;
      setSelectedPolicyId(value);
    }
  }, [defaultPolicyVariable]);

  const saveMutation = useMutation({
    mutationFn: async (policyId: string) => {
      if (defaultPolicyVariable) {
        return apiRequest("PUT", `/api/variables/${defaultPolicyVariable.id}`, {
          value: policyId,
        });
      } else {
        return apiRequest("POST", "/api/variables", {
          name: VARIABLE_NAME,
          value: policyId,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      toast({
        title: "Success",
        description: "Default policy has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save default policy.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!selectedPolicyId) {
      toast({
        title: "Validation Error",
        description: "Please select a policy.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(selectedPolicyId);
  };

  const isLoading = policiesLoading || variableLoading;
  const currentValue = defaultPolicyVariable?.value ? String(defaultPolicyVariable.value) : "";
  const hasChanged = selectedPolicyId !== currentValue;
  const selectedPolicy = policies.find(p => p.id === selectedPolicyId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="heading-default-policy">
          Default Policy
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure the default policy for the system
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Default Policy Setting
          </CardTitle>
          <CardDescription>
            Select the policy that will be used as the default for the system
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Select Default Policy
            </label>
            <Select
              value={selectedPolicyId}
              onValueChange={setSelectedPolicyId}
            >
              <SelectTrigger className="w-full max-w-md" data-testid="select-default-policy">
                <SelectValue placeholder="Select a policy..." />
              </SelectTrigger>
              <SelectContent>
                {policies.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No policies available
                  </SelectItem>
                ) : (
                  policies.map((policy) => (
                    <SelectItem
                      key={policy.id}
                      value={policy.id}
                      data-testid={`option-policy-${policy.id}`}
                    >
                      {policy.name || policy.siriusId}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {selectedPolicy && (
              <p className="text-sm text-muted-foreground">
                Sirius ID: <span className="font-mono">{selectedPolicy.siriusId}</span>
              </p>
            )}
          </div>

          {currentValue && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span>
                Current default: {policies.find(p => p.id === currentValue)?.name || 
                  policies.find(p => p.id === currentValue)?.siriusId || 
                  currentValue}
              </span>
            </div>
          )}

          <div className="flex items-center gap-4 pt-4 border-t border-border flex-wrap">
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || !hasChanged || !selectedPolicyId}
              data-testid="button-save-default-policy"
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
            {hasChanged && selectedPolicyId && (
              <span className="text-sm text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
