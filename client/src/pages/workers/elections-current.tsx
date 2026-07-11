import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ElectionFormDialog } from "@/components/trust/ElectionFormDialog";
import { formatYmd } from "@shared/utils";
import type { WorkerTrustElectionView } from "@shared/schema";

function ElectionsCurrentContent() {
  const { worker } = useWorkerLayout();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("staff");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const enrollMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/wizards", {
        type: "benefit_election_enrollment",
        status: "draft",
        data: { launchArguments: { workerId: worker.id } },
      });
    },
    onSuccess: (wizard: { id: string }) => {
      navigate(`/wizards/${wizard.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openEnrollmentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/wizards", {
        type: "open_enrollment_enrollment",
        status: "draft",
        data: { launchArguments: { workerId: worker.id } },
      });
    },
    onSuccess: (wizard: { id: string }) => {
      navigate(`/wizards/${wizard.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const lifeEventMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/wizards", {
        type: "life_event_enrollment",
        status: "draft",
        data: { launchArguments: { workerId: worker.id } },
      });
    },
    onSuccess: (wizard: { id: string }) => {
      navigate(`/wizards/${wizard.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Open Enrollment is only offered while an admin-configured window is open.
  // The wizard's create hook enforces the same gate server-side; this just
  // controls whether the launch button is shown at all.
  const { data: openWindow } = useQuery<{
    active: { id: string; planYear: number } | null;
    today: string;
  }>({
    queryKey: ["/api/trust/open-enrollment-windows/active"],
    enabled: canEdit,
  });
  const activeWindow = openWindow?.active ?? null;

  const { data: current, isLoading } = useQuery<WorkerTrustElectionView | null>({
    queryKey: ["/api/workers", worker.id, "trust-elections", "current"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections/current`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  // First-time enrollment is only offered when the worker has no active
  // medical or dental election. The wizard's create hook enforces the same
  // gate server-side; this just reflects it in the button's enabled state.
  const { data: firstTimeEligibility } = useQuery<{ eligible: boolean; reason?: string }>({
    queryKey: ["/api/workers", worker.id, "trust-elections", "first-time-eligibility"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections/first-time-eligibility`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: canEdit,
  });
  const firstTimeBlocked = firstTimeEligibility ? !firstTimeEligibility.eligible : false;

  // Life-event changes are only offered when the worker HAS an active
  // election. The wizard's create hook enforces the same gate server-side;
  // this just reflects it in the button's enabled state.
  const { data: lifeEventEligibility } = useQuery<{ eligible: boolean; reason?: string }>({
    queryKey: ["/api/workers", worker.id, "trust-elections", "life-event-eligibility"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${worker.id}/trust-elections/life-event-eligibility`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: canEdit,
  });
  const lifeEventBlocked = lifeEventEligibility ? !lifeEventEligibility.eligible : false;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Current Trust Election</CardTitle>
          {canEdit && (
            <div className="flex gap-2">
              <span
                className="inline-flex"
                title={firstTimeBlocked ? firstTimeEligibility?.reason : undefined}
              >
                <Button
                  variant="outline"
                  onClick={() => enrollMutation.mutate()}
                  disabled={enrollMutation.isPending || firstTimeBlocked}
                  data-testid="button-enrollment-wizard"
                >
                  {enrollMutation.isPending ? "Starting…" : "First-time Enrollment"}
                </Button>
              </span>
              {activeWindow && (
                <Button
                  variant="outline"
                  onClick={() => openEnrollmentMutation.mutate()}
                  disabled={openEnrollmentMutation.isPending}
                  data-testid="button-open-enrollment-wizard"
                >
                  {openEnrollmentMutation.isPending
                    ? "Starting…"
                    : `Open Enrollment ${activeWindow.planYear}`}
                </Button>
              )}
              <span
                className="inline-flex"
                title={lifeEventBlocked ? lifeEventEligibility?.reason : undefined}
              >
                <Button
                  variant="outline"
                  onClick={() => lifeEventMutation.mutate()}
                  disabled={lifeEventMutation.isPending || lifeEventBlocked}
                  data-testid="button-life-event-wizard"
                >
                  {lifeEventMutation.isPending ? "Starting…" : "Life Event"}
                </Button>
              </span>
              <Button onClick={() => setIsModalOpen(true)} data-testid="button-create-election">
                New Election
              </Button>
            </div>
          )}
        </div>
        <CardDescription>
          The worker's currently active trust election. Creating a new election will end-date this one automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {current ? (
          <div className="space-y-3" data-testid="card-current-election">
            <div className="flex items-center gap-2">
              <Badge variant="default">Active</Badge>
              {canEdit && (
                <Link
                  href={`/trust/election/${current.id}`}
                  className="text-primary underline-offset-2 hover:underline"
                  data-testid="link-current-election-detail"
                >
                  View detail
                </Link>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Employer</dt>
                <dd data-testid="text-current-employer">{current.employerName ?? "Unknown employer"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Policy</dt>
                <dd data-testid="text-current-policy">{current.policyName ?? "Unknown policy"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date</dt>
                <dd data-testid="text-current-date">
                  {formatYmd(current.startYmd)} – {current.endYmd ? formatYmd(current.endYmd) : "ongoing"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Benefits</dt>
                <dd data-testid="text-current-benefits">
                  {current.benefits && current.benefits.length > 0
                    ? current.benefits.map((b) => b.name).join(", ")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Relationships</dt>
                <dd data-testid="text-current-relationships">
                  {current.relationships && current.relationships.length > 0
                    ? current.relationships.map((r) => r.label).join(", ")
                    : "—"}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground" data-testid="text-no-current-election">
            No active election for this worker.
          </div>
        )}
      </CardContent>

      {canEdit && (
        <ElectionFormDialog
          open={isModalOpen}
          onOpenChange={setIsModalOpen}
          mode="create"
          workerId={worker.id}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "trust-elections"] });
          }}
        />
      )}
    </Card>
  );
}

export default function ElectionsCurrentPage() {
  return (
    <WorkerLayout activeTab="elections-current">
      <ElectionsCurrentContent />
    </WorkerLayout>
  );
}
