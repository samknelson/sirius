import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Info,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ChargeGroup {
  accountId: string | number;
  year: number;
  month: number;
  amount: number;
}

interface Forecast {
  fingerprint: string;
  workersWithNewGrants: number;
  newWorkers: number;
  newGrants: number;
  existingGrantSkips: number;
  knownChargeTotal: string;
  unpriceableGrants: number;
  chargeGroups: ChargeGroup[];
  excludedRows: unknown[] | number;
}

interface PreviewResponse {
  forecast?: Forecast;
  historical?: boolean;
}

const currency = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

function formatCurrency(value: number | string) {
  return currency.format(Number(value));
}

function excludedRowLabel(row: unknown): string {
  if (typeof row === "string" || typeof row === "number") return String(row);
  if (!row || typeof row !== "object") return "Excluded row";

  const details = row as Record<string, unknown>;
  const line = details.rowNumber ?? details.row ?? details.line;
  const reason = details.reason ?? details.message ?? details.error;
  if (line !== undefined && reason !== undefined) {
    return `Row ${String(line)} — ${String(reason)}`;
  }
  if (reason !== undefined) return String(reason);
  try {
    return JSON.stringify(row) ?? "Excluded row";
  } catch {
    return "Excluded row";
  }
}

export function LegalPreview({ wizardId, step }: WizardStepComponentProps) {
  const { toast } = useToast();
  const dataUrl = `/api/wizards/${wizardId}/dispatch/preview/data`;
  const wizardUrl = `/api/wizards/${wizardId}`;
  const {
    data,
    error,
    isError,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<PreviewResponse>({
    queryKey: [dataUrl],
    staleTime: 0,
  });
  const forecast = data?.forecast;
  const excludedRows = Array.isArray(forecast?.excludedRows)
    ? forecast.excludedRows
    : [];
  const excludedCount =
    typeof forecast?.excludedRows === "number"
      ? forecast.excludedRows
      : excludedRows.length;
  const historical = data?.historical === true;

  const approvalMutation = useMutation({
    mutationFn: () => {
      if (!forecast) throw new Error("The preview is no longer available.");
      return apiRequest("POST", `/api/wizards/${wizardId}/dispatch/preview/submit`, {
        input: { fingerprint: forecast.fingerprint },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [wizardUrl] });
      queryClient.invalidateQueries({ queryKey: [dataUrl] });
      toast({
        title: "Preview approved",
        description: "The legal upload is ready to continue.",
      });
    },
    onError: (submitError: Error) => {
      toast({
        title: "Approval failed",
        description: getApiErrorMessage(submitError, "Could not approve this preview."),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Legal upload preview</CardTitle>
          <CardDescription>We could not load the current estimate.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Preview unavailable</AlertTitle>
            <AlertDescription>
              {getApiErrorMessage(error, "Please try again.")}
            </AlertDescription>
          </Alert>
          <Button className="mt-4" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!forecast) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Legal upload preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {historical ? "This completed historical upload has no saved estimate. No preview approval is required; its results remain available." : "No forecast is available yet. Refresh to check this upload again."}
          </p>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh preview
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div>
          <CardTitle>Legal upload estimate</CardTitle>
          <CardDescription className="mt-1">
            Review the grants and known charges before approving this upload.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching || approvalMutation.isPending}
          data-testid="button-refresh-legal-preview"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh estimate
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {historical && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Historical upload</AlertTitle>
            <AlertDescription>
              This upload has already been completed. This is a historical preview; no approval is needed.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="bg-muted/35 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <Users className="mt-1 h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {forecast.workersWithNewGrants.toLocaleString()}
                </p>
                <p className="text-sm font-medium">Workers with new grants</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Distinct workers; one worker can receive multiple grants.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/35 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <CircleDollarSign className="mt-1 h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(forecast.knownChargeTotal)}
                </p>
                <p className="text-sm font-medium">Known charge estimate</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {forecast.unpriceableGrants > 0
                    ? `${forecast.unpriceableGrants.toLocaleString()} grants have no available price; they are not included.`
                    : "Based on grants with available pricing."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/35 shadow-none">
            <CardContent className="flex items-start gap-3 p-4">
              <CheckCircle2 className="mt-1 h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {forecast.newWorkers.toLocaleString()}
                </p>
                <p className="text-sm font-medium">New workers</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Distinct workers being added by this upload.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {forecast.newGrants.toLocaleString()} new grants
          </Badge>
          <Badge variant="outline">
            {forecast.existingGrantSkips.toLocaleString()} existing grants skipped
          </Badge>
        </div>
        {forecast.existingGrantSkips > 0 && (
          <p className="-mt-3 text-sm text-muted-foreground">
            Existing grants are skipped rather than created again.
          </p>
        )}

        {forecast.unpriceableGrants > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some grant pricing is unavailable</AlertTitle>
            <AlertDescription>
              The estimate includes only priced grants. The total may increase once pricing is available for{" "}
              {forecast.unpriceableGrants.toLocaleString()} grant{forecast.unpriceableGrants === 1 ? "" : "s"}.
            </AlertDescription>
          </Alert>
        )}

        {forecast.chargeGroups.length > 0 && (
          <section className="space-y-2" aria-labelledby="charge-breakdown-title">
            <h3 id="charge-breakdown-title" className="text-sm font-semibold">
              Known charges by account and month
            </h3>
            <div className="divide-y rounded-md border">
              {forecast.chargeGroups.map((group, index) => (
                <div
                  key={`${group.accountId}-${group.year}-${group.month}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground">
                    Account {group.accountId} · {group.year}-{String(group.month).padStart(2, "0")}
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCurrency(group.amount)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {excludedCount > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {excludedCount.toLocaleString()} excluded row{excludedCount === 1 ? "" : "s"}
            </AlertTitle>
            <AlertDescription>
               These rows cannot create workers or grants and are excluded from the estimate. Processing reports them as row failures.
              {excludedRows.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-1">
                  {excludedRows.slice(0, 8).map((row, index) => (
                    <li key={index} className="break-words">{excludedRowLabel(row)}</li>
                  ))}
                  {excludedRows.length > 8 && (
                    <li>{(excludedRows.length - 8).toLocaleString()} more excluded rows</li>
                  )}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">No rows are excluded.</p>
        )}

        {!historical && (
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-sm text-muted-foreground">
              Approval confirms this forecast. Refresh first if the source file or grant data has changed.
            </p>
            <Button
              onClick={() => approvalMutation.mutate()}
              disabled={approvalMutation.isPending || isFetching}
              data-testid="button-approve-legal-preview"
            >
              {approvalMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Approving…
                </>
              ) : (
                "Approve and continue"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
