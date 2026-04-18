import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";

type MissingSiriusId = "freeman" | "2nd";

interface SecondShiftLink {
  workerId: string;
  displayName: string;
  value: string;
}

type SecondShiftResponse =
  | { configError: { missing: MissingSiriusId[] } }
  | { link: SecondShiftLink | null };

function isConfigError(
  r: SecondShiftResponse | undefined,
): r is { configError: { missing: MissingSiriusId[] } } {
  return !!r && "configError" in r;
}

function LinkSection({
  title,
  description,
  data,
  isLoading,
  testIdPrefix,
}: {
  title: string;
  description: string;
  data: SecondShiftResponse | undefined;
  isLoading: boolean;
  testIdPrefix: string;
}) {
  return (
    <Card data-testid={`card-${testIdPrefix}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-6 w-48" data-testid={`skeleton-${testIdPrefix}`} />
        ) : data && "link" in data && data.link ? (
          <div className="flex flex-col gap-1">
            <Link
              href={`/workers/${data.link.workerId}`}
              className="text-primary underline-offset-4 hover:underline"
              data-testid={`link-${testIdPrefix}`}
            >
              {data.link.displayName}
            </Link>
            <span
              className="text-sm text-muted-foreground"
              data-testid={`text-${testIdPrefix}-value`}
            >
              Matching ID value: {data.link.value}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid={`text-${testIdPrefix}-none`}>
            None.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigErrorCard({ missing }: { missing: MissingSiriusId[] }) {
  return (
    <Card data-testid="card-second-shift-config-error">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Configuration error
        </CardTitle>
        <CardDescription>
          Second shift links can't be resolved until the worker ID type configuration
          is complete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          The following Sirius ID
          {missing.length === 1 ? " is" : "s are"} missing on{" "}
          <span className="font-medium">Worker ID Types</span>:
        </p>
        <ul className="list-disc pl-6" data-testid="list-second-shift-missing">
          {missing.map((m) => (
            <li key={m} data-testid={`text-second-shift-missing-${m}`}>
              <code className="font-mono">{m}</code>
            </li>
          ))}
        </ul>
        <p>
          A staff member needs to set the Sirius ID on the appropriate Worker ID Type
          row.{" "}
          <Link
            href="/config/options/worker-id-type"
            className="text-primary underline-offset-4 hover:underline"
            data-testid="link-config-worker-id-type"
          >
            Open Worker ID Types configuration
          </Link>
          .
        </p>
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

  const configErrorMissing =
    (isConfigError(fromQuery.data) && fromQuery.data.configError.missing) ||
    (isConfigError(toQuery.data) && toQuery.data.configError.missing) ||
    null;

  if (configErrorMissing) {
    return <ConfigErrorCard missing={configErrorMissing} />;
  }

  return (
    <div className="space-y-4">
      <LinkSection
        title="This worker is a 2nd shift of"
        description="The primary worker that this record shadows on a second shift."
        data={fromQuery.data}
        isLoading={fromQuery.isLoading}
        testIdPrefix="second-shift-from"
      />
      <LinkSection
        title="2nd shift worker for this worker"
        description="The shadow record used to schedule this worker for a second shift on the same day."
        data={toQuery.data}
        isLoading={toQuery.isLoading}
        testIdPrefix="second-shift-to"
      />
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
