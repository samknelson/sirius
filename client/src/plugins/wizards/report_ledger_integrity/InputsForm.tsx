import { pluginManifestQueryKey } from "@/plugins/_core";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Filter } from "lucide-react";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
}

/**
 * Escape-hatch Inputs step for the Ledger Integrity report wizard. Ported
 * from the legacy report step: the charge-plugin multiselect + optional
 * date range. Instead of auto-saving via a wizard PUT/PATCH, it persists
 * through the fixed dispatcher submit route so the wizard stays "in a box"
 * with no wizard-specific endpoints.
 */
export function InputsForm({ wizardId, step, data }: WizardStepComponentProps) {
  const { toast } = useToast();
  const config = (data?.config as {
    chargePlugins?: string[];
    dateFrom?: string;
    dateTo?: string;
  }) || {};

  const [selectedPlugins, setSelectedPlugins] = useState<string[]>(
    config.chargePlugins || [],
  );
  const [dateFrom, setDateFrom] = useState(config.dateFrom || "");
  const [dateTo, setDateTo] = useState(config.dateTo || "");

  const { data: plugins = [], isLoading: pluginsLoading } = useQuery<
    ChargePluginMetadata[]
  >({
    queryKey: pluginManifestQueryKey("charge"),
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: {
          chargePlugins: selectedPlugins,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({ title: "Saved", description: "Report configuration saved." });
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message || "Failed to save configuration",
        variant: "destructive",
      });
    },
  });

  const handlePluginToggle = (pluginId: string, checked: boolean) => {
    setSelectedPlugins((prev) =>
      checked ? [...prev, pluginId] : prev.filter((id) => id !== pluginId),
    );
  };

  if (pluginsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Configuration</CardTitle>
          <CardDescription>Loading available charge plugins...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ledger Integrity Check Configuration</CardTitle>
        <CardDescription>
          Configure which charge plugins and date range to include in the
          verification
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Report Description
            </p>
            <p className="text-sm text-blue-800 dark:text-blue-200">
              This report verifies that ledger entries match what the charge
              plugins would compute based on the source data. It reports any
              discrepancies without making changes.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label className="text-base font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Charge Plugins to Verify
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedPlugins(plugins.map((p) => p.id))}
                data-testid="button-select-all-plugins"
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedPlugins([])}
                data-testid="button-clear-all-plugins"
              >
                Clear All
              </Button>
            </div>
          </div>

          {plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No charge plugins are currently registered.
            </p>
          ) : (
            <div className="grid gap-3 border rounded-md p-4">
              {plugins.map((plugin) => (
                <div key={plugin.id} className="flex items-start gap-3">
                  <Checkbox
                    id={`plugin-${plugin.id}`}
                    checked={selectedPlugins.includes(plugin.id)}
                    onCheckedChange={(checked) =>
                      handlePluginToggle(plugin.id, checked === true)
                    }
                    data-testid={`checkbox-plugin-${plugin.id}`}
                  />
                  <div className="grid gap-1">
                    <Label
                      htmlFor={`plugin-${plugin.id}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {plugin.name}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {plugin.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {selectedPlugins.length === 0
              ? "All plugins will be included when none are selected."
              : `${selectedPlugins.length} plugin(s) selected.`}
          </p>
        </div>

        <div className="space-y-4">
          <Label className="text-base font-medium">Date Range (Optional)</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom" className="text-sm">
                From Date
              </Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateTo" className="text-sm">
                To Date
              </Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Filter ledger entries by transaction date. Leave blank to include
            all dates.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          data-testid="button-save-inputs"
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
