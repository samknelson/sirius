import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { useAccessCheck } from "@/hooks/use-access-check";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type MissingWorkerIdSiriusId = "freeman" | "2nd";
type MissingMemberStatusSiriusId = "2nd";

interface ConfigErrorDetail {
  missingTypes: MissingWorkerIdSiriusId[];
  missingMemberStatuses: MissingMemberStatusSiriusId[];
}

interface SecondShiftLink {
  workerId: string;
  displayName: string;
  value: string;
}

interface SourceEligibility {
  hasFreemanId: boolean;
  has2ndId: boolean;
}

type SecondShiftResponse =
  | { configError: ConfigErrorDetail }
  | { link: SecondShiftLink | null; source: SourceEligibility };

function isConfigError(
  r: SecondShiftResponse | undefined,
): r is { configError: ConfigErrorDetail } {
  return !!r && "configError" in r;
}

function ConfigErrorCard({ detail }: { detail: ConfigErrorDetail }) {
  const hasMissingTypes = detail.missingTypes.length > 0;
  const hasMissingMs = detail.missingMemberStatuses.length > 0;
  return (
    <Card data-testid="card-second-shift-config-error">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Configuration error
        </CardTitle>
        <CardDescription>
          Second shift links can't be resolved until the configuration below is complete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {hasMissingTypes && (
          <div className="space-y-2">
            <p>
              The following Sirius ID
              {detail.missingTypes.length === 1 ? " is" : "s are"} missing on{" "}
              <span className="font-medium">Worker ID Types</span>:
            </p>
            <ul className="list-disc pl-6" data-testid="list-second-shift-missing-types">
              {detail.missingTypes.map((m) => (
                <li key={m} data-testid={`text-second-shift-missing-type-${m}`}>
                  <code className="font-mono">{m}</code>
                </li>
              ))}
            </ul>
            <p>
              <Link
                href="/config/options/worker-id-type"
                className="text-primary underline-offset-4 hover:underline"
                data-testid="link-config-worker-id-type"
              >
                Open Worker ID Types configuration
              </Link>
            </p>
          </div>
        )}
        {hasMissingMs && (
          <div className="space-y-2">
            <p>
              The following Sirius ID
              {detail.missingMemberStatuses.length === 1 ? " is" : "s are"} missing on{" "}
              <span className="font-medium">Member Statuses</span>:
            </p>
            <ul className="list-disc pl-6" data-testid="list-second-shift-missing-ms">
              {detail.missingMemberStatuses.map((m) => (
                <li key={m} data-testid={`text-second-shift-missing-ms-${m}`}>
                  <code className="font-mono">{m}</code>
                </li>
              ))}
            </ul>
            <p>
              <Link
                href="/config/options/worker-ms"
                className="text-primary underline-offset-4 hover:underline"
                data-testid="link-config-worker-ms"
              >
                Open Member Statuses configuration
              </Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FromSection({
  data,
  isLoading,
}: {
  data: SecondShiftResponse | undefined;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="card-second-shift-from">
      <CardHeader>
        <CardTitle>This worker is a 2nd shift of</CardTitle>
        <CardDescription>
          The primary worker that this record shadows on a second shift.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-6 w-48" data-testid="skeleton-second-shift-from" />
        ) : data && "link" in data && data.link ? (
          <div className="flex flex-col gap-1">
            <Link
              href={`/workers/${data.link.workerId}`}
              className="text-primary underline-offset-4 hover:underline"
              data-testid="link-second-shift-from"
            >
              {data.link.displayName}
            </Link>
            <span
              className="text-sm text-muted-foreground"
              data-testid="text-second-shift-from-value"
            >
              Matching ID value: {data.link.value}
            </span>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-second-shift-from-none"
          >
            None.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ToSection({
  data,
  isLoading,
  workerId,
}: {
  data: SecondShiftResponse | undefined;
  isLoading: boolean;
  workerId: string;
}) {
  const { canAccess: isCoordinator } = useAccessCheck("edls.coordinator", workerId);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () =>
      apiRequest("PUT", `/api/workers/${workerId}/sitespecific/freeman/2nd-to`),
    onSuccess: (result: SecondShiftResponse) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/workers", workerId, "sitespecific/freeman/2nd-to"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/workers", workerId, "sitespecific/freeman/2nd-from"],
      });
      const name = "link" in result && result.link ? result.link.displayName : "the shadow worker";
      toast({ title: "2nd shift worker synced", description: `Updated ${name}.` });
    },
    onError: (err: unknown) => {
      const description =
        err instanceof Error ? err.message : "Could not sync the 2nd shift worker.";
      toast({ title: "Sync failed", description, variant: "destructive" });
    },
  });

  const link = data && "link" in data ? data.link : null;
  const source = data && "source" in data ? data.source : undefined;

  let disabledReason: string | null = null;
  if (source) {
    if (source.has2ndId) {
      disabledReason = "This worker has a 2nd ID — cannot create a shadow of a shadow.";
    } else if (!source.hasFreemanId) {
      disabledReason = "This worker is missing a Freeman ID — add one before syncing.";
    }
  }

  const buttonLabel = link ? "Re-sync 2nd shift worker" : "Create 2nd shift worker";
  const buttonDisabled = !!disabledReason || mutation.isPending || isLoading;

  const button = (
    <Button
      onClick={() => mutation.mutate()}
      disabled={buttonDisabled}
      size="sm"
      data-testid="button-sync-second-shift"
    >
      <RefreshCw className="mr-2 h-4 w-4" />
      {mutation.isPending ? "Syncing..." : buttonLabel}
    </Button>
  );

  return (
    <Card data-testid="card-second-shift-to">
      <CardHeader>
        <CardTitle>2nd shift worker for this worker</CardTitle>
        <CardDescription>
          The shadow record used to schedule this worker for a second shift on the same day.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-6 w-48" data-testid="skeleton-second-shift-to" />
        ) : link ? (
          <div className="flex flex-col gap-1">
            <Link
              href={`/workers/${link.workerId}`}
              className="text-primary underline-offset-4 hover:underline"
              data-testid="link-second-shift-to"
            >
              {link.displayName}
            </Link>
            <span
              className="text-sm text-muted-foreground"
              data-testid="text-second-shift-to-value"
            >
              Matching ID value: {link.value}
            </span>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="text-second-shift-to-none"
          >
            None.
          </p>
        )}
        {isCoordinator && (
          <div data-testid="container-sync-second-shift">
            {disabledReason ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* span wrapper so tooltip works on disabled button */}
                    <span tabIndex={0}>{button}</span>
                  </TooltipTrigger>
                  <TooltipContent data-testid="tooltip-sync-second-shift-disabled">
                    {disabledReason}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              button
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkerSecondShiftContent() {
  const { worker } = useWorkerLayout();

  const fromQuery = useQuery<SecondShiftResponse>({
    queryKey: ["/api/workers", worker.id, "sitespecific/freeman/2nd-from"],
  });
  const toQuery = useQuery<SecondShiftResponse>({
    queryKey: ["/api/workers", worker.id, "sitespecific/freeman/2nd-to"],
  });

  const configErrorDetail =
    (isConfigError(fromQuery.data) && fromQuery.data.configError) ||
    (isConfigError(toQuery.data) && toQuery.data.configError) ||
    null;

  if (configErrorDetail) {
    return <ConfigErrorCard detail={configErrorDetail} />;
  }

  return (
    <div className="space-y-4">
      <FromSection data={fromQuery.data} isLoading={fromQuery.isLoading} />
      <ToSection data={toQuery.data} isLoading={toQuery.isLoading} workerId={worker.id} />
    </div>
  );
}

export default function WorkerSecondShift() {
  return (
    <WorkerLayout activeTab="sitespecific-freeman-2shift">
      <WorkerSecondShiftContent />
    </WorkerLayout>
  );
}
