import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { CronSettingsComponentProps } from "@/lib/cron-settings-registry";

interface PolicyRow {
  module: string | null;
  operation: string | null;
  count: number;
  retentionDays: number | null;
  enabled: boolean;
}

interface RetentionPolicy {
  module: string | null;
  operation: string | null;
  retentionDays: number;
  enabled: boolean;
}

interface ModuleGroup {
  module: string | null;
  displayName: string;
  operations: PolicyRow[];
  totalCount: number;
  configuredCount: number;
  enabledCount: number;
}

export function LogCleanupPolicies({ clientState, values, onSave, isSaving }: CronSettingsComponentProps) {
  const initialRows = (clientState.rows as PolicyRow[]) ?? [];
  
  const [rows, setRows] = useState<PolicyRow[]>(initialRows);
  const [hasChanges, setHasChanges] = useState(false);
  const [bulkDays, setBulkDays] = useState<Record<string, string>>({});

  useEffect(() => {
    setRows((clientState.rows as PolicyRow[]) ?? []);
  }, [clientState.rows]);

  const groupedModules = useMemo((): ModuleGroup[] => {
    const moduleMap = new Map<string | null, PolicyRow[]>();
    
    for (const row of rows) {
      const key = row.module;
      if (!moduleMap.has(key)) {
        moduleMap.set(key, []);
      }
      moduleMap.get(key)!.push(row);
    }

    const groups: ModuleGroup[] = Array.from(moduleMap.entries()).map(
      ([module, operations]: [string | null, PolicyRow[]]) => ({
        module,
        displayName: module ?? "(none)",
        operations: operations.sort((a: PolicyRow, b: PolicyRow) => 
          (a.operation ?? "").localeCompare(b.operation ?? "")
        ),
        totalCount: operations.reduce((sum: number, op: PolicyRow) => sum + op.count, 0),
        configuredCount: operations.filter((op: PolicyRow) => op.retentionDays !== null).length,
        enabledCount: operations.filter((op: PolicyRow) => op.enabled).length,
      })
    );

    return groups.sort((a: ModuleGroup, b: ModuleGroup) => a.displayName.localeCompare(b.displayName));
  }, [rows]);

  const findRowIndex = (module: string | null, operation: string | null): number => {
    return rows.findIndex(r => r.module === module && r.operation === operation);
  };

  const handleRetentionDaysChange = (module: string | null, operation: string | null, value: string) => {
    const index = findRowIndex(module, operation);
    if (index === -1) return;
    
    const newRows = [...rows];
    const numValue = value === "" ? null : parseInt(value, 10);
    newRows[index] = {
      ...newRows[index],
      retentionDays: numValue && !isNaN(numValue) ? Math.max(1, Math.min(3650, numValue)) : null,
    };
    setRows(newRows);
    setHasChanges(true);
  };

  const handleEnabledChange = (module: string | null, operation: string | null, enabled: boolean) => {
    const index = findRowIndex(module, operation);
    if (index === -1) return;
    
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], enabled };
    setRows(newRows);
    setHasChanges(true);
  };

  const handleSetAllForModule = (module: string | null) => {
    const displayName = module ?? "(none)";
    const daysStr = bulkDays[displayName] ?? "";
    const days = parseInt(daysStr, 10);
    if (!days || isNaN(days) || days < 1) return;
    
    const clampedDays = Math.max(1, Math.min(3650, days));
    
    const newRows = rows.map(row => {
      if (row.module === module) {
        return {
          ...row,
          retentionDays: clampedDays,
          enabled: true,
        };
      }
      return row;
    });
    
    setRows(newRows);
    setHasChanges(true);
  };

  const handleSave = async () => {
    const policies: RetentionPolicy[] = rows
      .filter(row => row.retentionDays !== null)
      .map(row => ({
        module: row.module,
        operation: row.operation,
        retentionDays: row.retentionDays!,
        enabled: row.enabled,
      }));

    await onSave({ policies });
    setHasChanges(false);
  };

  const enabledCount = rows.filter(r => r.enabled).length;
  const configuredCount = rows.filter(r => r.retentionDays !== null).length;

  const formatOperation = (value: string | null): string => {
    if (value === null) return "(none)";
    return value;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Retention Policies</CardTitle>
        <CardDescription>
          Configure retention periods for each module/operation combination. 
          Only enabled policies with a retention period will be processed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Badge variant="outline" data-testid="badge-configured-count">
              {configuredCount} configured
            </Badge>
            <Badge variant={enabledCount > 0 ? "default" : "secondary"} data-testid="badge-enabled-count">
              {enabledCount} enabled
            </Badge>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            data-testid="button-save-policies"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Policies
              </>
            )}
          </Button>
        </div>

        {enabledCount === 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No policies are enabled. The log cleanup job will not delete any logs until you enable at least one policy.
            </AlertDescription>
          </Alert>
        )}

        {groupedModules.length === 0 ? (
          <div className="rounded-md border p-8 text-center text-muted-foreground">
            No log entries found in the database
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-2" data-testid="accordion-modules">
            {groupedModules.map((group) => (
              <AccordionItem
                key={group.displayName}
                value={group.displayName}
                className="border rounded-md px-4"
                data-testid={`accordion-module-${group.displayName}`}
              >
                <AccordionTrigger className="hover:no-underline py-3">
                  <div className="flex items-center justify-between w-full pr-4 gap-4">
                    <span className="font-mono font-medium text-sm">{group.displayName}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {group.operations.length} ops
                      </Badge>
                      <Badge variant="outline" className="text-xs tabular-nums">
                        {group.totalCount.toLocaleString()} logs
                      </Badge>
                      {group.configuredCount > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {group.configuredCount} configured
                        </Badge>
                      )}
                      {group.enabledCount > 0 && (
                        <Badge variant="default" className="text-xs">
                          {group.enabledCount} enabled
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pb-2">
                    <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                      <span className="text-sm text-muted-foreground">Set all to</span>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={bulkDays[group.displayName] ?? ""}
                        onChange={(e) => setBulkDays({ ...bulkDays, [group.displayName]: e.target.value })}
                        placeholder="days"
                        className="w-20 h-8"
                        data-testid={`input-bulk-days-${group.displayName}`}
                      />
                      <span className="text-sm text-muted-foreground">days and enable</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSetAllForModule(group.module)}
                        disabled={!bulkDays[group.displayName] || parseInt(bulkDays[group.displayName]) < 1}
                        data-testid={`button-set-all-${group.displayName}`}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Apply
                      </Button>
                    </div>
                    
                    {group.operations.map((op) => (
                      <div
                        key={`${op.module ?? ''}::${op.operation ?? ''}`}
                        className="flex items-center gap-3 py-2 px-2 rounded-md bg-muted/50"
                        data-testid={`row-policy-${op.module ?? 'none'}-${op.operation ?? 'none'}`}
                      >
                        <span className="font-mono text-sm min-w-32 flex-shrink-0">
                          {formatOperation(op.operation)}
                        </span>
                        <span className="text-sm text-muted-foreground tabular-nums min-w-20 text-right">
                          {op.count.toLocaleString()} logs
                        </span>
                        <div className="flex items-center gap-2 ml-auto">
                          <Input
                            type="number"
                            min={1}
                            max={3650}
                            value={op.retentionDays ?? ""}
                            onChange={(e) => handleRetentionDaysChange(op.module, op.operation, e.target.value)}
                            placeholder="days"
                            className="w-20 h-8"
                            data-testid={`input-retention-${op.module ?? 'none'}-${op.operation ?? 'none'}`}
                          />
                          <div className="flex items-center gap-1.5">
                            <Switch
                              checked={op.enabled}
                              onCheckedChange={(checked) => handleEnabledChange(op.module, op.operation, checked)}
                              disabled={op.retentionDays === null}
                              data-testid={`switch-enabled-${op.module ?? 'none'}-${op.operation ?? 'none'}`}
                            />
                            <span className="text-xs text-muted-foreground w-8">
                              {op.enabled ? "On" : "Off"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        <p className="text-sm text-muted-foreground">
          Logs older than the retention period will be permanently deleted when the cleanup job runs.
          You must set a retention period before you can enable a policy.
        </p>
      </CardContent>
    </Card>
  );
}
