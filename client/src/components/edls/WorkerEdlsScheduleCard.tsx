import { useMutation } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useWorkerTabAccess } from "@/hooks/useTabAccess";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";

interface EnsuredAccessUuid {
  accessUuid: string;
}

export function WorkerEdlsScheduleCard() {
  const { worker } = useWorkerLayout();
  const { hasComponent } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const componentsEnabled =
    hasComponent("edls") && hasComponent("worker.aat");
  const tabAccess = useWorkerTabAccess(worker.id, componentsEnabled);

  const viewSchedule = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        `/api/workers/${worker.id}/aat/ensure-uuid`,
      ) as Promise<EnsuredAccessUuid>,
    onSuccess: ({ accessUuid: rawAccessUuid }) => {
      const accessUuid = rawAccessUuid?.trim();
      if (!accessUuid) {
        toast({
          title: "Could not open schedule",
          description: "The worker's access token could not be created.",
          variant: "destructive",
        });
        return;
      }
      setLocation(`/edls-sched/${accessUuid}`);
    },
    onError: (error: unknown) => {
      toast({
        title: "Could not open schedule",
        description: getApiErrorMessage(
          error,
          "Failed to create the worker's access token",
        ),
        variant: "destructive",
      });
    },
  });

  if (
    !componentsEnabled ||
    tabAccess.isLoading ||
    !tabAccess.hasAccess("aat")
  ) {
    return null;
  }

  return (
    <Card data-testid="card-edls-schedule-access">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
          Upcoming Schedule
        </CardTitle>
        <CardDescription>
          Open the worker-facing schedule for the next seven days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The worker&apos;s access tokens can be managed{" "}
          <Link
            href={`/workers/${worker.id}/aat`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            here
          </Link>
          .
        </p>
        <Button
          type="button"
          disabled={viewSchedule.isPending}
          onClick={() => viewSchedule.mutate()}
          data-testid="button-view-worker-schedule"
        >
          {viewSchedule.isPending
            ? "Opening schedule..."
            : "View worker's upcoming schedule"}
        </Button>
      </CardContent>
    </Card>
  );
}