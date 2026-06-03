import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, ShoppingCart } from "lucide-react";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface EligibilityResult {
  eligible: boolean;
  code: string;
  message: string;
  asOf: { year: number; month: number; day: number };
  asOfApplied: boolean;
  target?: { year: number; month: number };
  hoursWorked?: number;
  hoursToPurchase?: number;
  threshold?: number;
  price?: number;
}

function formatPrice(price: number): string {
  return `$${price.toLocaleString("en-US")}`;
}

function WorkerEchpContent() {
  const { id: workerId } = useParams<{ id: string }>();
  const { hasComponent, hasPermission } = useAuth();
  const { toast } = useToast();
  const showAsOf = hasComponent("debug") && hasPermission("admin");
  const [asOf, setAsOf] = useState("");

  const eligibilityKey = [
    "/api/sitespecific/bao/echp/worker",
    workerId,
    "eligibility",
    showAsOf ? asOf : "",
  ];

  const { data, isLoading, isError } = useQuery<EligibilityResult>({
    queryKey: eligibilityKey,
    queryFn: async () => {
      const qs = showAsOf && asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
      return await apiRequest(
        "GET",
        `/api/sitespecific/bao/echp/worker/${workerId}/eligibility${qs}`,
      );
    },
    enabled: !!workerId,
  });

  const purchase = useMutation({
    mutationFn: async () => {
      const qs = showAsOf && asOf ? `?asOf=${encodeURIComponent(asOf)}` : "";
      return await apiRequest(
        "POST",
        `/api/sitespecific/bao/echp/worker/${workerId}/purchase${qs}`,
      );
    },
    onSuccess: (result: { message?: string }) => {
      toast({
        title: "Purchase complete",
        description:
          result?.message ?? "Your hours have been purchased.",
      });
      queryClient.invalidateQueries({ queryKey: eligibilityKey });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError
          ? error.data?.message ?? error.message
          : "Something went wrong. Please try again.";
      toast({
        variant: "destructive",
        title: "Unable to purchase",
        description: message,
      });
      // Eligibility may have changed (e.g. window closed); refresh it.
      queryClient.invalidateQueries({ queryKey: eligibilityKey });
    },
  });

  const canPurchase =
    !!data &&
    data.eligible &&
    data.code === "permitted" &&
    typeof data.hoursToPurchase === "number" &&
    data.hoursToPurchase > 0 &&
    !!data.target;

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

        {canPurchase && data.target && (
          <div
            className="space-y-4 rounded-lg border p-4"
            data-testid="section-purchase"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">For month</p>
                <p className="text-lg font-semibold" data-testid="text-purchase-month">
                  {String(data.target.month).padStart(2, "0")}/{data.target.year}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hours worked</p>
                <p className="text-lg font-semibold" data-testid="text-purchase-hours-worked">
                  {data.hoursWorked}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hours to purchase</p>
                <p className="text-lg font-semibold" data-testid="text-purchase-hours">
                  {data.hoursToPurchase}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Required hours</p>
                <p className="text-lg font-semibold" data-testid="text-purchase-threshold">
                  {data.threshold}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Price</p>
                <p className="text-lg font-semibold" data-testid="text-purchase-price">
                  {formatPrice(data.price ?? 0)}
                </p>
              </div>
            </div>

            <p
              className="text-sm text-muted-foreground"
              data-testid="text-purchase-disclaimer"
            >
              No payment is taken now. Confirming records your hours for the month
              above; the corresponding charge follows later.
            </p>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={purchase.isPending}
                  data-testid="button-purchase"
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  {purchase.isPending
                    ? "Purchasing…"
                    : `Purchase ${data.hoursToPurchase} hours`}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent data-testid="dialog-purchase-confirm">
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm purchase</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will record {data.hoursToPurchase} Event Center hours for{" "}
                    {String(data.target.month).padStart(2, "0")}/{data.target.year}{" "}
                    at a price of {formatPrice(data.price ?? 0)}. No payment is
                    taken now — the charge follows later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-purchase-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => purchase.mutate()}
                    data-testid="button-purchase-confirm"
                  >
                    Confirm purchase
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
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
