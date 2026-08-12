import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Loader2,
  ArrowRightLeft,
  Save,
  Building2,
  DollarSign,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  value?: any;
}

interface RateWarning {
  rowIndex: number;
  week: number;
  category: string;
  reported: number;
  expected: number;
  hours: number;
}

interface ValidationResults {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ValidationError[];
  errorSummary: Record<string, number>;
  unmappedStatuses?: string[];
  unmappedLocations?: string[];
  ssnWarnings?: Array<{ rowIndex: number; value?: any; message: string }>;
  rateWarnings?: RateWarning[];
  rateWarningsTruncated?: boolean;
  completedAt?: string;
}

interface EmploymentStatusOption {
  id: string;
  name: string;
  code: string;
  employed: boolean;
}

interface ValidateData {
  validationResults: ValidationResults | null;
  existingStatusMappings: Array<{ sourceStatus: string; targetStatusId: string }>;
  existingLocationMappings: Array<{ sourceLocation: string; targetEmployerId: string }>;
  accessibleEmployers: Array<{ id: string; name: string }>;
}

/**
 * Validate step for the GBHE Local 26 Hourly wizard. Same dispatcher flow
 * as the GBHET validate step, plus a work-location mapping panel and a
 * warn-only rate-discrepancy panel.
 */
export function Local26Validate({ wizardId, step }: WizardStepComponentProps) {
  const { data: stepData, isLoading } = useQuery<ValidateData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [isValidating, setIsValidating] = useState(false);
  const [results, setResults] = useState<ValidationResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMappings, setStatusMappings] = useState<Record<string, string>>({});
  const [locationMappings, setLocationMappings] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!stepData || hydrated) return;
    setResults(stepData.validationResults ?? null);
    setHydrated(true);
  }, [stepData, hydrated]);

  const { data: employmentStatusOptions } = useQuery<EmploymentStatusOption[]>({
    queryKey: ["/api/employment-status-options"],
    enabled: !!(results?.unmappedStatuses && results.unmappedStatuses.length > 0),
  });

  const pollForCompletion = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 1200 : 4000),
      );
      const res = await fetch(`/api/wizards/${wizardId}`, { credentials: "include" });
      if (!res.ok) continue;
      const wizard = await res.json();
      const progress = wizard?.data?.progress?.[step.id]?.status;
      if (progress === "completed" || progress === "failed") {
        setResults(wizard?.data?.validationResults ?? null);
        setStatusMappings({});
        setLocationMappings({});
        setIsValidating(false);
        queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
        queryClient.invalidateQueries({
          queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
        });
        if (progress === "failed") {
          setError(wizard?.data?.progress?.[step.id]?.error || "Validation failed");
        }
        return;
      }
    }
    setError("Validation is taking longer than expected. Please refresh the page to check the results.");
    setIsValidating(false);
  };

  const startValidation = async () => {
    setIsValidating(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/run`, {});
      await pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setIsValidating(false);
    }
  };

  const handleSaveMappings = async () => {
    const statuses = Object.entries(statusMappings)
      .filter(([, id]) => id)
      .map(([sourceStatus, targetStatusId]) => ({ sourceStatus, targetStatusId }));
    const locations = Object.entries(locationMappings)
      .filter(([, id]) => id)
      .map(([sourceLocation, targetEmployerId]) => ({ sourceLocation, targetEmployerId }));
    if (statuses.length === 0 && locations.length === 0) return;

    setIsSaving(true);
    setError(null);
    try {
      await apiRequest("POST", `/api/wizards/${wizardId}/dispatch/${step.id}/submit`, {
        input: {
          ...(statuses.length > 0 ? { mappings: statuses } : {}),
          ...(locations.length > 0 ? { locationMappings: locations } : {}),
        },
      });
      setSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mappings");
    } finally {
      setIsSaving(false);
    }
  };

  const groupedErrors =
    results?.errors.reduce(
      (acc, err) => {
        const key = `${err.field}: ${err.message}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(err);
        return acc;
      },
      {} as Record<string, ValidationError[]>,
    ) || {};

  const hasUnmappedStatuses = !!(results?.unmappedStatuses && results.unmappedStatuses.length > 0);
  const hasUnmappedLocations = !!(results?.unmappedLocations && results.unmappedLocations.length > 0);
  const hasSsnWarnings = !!(results?.ssnWarnings && results.ssnWarnings.length > 0);
  const hasRateWarnings = !!(results?.rateWarnings && results.rateWarnings.length > 0);

  const allStatusesMapped =
    !hasUnmappedStatuses || results!.unmappedStatuses!.every((s) => statusMappings[s]);
  const allLocationsMapped =
    !hasUnmappedLocations || results!.unmappedLocations!.every((l) => locationMappings[l]);
  const anySelected =
    Object.values(statusMappings).some(Boolean) ||
    Object.values(locationMappings).some(Boolean);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Validate Data</CardTitle>
          <CardDescription>
            Check rows, employment statuses, work locations and expected
            weekly withholding rates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isValidating && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-center">
                Ready to validate your data. Click below to start.
              </p>
              <Button onClick={startValidation} size="lg" data-testid="button-start-validation">
                <Play className="mr-2 h-4 w-4" />
                Start Validation
              </Button>
            </div>
          )}

          {isValidating && (
            <div className="flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Validating data...</span>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Validation Failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {results && !isValidating && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Validation Results</h3>
                <Button onClick={startValidation} variant="outline" size="sm" data-testid="button-revalidate">
                  <Play className="mr-2 h-3 w-3" />
                  Re-validate
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <p className="text-2xl font-bold" data-testid="text-total-rows">
                      {results.totalRows.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Total Rows</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex items-center justify-center space-x-2">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <p className="text-2xl font-bold text-green-600" data-testid="text-valid-rows">
                        {results.validRows.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">Valid Rows</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="flex items-center justify-center space-x-2">
                      <XCircle className="h-5 w-5 text-red-600" />
                      <p className="text-2xl font-bold text-red-600" data-testid="text-invalid-rows">
                        {results.invalidRows.toLocaleString()}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">Invalid Rows</p>
                  </CardContent>
                </Card>
              </div>

              {hasUnmappedStatuses && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ArrowRightLeft className="h-4 w-4 text-amber-600" />
                      Unrecognized Employment Statuses
                    </CardTitle>
                    <CardDescription>
                      Map each status from your file to a configured
                      employment status. Mappings are saved per employer and
                      reused on future uploads.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {results.unmappedStatuses!.map((sourceStatus) => (
                      <div key={sourceStatus} className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <Badge variant="outline" className="font-mono text-sm">
                            {sourceStatus}
                          </Badge>
                        </div>
                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1">
                          <Select
                            value={statusMappings[sourceStatus] || ""}
                            onValueChange={(value) => {
                              setStatusMappings((prev) => ({ ...prev, [sourceStatus]: value }));
                              setSaveSuccess(false);
                            }}
                          >
                            <SelectTrigger data-testid={`select-status-mapping-${sourceStatus}`}>
                              <SelectValue placeholder="Select status..." />
                            </SelectTrigger>
                            <SelectContent>
                              {employmentStatusOptions?.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.name} ({option.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {hasUnmappedLocations && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-amber-600" />
                      Unrecognized Work Locations
                    </CardTitle>
                    <CardDescription>
                      Map each work location from your file to an employer you
                      have access to. Mappings are saved and reused on future
                      uploads.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {results.unmappedLocations!.map((sourceLocation) => (
                      <div key={sourceLocation} className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <Badge variant="outline" className="font-mono text-sm">
                            {sourceLocation}
                          </Badge>
                        </div>
                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1">
                          <Select
                            value={locationMappings[sourceLocation] || ""}
                            onValueChange={(value) => {
                              setLocationMappings((prev) => ({ ...prev, [sourceLocation]: value }));
                              setSaveSuccess(false);
                            }}
                          >
                            <SelectTrigger data-testid={`select-location-mapping-${sourceLocation}`}>
                              <SelectValue placeholder="Select employer..." />
                            </SelectTrigger>
                            <SelectContent>
                              {stepData?.accessibleEmployers?.map((emp) => (
                                <SelectItem key={emp.id} value={emp.id}>
                                  {emp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {(hasUnmappedStatuses || hasUnmappedLocations) && (
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSaveMappings}
                    disabled={!anySelected || isSaving}
                    data-testid="button-save-mappings"
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save Mappings
                  </Button>
                  {saveSuccess && (
                    <Button
                      onClick={startValidation}
                      variant="outline"
                      data-testid="button-revalidate-after-mapping"
                    >
                      <Play className="mr-2 h-4 w-4" />
                      Re-validate with Mappings
                    </Button>
                  )}
                  {saveSuccess && (
                    <span className="text-sm text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Saved
                    </span>
                  )}
                  {!(allStatusesMapped && allLocationsMapped) && (
                    <span className="text-xs text-muted-foreground">
                      Map every item, save, then re-validate.
                    </span>
                  )}
                </div>
              )}

              {hasRateWarnings && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-amber-600" />
                      Rate Discrepancies (warnings only)
                    </CardTitle>
                    <CardDescription>
                      Reported weekly withholdings differ from the amounts
                      expected from the configured hourly rates. Nothing is
                      written to the ledger for these columns — this is
                      informational.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[240px]">
                      <div className="space-y-1">
                        {results.rateWarnings!.map((w, idx) => (
                          <div
                            key={idx}
                            className="text-sm text-muted-foreground border-l-2 border-amber-300 pl-3 py-1"
                            data-testid={`rate-warning-${idx}`}
                          >
                            <span className="font-mono">Row {w.rowIndex + 1}</span>
                            <span className="ml-2">
                              Week {w.week} {w.category}: reported ${w.reported.toFixed(2)},
                              expected ${w.expected.toFixed(2)} ({w.hours} hrs)
                            </span>
                          </div>
                        ))}
                        {results.rateWarningsTruncated && (
                          <p className="text-xs text-muted-foreground italic pl-3">
                            ... additional rate warnings not shown
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {hasSsnWarnings && (
                <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      SSN Format Warnings
                    </CardTitle>
                    <CardDescription>
                      These rows have a badly formatted SSN. Warnings only —
                      each row is imported as best it can.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[200px]">
                      <div className="space-y-1">
                        {results.ssnWarnings!.map((warning, idx) => (
                          <div
                            key={idx}
                            className="text-sm text-muted-foreground border-l-2 border-amber-300 pl-3 py-1"
                            data-testid={`ssn-warning-${idx}`}
                          >
                            <span className="font-mono">Row {warning.rowIndex + 1}</span>
                            <span className="ml-2">{warning.message}</span>
                            {warning.value !== undefined && warning.value !== null && (
                              <span className="ml-2">
                                (value: <span className="font-mono">{JSON.stringify(warning.value)}</span>)
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {results.invalidRows > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Validation Errors</CardTitle>
                    <CardDescription>
                      Showing first 12 errors per type. Fix these issues before proceeding.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-4">
                        {Object.entries(groupedErrors).map(([errorType, errors]) => (
                          <div key={errorType} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="font-medium text-sm">{errorType}</h4>
                              <Badge variant="destructive">
                                {results.errorSummary[errorType]?.toLocaleString() || errors.length} errors
                              </Badge>
                            </div>
                            <div className="space-y-1 pl-4">
                              {errors.slice(0, 12).map((err, idx) => (
                                <div
                                  key={idx}
                                  className="text-sm text-muted-foreground border-l-2 border-red-200 pl-3 py-1"
                                  data-testid={`error-item-${err.field}-${idx}`}
                                >
                                  <span className="font-mono">
                                    {err.rowIndex >= 0 ? `Row ${err.rowIndex + 1}` : "File"}
                                  </span>
                                  {err.value !== undefined && err.value !== null && (
                                    <span className="ml-2">
                                      (value: <span className="font-mono">{JSON.stringify(err.value)}</span>)
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                            <Separator />
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {results.invalidRows === 0 && !hasUnmappedStatuses && !hasUnmappedLocations && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>
                    {hasSsnWarnings || hasRateWarnings ? "Ready to Proceed" : "All Data Valid"}
                  </AlertTitle>
                  <AlertDescription>
                    All {results.totalRows.toLocaleString()} rows passed validation
                    {hasRateWarnings ? " (with rate warnings noted above)" : ""}
                    {hasSsnWarnings ? " (with SSN warnings noted above)" : ""}. You can
                    proceed to the next step.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
