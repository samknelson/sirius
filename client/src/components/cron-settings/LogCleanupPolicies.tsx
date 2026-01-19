import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Save, Loader2, Trash2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

export function LogCleanupPolicies({ clientState, values, onSave, isSaving }: CronSettingsComponentProps) {
  const initialRows = (clientState.rows as PolicyRow[]) ?? [];
  const initialPolicies = (values.policies as RetentionPolicy[]) ?? [];
  
  const [rows, setRows] = useState<PolicyRow[]>(initialRows);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setRows((clientState.rows as PolicyRow[]) ?? []);
  }, [clientState.rows]);

  const handleRetentionDaysChange = (index: number, value: string) => {
    const newRows = [...rows];
    const numValue = value === "" ? null : parseInt(value, 10);
    newRows[index] = {
      ...newRows[index],
      retentionDays: numValue && !isNaN(numValue) ? Math.max(1, Math.min(3650, numValue)) : null,
    };
    setRows(newRows);
    setHasChanges(true);
  };

  const handleEnabledChange = (index: number, enabled: boolean) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], enabled };
    setRows(newRows);
    setHasChanges(true);
  };

  const handleClearPolicy = (index: number) => {
    const newRows = [...rows];
    newRows[index] = {
      ...newRows[index],
      retentionDays: null,
      enabled: false,
    };
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

  const formatLabel = (value: string | null): string => {
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

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead className="text-right">Log Count</TableHead>
                <TableHead className="w-32">Retention (days)</TableHead>
                <TableHead className="w-24">Enabled</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No log entries found in the database
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, index) => (
                  <TableRow key={`${row.module ?? ''}::${row.operation ?? ''}`} data-testid={`row-policy-${index}`}>
                    <TableCell className="font-mono text-sm">
                      {formatLabel(row.module)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatLabel(row.operation)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.count.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={row.retentionDays ?? ""}
                        onChange={(e) => handleRetentionDaysChange(index, e.target.value)}
                        placeholder="days"
                        className="w-24 h-8"
                        data-testid={`input-retention-${index}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.enabled}
                        onCheckedChange={(checked) => handleEnabledChange(index, checked)}
                        disabled={row.retentionDays === null}
                        data-testid={`switch-enabled-${index}`}
                      />
                    </TableCell>
                    <TableCell>
                      {row.retentionDays !== null && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleClearPolicy(index)}
                          data-testid={`button-clear-${index}`}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          Logs older than the retention period will be permanently deleted when the cleanup job runs.
          You must set a retention period before you can enable a policy.
        </p>
      </CardContent>
    </Card>
  );
}
