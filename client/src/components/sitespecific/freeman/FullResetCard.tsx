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
};

type ResetResult = {
  deleted: ResetCounts & {
    workerEdls: number;
    grievanceAssociations: number;
    contactsDeleted: number;
    contactsAnonymized: number;
  };
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  const body = await response.json().catch(() => ({ message: "Request failed" }));
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
  return body as T;
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
  const blocked = preflight.isLoading || preflight.isError || reset.isPending || !exactConfirmation;

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="full-reset-counts">
            {Object.entries(preflight.data.counts).map(([label, value]) => (
              <div key={label} className="rounded-md border bg-background p-3">
                <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
                <div className="text-xs capitalize text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
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
                  <AlertDescription>
                    {getApiErrorMessage(reset.error, "The reset failed. Existing data was left unchanged.")}
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
              Anonymized {result.deleted.contactsAnonymized} contacts were retained only for
              communication history.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}