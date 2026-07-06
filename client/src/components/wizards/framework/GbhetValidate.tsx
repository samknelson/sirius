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
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
  value?: any;
}

interface SsnWarning {
  rowIndex: number;
  value?: any;
  message: string;
}

interface ValidationResults {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ValidationError[];
  errorSummary: Record<string, number>;
  unmappedStatuses?: string[];
  ssnWarnings?: SsnWarning[];
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
  existingMappings: Array<{ sourceStatus: string; targetStatusId: string }>;
}

/**
 * `validate` step for the GBHET legal workers feeds, in the plugin
 * framework. Runs validation via the fixed dispatcher run route
 * (`POST /api/wizards/:id/dispatch/:stepId/run`), polls the wizard load
 * route for completion, and saves employment-status mappings through the
 * SAME generic submit route — no wizard-specific endpoint (the legacy
 * EventSource `/validate` and `/status-mappings` routes are gone).
 */
export function GbhetValidate({ wizardId, step }: WizardStepComponentProps) {
  const { data: stepData, isLoading } = useQuery<ValidateData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [isValidating, setIsValidating] = useState(false);
  const [results, setResults] = useState<ValidationResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMappings, setStatusMappings] = useState<Record<string, string>>(
    {},
  );
  const [isSavingMappings, setIsSavingMappings] = useState(false);
  const [mappingSaveSuccess, setMappingSaveSuccess] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!stepData || hydrated) return;
    setResults(stepData.validationResults ?? null);
    setHydrated(true);
  }, [stepData, hydrated]);

  const { data: employmentStatusOptions } = useQuery<EmploymentStatusOption[]>({
    queryKey: ["/api/employment-status-options"],
    enabled: !!(
      results?.unmappedStatuses && results.unmappedStatuses.length > 0
    ),
  });

  const pollForCompletion = async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, attempt === 0 ? 1200 : 4000),
      );
      const res = await fetch(`/api/wizards/${wizardId}`, {
        credentials: "include",
      });
      if (!res.ok) continue;
      const wizard = await res.json();
      const progress = wizard?.data?.progress?.[step.id]?.status;
      if (progress === "completed" || progress === "failed") {
        const vr = wizard?.data?.validationResults ?? null;
        setResults(vr);
        setStatusMappings({});
        setIsValidating(false);
        queryClient.invalidateQueries({
          queryKey: [`/api/wizards/${wizardId}`],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
        });
        if (progress === "failed") {
          setError(
            wizard?.data?.progress?.[step.id]?.error || "Validation failed",
          );
        }
        return;
      }
    }
    setError(
      "Validation is taking longer than expected. Please refresh the page to check the results.",
    );
    setIsValidating(false);
  };

  const startValidation = async () => {
    setIsValidating(true);
    setError(null);
    setMappingSaveSuccess(false);
    try {
      // `run` is fire-and-forget on the server: it flips this step's progress
      // to `in_progress`, responds 202, then does the work asynchronously.
      // We therefore MUST poll the load route for the completed/failed
      // transition — reading `validationResults` right after the 202 would
      // return the previous run's stale results (e.g. after a re-validate).
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/run`,
        {},
      );
      await pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setIsValidating(false);
    }
  };

  const handleSaveMappings = async () => {
    const mappingsToSave = Object.entries(statusMappings)
      .filter(([, targetId]) => targetId)
      .map(([sourceStatus, targetStatusId]) => ({
        sourceStatus,
        targetStatusId,
      }));

    if (mappingsToSave.length === 0) return;

    setIsSavingMappings(true);
    setError(null);
    try {
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { mappings: mappingsToSave } },
      );
      setMappingSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mappings");
    } finally {
      setIsSavingMappings(false);
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

  const hasUnmappedStatuses =
    results?.unmappedStatuses && results.unmappedStatuses.length > 0;
  const allMapped =
    hasUnmappedStatuses &&
    results!.unmappedStatuses!.every((s) => statusMappings[s]);
  const hasSsnWarnings = !!(
    results?.ssnWarnings && results.ssnWarnings.length > 0
  );

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
            Check data integrity and ensure all required fields are properly
            formatted
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isValidating && !results && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <AlertCircle className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-center">
                Ready to validate your data. Click below to start.
              </p>
              <Button
                onClick={startValidation}
                size="lg"
                data-testid="button-start-validation"
              >
                <Play className="mr-2 h-4 w-4" />
                Start Validation
              </Button>
            </div>
          )}

          {isValidating && (
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">Validating data...</span>
              </div>
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
                <Button
                  onClick={startValidation}
                  variant="outline"
                  size="sm"
                  data-testid="button-revalidate"
                >
                  <Play className="mr-2 h-3 w-3" />
                  Re-validate
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p
                        className="text-2xl font-bold"
                        data-testid="text-total-rows"
                      >
                        {results.totalRows.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Rows</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <p
                          className="text-2xl font-bold text-green-600"
                          data-testid="text-valid-rows"
                        >
                          {results.validRows.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Valid Rows</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <p
                          className="text-2xl font-bold text-red-600"
                          data-testid="text-invalid-rows"
                        >
                          {results.invalidRows.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Invalid Rows
                      </p>
                    </div>
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
                      The following employment statuses from your file don't
                      match any configured options. Map each one to an existing
                      status, save, then re-validate.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {results.unmappedStatuses!.map((sourceStatus) => (
                      <div key={sourceStatus} className="flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <Badge
                            variant="outline"
                            className="font-mono text-sm"
                          >
                            {sourceStatus}
                          </Badge>
                        </div>
                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1">
                          <Select
                            value={statusMappings[sourceStatus] || ""}
                            onValueChange={(value) => {
                              setStatusMappings((prev) => ({
                                ...prev,
                                [sourceStatus]: value,
                              }));
                              setMappingSaveSuccess(false);
                            }}
                          >
                            <SelectTrigger
                              data-testid={`select-mapping-${sourceStatus}`}
                            >
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

                    <Separator />

                    <div className="flex items-center gap-3">
                      <Button
                        onClick={handleSaveMappings}
                        disabled={!allMapped || isSavingMappings}
                        data-testid="button-save-mappings"
                      >
                        {isSavingMappings ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        Save Mappings
                      </Button>

                      {mappingSaveSuccess && (
                        <Button
                          onClick={startValidation}
                          variant="outline"
                          data-testid="button-revalidate-after-mapping"
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Re-validate with Mappings
                        </Button>
                      )}

                      {mappingSaveSuccess && (
                        <span className="text-sm text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Saved
                        </span>
                      )}
                    </div>
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
                      The following rows have a badly formatted SSN. These are
                      warnings only — the file can still be processed, and each
                      row will be imported as best it can.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[240px]">
                      <div className="space-y-1">
                        {results.ssnWarnings!.map((warning, idx) => (
                          <div
                            key={idx}
                            className="text-sm text-muted-foreground border-l-2 border-amber-300 pl-3 py-1"
                            data-testid={`ssn-warning-${idx}`}
                          >
                            <span className="font-mono">
                              Row {warning.rowIndex + 1}
                            </span>
                            <span className="ml-2">{warning.message}</span>
                            {warning.value !== undefined &&
                              warning.value !== null && (
                                <span className="ml-2">
                                  (value:{" "}
                                  <span className="font-mono">
                                    {JSON.stringify(warning.value)}
                                  </span>
                                  )
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
                    <CardTitle className="text-base">
                      Validation Errors
                    </CardTitle>
                    <CardDescription>
                      Showing first 12 errors per type. Fix these issues before
                      proceeding.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-4">
                        {Object.entries(groupedErrors).map(
                          ([errorType, errors]) => (
                            <div key={errorType} className="space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium text-sm">
                                  {errorType}
                                </h4>
                                <Badge variant="destructive">
                                  {results.errorSummary[
                                    errorType
                                  ]?.toLocaleString() || errors.length}{" "}
                                  errors
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
                                      Row {err.rowIndex + 1}
                                    </span>
                                    {err.value !== undefined &&
                                      err.value !== null && (
                                        <span className="ml-2">
                                          (value:{" "}
                                          <span className="font-mono">
                                            {JSON.stringify(err.value)}
                                          </span>
                                          )
                                        </span>
                                      )}
                                  </div>
                                ))}
                                {(results.errorSummary[errorType] || 0) > 12 && (
                                  <p className="text-xs text-muted-foreground italic pl-3">
                                    ... and{" "}
                                    {(
                                      (results.errorSummary[errorType] || 0) - 12
                                    ).toLocaleString()}{" "}
                                    more similar errors
                                  </p>
                                )}
                              </div>
                              <Separator />
                            </div>
                          ),
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {results.invalidRows === 0 && !hasUnmappedStatuses && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>
                    {hasSsnWarnings ? "Ready to Proceed" : "All Data Valid"}
                  </AlertTitle>
                  <AlertDescription>
                    {hasSsnWarnings
                      ? `All ${results.totalRows.toLocaleString()} rows passed validation (with SSN format warnings noted above). You can proceed to the next step.`
                      : `All ${results.totalRows.toLocaleString()} rows passed validation. You can proceed to the next step.`}
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
