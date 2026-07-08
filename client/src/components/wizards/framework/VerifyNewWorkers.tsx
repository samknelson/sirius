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
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Play,
  Loader2,
  UserPlus,
  Users,
  Save,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface MatchCandidate {
  id: string;
  siriusId: number | null;
  displayName: string | null;
  given: string | null;
  family: string | null;
  birthDate: string | null;
  ssnLast4: string | null;
}

interface VerifyRow {
  rowIndex: number;
  ssnDigits: string;
  ssnMasked: string;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  candidates: MatchCandidate[];
}

interface VerifyData {
  verifyNewWorkers: { rows: VerifyRow[]; completedAt?: string } | null;
  newWorkerDecisions: Record<string, string>;
}

/**
 * `verify` step for the BAO monthly hours wizard. Scans the uploaded file
 * for rows whose SSN matches no existing worker (via the fixed dispatcher
 * run route), shows near-match candidates (same name/DOB, different SSN),
 * and lets the operator confirm or reject each new-worker creation before
 * processing. Decisions are saved through the generic submit route.
 */
export function VerifyNewWorkers({ wizardId, step }: WizardStepComponentProps) {
  const { data: stepData, isLoading } = useQuery<VerifyData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!stepData || hydrated) return;
    setDecisions(stepData.newWorkerDecisions ?? {});
    setHydrated(true);
  }, [stepData, hydrated]);

  const verify = stepData?.verifyNewWorkers ?? null;
  const rows = verify?.rows ?? [];

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
        setIsScanning(false);
        setHydrated(false);
        queryClient.invalidateQueries({
          queryKey: [`/api/wizards/${wizardId}`],
        });
        queryClient.invalidateQueries({
          queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
        });
        if (progress === "failed") {
          setError(wizard?.data?.progress?.[step.id]?.error || "Scan failed");
        }
        return;
      }
    }
    setError(
      "The scan is taking longer than expected. Please refresh the page to check the results.",
    );
    setIsScanning(false);
  };

  const startScan = async () => {
    setIsScanning(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/run`,
        {},
      );
      await pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setIsScanning(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { decisions } },
      );
      setSaveSuccess(true);
      queryClient.invalidateQueries({
        queryKey: [`/api/wizards/${wizardId}`],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save decisions",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const decidedCount = rows.filter(
    (r) => decisions[r.ssnDigits] === "confirm" || decisions[r.ssnDigits] === "reject",
  ).length;
  const allDecided = rows.length > 0 && decidedCount === rows.length;

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
          <CardTitle>Verify New Workers</CardTitle>
          <CardDescription>
            Scan the file for workers whose SSN is not in the system, review
            possible matches, and confirm or reject each new-worker creation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive" data-testid="alert-verify-error">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isScanning && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">
                Scanning for new workers…
              </p>
            </div>
          )}

          {!isScanning && !verify && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <UserPlus className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground text-center">
                Ready to scan the uploaded file for workers not yet in the
                system.
              </p>
              <Button
                onClick={startScan}
                size="lg"
                data-testid="button-start-scan"
              >
                <Play className="mr-2 h-4 w-4" />
                Scan for New Workers
              </Button>
            </div>
          )}

          {!isScanning && verify && rows.length === 0 && (
            <Alert data-testid="alert-no-new-workers">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>No new workers</AlertTitle>
              <AlertDescription>
                Every SSN in the file matches an existing worker. You can
                continue to the next step.
              </AlertDescription>
            </Alert>
          )}

          {!isScanning && verify && rows.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" data-testid="badge-new-worker-count">
                    {rows.length} new worker{rows.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge
                    variant={allDecided ? "default" : "outline"}
                    data-testid="badge-decided-count"
                  >
                    {decidedCount}/{rows.length} decided
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startScan}
                  data-testid="button-rescan"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Re-scan
                </Button>
              </div>

              <Separator />

              <div className="space-y-4">
                {rows.map((row) => {
                  const decision = decisions[row.ssnDigits];
                  return (
                    <Card
                      key={row.ssnDigits}
                      className={
                        decision === "confirm"
                          ? "border-green-500/50"
                          : decision === "reject"
                            ? "border-destructive/50"
                            : ""
                      }
                      data-testid={`card-verify-row-${row.rowIndex}`}
                    >
                      <CardContent className="pt-6 space-y-3">
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div>
                            <p
                              className="font-medium"
                              data-testid={`text-verify-name-${row.rowIndex}`}
                            >
                              {[row.firstName, row.lastName]
                                .filter(Boolean)
                                .join(" ") || "(no name)"}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              SSN {row.ssnMasked}
                              {row.dateOfBirth
                                ? ` · DOB ${row.dateOfBirth}`
                                : ""}
                              {" · row "}
                              {row.rowIndex + 1}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant={
                                decision === "confirm" ? "default" : "outline"
                              }
                              onClick={() => {
                                setSaveSuccess(false);
                                setDecisions((d) => ({
                                  ...d,
                                  [row.ssnDigits]: "confirm",
                                }));
                              }}
                              data-testid={`button-confirm-${row.rowIndex}`}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Create worker
                            </Button>
                            <Button
                              size="sm"
                              variant={
                                decision === "reject"
                                  ? "destructive"
                                  : "outline"
                              }
                              onClick={() => {
                                setSaveSuccess(false);
                                setDecisions((d) => ({
                                  ...d,
                                  [row.ssnDigits]: "reject",
                                }));
                              }}
                              data-testid={`button-reject-${row.rowIndex}`}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                        </div>

                        {row.candidates.length > 0 && (
                          <Alert data-testid={`alert-candidates-${row.rowIndex}`}>
                            <Users className="h-4 w-4" />
                            <AlertTitle>
                              Possible existing match
                              {row.candidates.length === 1 ? "" : "es"} — a
                              worker with a similar name or birth date already
                              exists with a DIFFERENT SSN
                            </AlertTitle>
                            <AlertDescription>
                              <ul className="mt-2 space-y-1">
                                {row.candidates.map((c) => (
                                  <li
                                    key={c.id}
                                    className="text-sm"
                                    data-testid={`text-candidate-${row.rowIndex}-${c.id}`}
                                  >
                                    <span className="font-medium">
                                      {c.displayName ||
                                        [c.given, c.family]
                                          .filter(Boolean)
                                          .join(" ")}
                                    </span>
                                    {c.siriusId != null && ` (#${c.siriusId})`}
                                    {c.birthDate && ` · DOB ${c.birthDate}`}
                                    {c.ssnLast4 &&
                                      ` · SSN ***-**-${c.ssnLast4}`}
                                  </li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSave}
                  disabled={isSaving}
                  data-testid="button-save-decisions"
                >
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save Decisions
                </Button>
                {saveSuccess && (
                  <span
                    className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1"
                    data-testid="text-save-success"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Decisions saved
                  </span>
                )}
                {!allDecided && (
                  <span className="text-sm text-muted-foreground">
                    Decide every row to continue. Rejected rows will fail
                    during processing instead of creating a worker.
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
