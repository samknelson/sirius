import { useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";

interface EligibilityResult {
  eligible: boolean;
  code: string;
  message: string;
  asOf: { year: number; month: number; day: number };
  asOfApplied: boolean;
}

function WorkerEchpContent() {
  const { id: workerId } = useParams<{ id: string }>();
  const { hasComponent, hasPermission } = useAuth();
  const showAsOf = hasComponent("debug") && hasPermission("admin");
  const [asOf, setAsOf] = useState("");

  const { data, isLoading, isError } = useQuery<EligibilityResult>({
    queryKey: ["/api/sitespecific/bao/echp/worker", workerId, "eligibility", showAsOf ? asOf : ""],
    queryFn: async () => {
      const qs = showAsOf && asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
      return await apiRequest(
        "GET",
        `/api/sitespecific/bao/echp/worker/${workerId}/eligibility${qs}`,
      );
    },
    enabled: !!workerId,
  });

  return (
    <Card data-testid="card-echp-eligibility">
      <CardHeader>
        <CardTitle>Event Center Hours Purchase</CardTitle>
        <CardDescription>
          Check whether this worker is permitted to purchase Event Center hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showAsOf && (
          <div className="space-y-2 max-w-xs" data-testid="section-asof-override">
            <Label htmlFor="asof-date">Evaluate as of date</Label>
            <Input
              id="asof-date"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              data-testid="input-asof-date"
            />
            <p className="text-xs text-muted-foreground">
              Debug override (admin only). Leave blank to use today.
            </p>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" data-testid="skeleton-eligibility" />
        ) : isError || !data ? (
          <Alert variant="destructive" data-testid="alert-eligibility-error">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Unable to evaluate</AlertTitle>
            <AlertDescription>
              There was a problem checking eligibility. Please try again.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert
            variant={data.eligible ? "default" : "destructive"}
            className={
              data.eligible
                ? "border-green-500/50 text-green-700 dark:text-green-400 [&>svg]:text-green-600"
                : undefined
            }
            data-testid="alert-eligibility-result"
          >
            {data.eligible ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <AlertTitle data-testid="text-eligibility-status">
              {data.eligible ? "Eligible" : "Not eligible"}
            </AlertTitle>
            <AlertDescription data-testid="text-eligibility-message">
              {data.message}
            </AlertDescription>
          </Alert>
        )}

        {data && (
          <p className="text-xs text-muted-foreground" data-testid="text-asof">
            Evaluated as of {String(data.asOf.month).padStart(2, "0")}/
            {String(data.asOf.day).padStart(2, "0")}/{data.asOf.year}
            {data.asOfApplied ? " (override applied)" : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerSitespecificBaoEchpPage() {
  return (
    <WorkerLayout activeTab="sitespecific-bao-echp">
      <WorkerEchpContent />
    </WorkerLayout>
  );
}
