import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/queryClient";

const RESET_KEY = "/api/sitespecific/freeman/edls-migrate/full-reset";
const STATUS_KEY = "/api/sitespecific/freeman/edls-migrate/import/status";

type ResetCounts = {
  workers: number;
  sheets: number;
  crews: number;
  assignments: number;
};

type ResetPreflight = {
  counts: ResetCounts;
  snapshot: string;
  confirmation: string;
  blockers: ResetRelation[];
  preservations: ResetRelation[];
  diagnosticsVersion: string;
};

type ResetRelation = {
  entity: "worker" | "contact";
  workerId?: string;
  contactId?: string;
  relationshipType: string;
  referencingSchema: string;
  referencingTable: string;
  referencingColumn: string;
  recordId: string;
  label: string | null;
  constraint: string;
  workerName: string | null;
  contactName: string | null;
  disposition: "intact" | "anonymized" | "blocker";
};

type ResetResult = {
  deleted: ResetCounts & {
    workerEdls: number;
    grievanceAssociations: number;
    contactsDeleted: number;
    contactsPreserved: number;
    contactsAnonymized: number;
  };
  diagnosticsVersion: string;
};

type ResetFailedRecord = {
  stage: string;
  table: string;
  id: string;
  snapshot: Record<string, unknown>;
  worker?: {
    id: string;
    name: string | null;
    contactId: string;
    contactName: string | null;
    relationships: ResetRelation[];
  };
};

type ResetFailure = {
  message: string;
  action?: string;
  stage?: string;
  logId?: number;
  diagnostics?: Record<string, unknown>;
  failedRecord?: ResetFailedRecord;
  blocker?: unknown;
  logPersistenceError?: Record<string, unknown>;
  diagnosticsVersion?: string;
};

class ResetApiError extends Error {
  constructor(public readonly failure: ResetFailure, public readonly status: number) {
    super(failure.message);
    this.name = "ResetApiError";
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  const body = await response.json().catch(() => ({ message: "Request failed" })) as ResetFailure;
  if (!response.ok) {
    throw new ResetApiError({
      ...body,
      message: body.message || `HTTP ${response.status}`,
    }, response.status);
  }
  return body as T;
}

function displayDiagnostic(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export default function FullResetCard() {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<ResetResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const preflight = useQuery<ResetPreflight>({ queryKey: [RESET_KEY] });
  const reset = useMutation({
    mutationFn: () => requestJson<ResetResult>(RESET_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirmation,
        snapshot: preflight.data?.snapshot,
      }),
    }),
    onSuccess: (nextResult) => {
      setResult(nextResult);
      setConfirmation("");
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: [RESET_KEY] });
      queryClient.invalidateQueries({ queryKey: [STATUS_KEY] });
    },
  });

  const exactConfirmation = confirmation === preflight.data?.confirmation;
  const blocked = preflight.isLoading || preflight.isError || reset.isPending
    || !exactConfirmation || Boolean(preflight.data?.blockers.length);

  return (
    <Card className="border-destructive bg-destructive/5" data-testid="card-freeman-full-reset">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive">DANGER</Badge>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            Full EDLS and worker reset
          </CardTitle>
        </div>
        <CardDescription className="text-foreground">
          Irreversibly deletes the system-wide worker registry—not only workers created by
          Freeman—and clears every EDLS sheet, crew, assignment, and worker EDLS row.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>This cannot be undone</AlertTitle>
          <AlertDescription>
            Worker-linked records in other components may be deleted or unlinked by database
            relationships. Grievances remain, but their worker associations are removed.
            Employers, departments, facilities, EDLS options, communication logs, staged
            Freeman source data, and migration progress are retained. Worker contacts tied to
            communication history are anonymized so those logs remain; other worker-owned
            contacts are deleted.
          </AlertDescription>
        </Alert>

        {preflight.isLoading && (
          <div className="h-20 animate-pulse rounded-md bg-muted" data-testid="full-reset-loading" />
        )}
        {preflight.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {getApiErrorMessage(preflight.error, "Reset counts could not be loaded. A Freeman import may be active.")}
            </AlertDescription>
          </Alert>
        )}
        {preflight.data && (
          <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="full-reset-counts">
            {Object.entries(preflight.data.counts).map(([label, value]) => (
              <div key={label} className="rounded-md border bg-background p-3">
                <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
                <div className="text-xs capitalize text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
           <p className="text-xs text-muted-foreground" data-testid="full-reset-diagnostics-version">
             Reset diagnostics build: <span className="font-mono">{preflight.data.diagnosticsVersion}</span>
           </p>
          {preflight.data.blockers.length > 0 && (
            <Alert variant="destructive" data-testid="full-reset-blockers">
              <AlertTitle>Reset blocked by existing relationships</AlertTitle>
              <AlertDescription>
                Remove these relationships, then refresh the plan:
                <ul className="mt-2 list-disc pl-5">
                  {preflight.data.blockers.map((relation) => (
                    <li key={`${relation.constraint}-${relation.recordId}`}>
                      Worker {relation.workerName ?? "Unknown"} ({relation.workerId ?? "unknown"}) /
                      contact {relation.contactName ?? "Unknown"} ({relation.contactId ?? "unknown"}):
                      {` ${relation.referencingSchema}.${relation.referencingTable} record ${relation.recordId}`}
                      {relation.label ? ` (${relation.label})` : ""}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {preflight.data.preservations.length > 0 && (
            <Alert data-testid="full-reset-preservations">
              <AlertTitle>Contacts retained and anonymized</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {preflight.data.preservations.map((relation) => (
                    <li key={`${relation.constraint}-${relation.recordId}`}>
                      Worker {relation.workerName ?? "Unknown"} ({relation.workerId ?? "unknown"}) /
                      contact {relation.contactName ?? "Unknown"} ({relation.contactId ?? "unknown"}):
                      {` ${relation.referencingSchema}.${relation.referencingTable} record ${relation.recordId}`}
                      {relation.label ? ` (${relation.label})` : ""} — {relation.disposition}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setResult(null);
              setConfirmation("");
              preflight.refetch();
            }}
            disabled={preflight.isFetching || reset.isPending}
            data-testid="button-full-reset-refresh"
          >
            {preflight.isFetching
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh counts
          </Button>

          <AlertDialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open && !reset.isPending) setConfirmation("");
          }}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={!preflight.data || preflight.isFetching || reset.isPending}
                data-testid="button-full-reset-open"
              >
                Delete all workers and EDLS data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Final destructive confirmation</AlertDialogTitle>
                <AlertDialogDescription>
                  The counts are rechecked before deletion. If any count changed or a Freeman
                  import started, the reset will be refused and nothing will be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="full-reset-confirmation">
                  Type <span className="font-mono font-semibold">{preflight.data?.confirmation}</span>
                </Label>
                <Input
                  id="full-reset-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  data-testid="input-full-reset-confirmation"
                />
              </div>
              {reset.isError && (
                <Alert variant="destructive">
                  <AlertDescription className="space-y-2">
                    <p>{getApiErrorMessage(reset.error, "The reset failed. Existing data was left unchanged.")}</p>
                    {reset.error instanceof ResetApiError && (
                      <div className="space-y-3" data-testid="full-reset-exact-failure">
                        {reset.error.failure.stage && (
                          <p><strong>Failed stage:</strong> <span className="font-mono">{reset.error.failure.stage}</span></p>
                        )}
                        {reset.error.failure.logId !== undefined && (
                          <p><strong>Administrator log record:</strong> #{reset.error.failure.logId}</p>
                        )}
                        {reset.error.failure.failedRecord && (
                          <div>
                            <p>
                              <strong>Failed record:</strong>{" "}
                              <span className="font-mono">
                                {reset.error.failure.failedRecord.table} / {reset.error.failure.failedRecord.id}
                              </span>
                            </p>
                            {reset.error.failure.failedRecord.worker && (
                              <p>
                                <strong>Worker:</strong>{" "}
                                {reset.error.failure.failedRecord.worker.name ?? "Unknown"}{" "}
                                ({reset.error.failure.failedRecord.worker.id}); contact{" "}
                                {reset.error.failure.failedRecord.worker.contactName ?? "Unknown"}{" "}
                                ({reset.error.failure.failedRecord.worker.contactId})
                              </p>
                            )}
                            <p className="mt-1 font-semibold">Complete record snapshot</p>
                            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">
                              {JSON.stringify(reset.error.failure.failedRecord.snapshot, null, 2)}
                            </pre>
                          </div>
                        )}
                        {reset.error.failure.diagnostics
                          && Object.keys(reset.error.failure.diagnostics).length > 0 && (
                          <div>
                            <p className="font-semibold">Database error</p>
                            <dl className="max-h-64 overflow-auto rounded border bg-background p-2 text-xs">
                              {Object.entries(reset.error.failure.diagnostics).map(([key, value]) => (
                                <div key={key} className="grid grid-cols-[9rem_1fr] gap-2 border-b py-1 last:border-0">
                                  <dt className="font-mono font-semibold">{key}</dt>
                                  <dd className="whitespace-pre-wrap break-all">{displayDiagnostic(value)}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        )}
                        {reset.error.failure.blocker !== undefined && (
                          <div>
                            <p className="font-semibold">Blocking relationship</p>
                            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">
                              {JSON.stringify(reset.error.failure.blocker, null, 2)}
                            </pre>
                          </div>
                        )}
                        {reset.error.failure.logPersistenceError && (
                          <div>
                            <p className="font-semibold">Administrator log write also failed</p>
                            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-xs">
                              {JSON.stringify(reset.error.failure.logPersistenceError, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                    <p>No reset deletion was committed. The complete failure above can be used directly; no separate support-reference lookup is required.</p>
                  </AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={reset.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    reset.mutate();
                  }}
                  disabled={blocked}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  data-testid="button-full-reset-confirm"
                >
                  {reset.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Permanently delete everything listed
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {result && (
          <Alert>
            <AlertTitle>Full reset completed</AlertTitle>
            <AlertDescription>
              Deleted {result.deleted.workers} workers, {result.deleted.sheets} sheets,{" "}
              {result.deleted.crews} crews, {result.deleted.assignments} assignments,{" "}
              {result.deleted.workerEdls} worker EDLS rows, {result.deleted.grievanceAssociations}{" "}
              grievance associations, and {result.deleted.contactsDeleted} worker-owned contacts.
              Preserved {result.deleted.contactsPreserved} contacts and anonymized
              {` ${result.deleted.contactsAnonymized}`} contacts.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}