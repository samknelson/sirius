import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAccessCheck } from "@/hooks/use-access-check";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

type Availability = { eligible: boolean; reason?: string; planYear?: number };

function EnrollmentAction({ workerId, type, endpoint, label, testId }: {
  workerId: string; type: string; endpoint: string; label: string; testId: string;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const answer = useQuery<Availability>({
    queryKey: ["/api/workers", workerId, "trust-elections", endpoint],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${workerId}/trust-elections/${endpoint}`);
      if (!res.ok) throw new Error("Availability could not be checked. Reload to try again.");
      return res.json();
    },
    staleTime: 0,
    retry: false,
  });
  const launch = useMutation({
    mutationFn: () => apiRequest("POST", "/api/wizards", {
      type, entityId: workerId, status: "draft",
      data: { launchArguments: { workerId } },
    }),
    onSuccess: (wizard: { id: string }) => navigate(`/wizards/${wizard.id}`),
    onError: (error: Error) => toast({ title: "Unable to start enrollment", description: error.message, variant: "destructive" }),
  });
  const reason = answer.isError ? "Availability could not be checked. Reload to try again."
    : answer.isPending || answer.isFetching ? "Checking availability…"
    : answer.data?.eligible !== true ? answer.data?.reason || "Enrollment is unavailable." : undefined;
  return <div className="space-y-1">
    <Button variant="outline" data-testid={testId}
      disabled={!!reason || launch.isPending}
      onClick={() => launch.mutate()}>
      {launch.isPending ? "Starting…" : `${label}${answer.data?.planYear ? ` ${answer.data.planYear}` : ""}`}
    </Button>
    {reason && <p className="text-xs text-muted-foreground max-w-60" role="status">{label}: {reason}</p>}
  </div>;
}

export function EnrollmentLaunchers({ workerId }: { workerId: string }) {
  const access = useAccessCheck("worker.mine", workerId);
  if (access.isError) return <p role="status">Enrollment access could not be checked. Reload to try again.</p>;
  if (access.isLoading) return <p role="status">Checking enrollment access…</p>;
  if (!access.canAccess) return null;
  return <div className="flex flex-wrap gap-2">
    <EnrollmentAction workerId={workerId} type="benefit_election_enrollment" endpoint="first-time-eligibility"
      label="First-time Enrollment" testId="button-enrollment-wizard" />
    <EnrollmentAction workerId={workerId} type="open_enrollment_enrollment" endpoint="open-enrollment-eligibility"
      label="Open Enrollment" testId="button-open-enrollment-wizard" />
    <EnrollmentAction workerId={workerId} type="life_event_enrollment" endpoint="life-event-eligibility"
      label="Life Event" testId="button-life-event-wizard" />
  </div>;
}
