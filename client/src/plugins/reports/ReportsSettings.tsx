import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PluginSettingsProps } from "../types";

interface Role {
  id: string;
  name: string;
  description: string | null;
}

interface WizardType {
  name: string;
  displayName: string;
  description: string;
  isReport?: boolean;
}

type ReportsSettings = Record<string, string[]>;

export function ReportsSettings({ plugin, queryClient, onConfigSaved, loadSettings, saveSettings }: PluginSettingsProps<ReportsSettings>) {
  const { toast } = useToast();
  
  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: wizardTypes = [], isLoading: typesLoading } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const { data: reportsSettings = {}, isLoading: settingsLoading } = useQuery<ReportsSettings>({
    queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`],
    queryFn: loadSettings,
  });

  const [editedSettings, setEditedSettings] = useState<ReportsSettings>({});

  useEffect(() => {
    if (reportsSettings) {
      setEditedSettings(reportsSettings);
    }
  }, [reportsSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (settings: ReportsSettings) => {
      await saveSettings(settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/dashboard-plugins/${plugin.id}/settings`] });
      toast({
        title: "Reports Settings Updated",
        description: "Dashboard reports configuration has been saved successfully.",
      });
      onConfigSaved?.();
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update reports settings.",
        variant: "destructive",
      });
    },
  });

  const handleSaveAll = () => {
    updateSettingsMutation.mutate(editedSettings);
  };

  const handleToggleReport = (roleId: string, reportType: string) => {
    setEditedSettings((prev) => {
      const roleReports = prev[roleId] || [];
      const isEnabled = roleReports.includes(reportType);
      
      if (isEnabled) {
        return {
          ...prev,
          [roleId]: roleReports.filter(r => r !== reportType)
        };
      } else {
        return {
          ...prev,
          [roleId]: [...roleReports, reportType]
        };
      }
    });
  };

  const hasChanges = () => {
    return JSON.stringify(editedSettings) !== JSON.stringify(reportsSettings);
  };

  if (rolesLoading || typesLoading || settingsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard Reports
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  // Filter to only show report wizard types
  const reportTypes = wizardTypes.filter(type => type.isReport);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Dashboard Reports
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure which reports appear on the dashboard for each role.
        </p>
      </div>

      <div className="space-y-4">
        {roles.map((role) => {
          const roleReports = editedSettings[role.id] || [];
          
          return (
            <Card key={role.id} data-testid={`role-reports-${role.id}`}>
              <CardHeader>
                <CardTitle>{role.name}</CardTitle>
                <CardDescription>{role.description || "Configure reports for this role"}</CardDescription>
              </CardHeader>
              <CardContent>
                {reportTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No report types available.</p>
                ) : (
                  <div className="space-y-3">
                    {reportTypes.map((reportType) => {
                      const isEnabled = roleReports.includes(reportType.name);
                      return (
                        <div key={reportType.name} className="flex items-start space-x-3">
                          <Checkbox
                            id={`${role.id}-${reportType.name}`}
                            checked={isEnabled}
                            onCheckedChange={() => handleToggleReport(role.id, reportType.name)}
                            data-testid={`checkbox-${role.id}-${reportType.name}`}
                          />
                          <div className="grid gap-1.5 leading-none">
                            <Label
                              htmlFor={`${role.id}-${reportType.name}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {reportType.displayName}
                            </Label>
                            <p className="text-sm text-muted-foreground">
                              {reportType.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={handleSaveAll}
          disabled={!hasChanges() || updateSettingsMutation.isPending}
          data-testid="button-save-reports-settings"
        >
          {updateSettingsMutation.isPending ? "Saving..." : "Save All Changes"}
        </Button>
      </div>
    </div>
  );
}
