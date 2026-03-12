import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Loader2, Save, Settings } from "lucide-react";
import { Variable } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Role } from "@/lib/entity-types";

const VARIABLE_NAME = "edls_settings";

interface Employer {
  id: string;
  name: string;
}

interface EdlsSettings {
  supervisor_role: string | null;
  employer: string | null;
}

const DEFAULT_SETTINGS: EdlsSettings = {
  supervisor_role: null,
  employer: null,
};

export default function EdlsSettingsPage() {
  usePageTitle("EDLS Settings");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<EdlsSettings>(DEFAULT_SETTINGS);

  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: employers = [], isLoading: employersLoading } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: settingsVariable, isLoading: variableLoading } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", VARIABLE_NAME],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/variables/by-name/${VARIABLE_NAME}`);
        if (response.status === 404) {
          return null;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch EDLS settings variable");
        }
        return response.json();
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (settingsVariable?.value) {
      try {
        const parsed = typeof settingsVariable.value === 'string' 
          ? JSON.parse(settingsVariable.value) 
          : settingsVariable.value;
        setSettings({
          supervisor_role: parsed.supervisor_role || null,
          employer: parsed.employer || null,
        });
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    }
  }, [settingsVariable]);

  const saveMutation = useMutation({
    mutationFn: async (newSettings: EdlsSettings) => {
      const jsonValue = JSON.stringify(newSettings);
      if (settingsVariable) {
        return apiRequest("PUT", `/api/variables/${settingsVariable.id}`, {
          value: jsonValue,
        });
      } else {
        return apiRequest("POST", "/api/variables", {
          name: VARIABLE_NAME,
          value: jsonValue,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/variables/by-name", VARIABLE_NAME] });
      toast({
        title: "Success",
        description: "EDLS settings have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save EDLS settings.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  const getCurrentSettings = (): EdlsSettings => {
    if (settingsVariable?.value) {
      try {
        const parsed = typeof settingsVariable.value === 'string'
          ? JSON.parse(settingsVariable.value)
          : settingsVariable.value;
        return {
          supervisor_role: parsed.supervisor_role || null,
          employer: parsed.employer || null,
        };
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  };

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(getCurrentSettings());

  const isLoading = rolesLoading || employersLoading || variableLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const selectedRole = roles.find(r => r.id === settings.supervisor_role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="heading-edls-settings">
          EDLS Settings
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure settings for the Employer Day Labor Scheduler
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Supervisor Role Configuration
          </CardTitle>
          <CardDescription>
            Select the role that will be used for EDLS supervisors
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="supervisor-role">Supervisor Role</Label>
            <Select
              value={settings.supervisor_role || ""}
              onValueChange={(value) => setSettings({ ...settings, supervisor_role: value || null })}
            >
              <SelectTrigger id="supervisor-role" data-testid="select-supervisor-role">
                <SelectValue placeholder="Select a role..." />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id} data-testid={`option-role-${role.id}`}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRole?.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {selectedRole.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="employer">Employer</Label>
            <Select
              value={settings.employer || ""}
              onValueChange={(value) => setSettings({ ...settings, employer: value || null })}
            >
              <SelectTrigger id="employer" data-testid="select-employer">
                <SelectValue placeholder="Select an employer..." />
              </SelectTrigger>
              <SelectContent>
                {employers.map((employer) => (
                  <SelectItem key={employer.id} value={employer.id} data-testid={`option-employer-${employer.id}`}>
                    {employer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-edls-settings"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
