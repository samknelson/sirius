import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Filter } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
}

interface LedgerIntegrityInputsStepProps {
  wizardId: string;
  wizardType: string;
  data?: {
    config?: {
      chargePlugins?: string[];
      dateFrom?: string;
      dateTo?: string;
    };
  };
  onDataChange?: (data: any) => void;
}

export function LedgerIntegrityInputsStep({ 
  wizardId, 
  wizardType, 
  data,
  onDataChange 
}: LedgerIntegrityInputsStepProps) {
  const config = data?.config || {};
  
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>(config.chargePlugins || []);
  const [dateFrom, setDateFrom] = useState(config.dateFrom || "");
  const [dateTo, setDateTo] = useState(config.dateTo || "");

  const { data: plugins = [], isLoading: pluginsLoading } = useQuery<ChargePluginMetadata[]>({
    queryKey: ["/api/charge-plugins"],
  });

  const saveConfigMutation = useMutation({
    mutationFn: async (newConfig: any) => {
      return await apiRequest("PUT", `/api/wizards/${wizardId}`, {
        data: {
          ...data,
          config: newConfig,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", wizardId] });
    },
  });

  useEffect(() => {
    const newConfig = {
      chargePlugins: selectedPlugins,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };

    const timer = setTimeout(() => {
      saveConfigMutation.mutate(newConfig);
    }, 500);

    return () => clearTimeout(timer);
  }, [selectedPlugins, dateFrom, dateTo]);

  const handlePluginToggle = (pluginId: string, checked: boolean) => {
    if (checked) {
      setSelectedPlugins([...selectedPlugins, pluginId]);
    } else {
      setSelectedPlugins(selectedPlugins.filter(id => id !== pluginId));
    }
  };

  const handleSelectAll = () => {
    setSelectedPlugins(plugins.map(p => p.id));
  };

  const handleClearAll = () => {
    setSelectedPlugins([]);
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
          Configure which charge plugins and date range to include in the verification
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
              This report verifies that ledger entries match what the charge plugins would compute 
              based on the source data. It reports any discrepancies without making changes.
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
                onClick={handleSelectAll}
                data-testid="button-select-all-plugins"
              >
                Select All
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                onClick={handleClearAll}
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
                    onCheckedChange={(checked) => handlePluginToggle(plugin.id, checked === true)}
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
              : `${selectedPlugins.length} plugin(s) selected.`
            }
          </p>
        </div>

        <div className="space-y-4">
          <Label className="text-base font-medium">Date Range (Optional)</Label>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dateFrom" className="text-sm">From Date</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateTo" className="text-sm">To Date</Label>
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
            Filter ledger entries by transaction date. Leave blank to include all dates.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
