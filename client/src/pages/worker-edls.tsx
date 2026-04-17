import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { useAccessCheck } from "@/hooks/use-access-check";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WorkerEdlsState {
  workerId: string;
  active: boolean;
  exists: boolean;
}

function WorkerEdlsContent() {
  const { worker } = useWorkerLayout();
  const { canAccess: canEdit } = useAccessCheck('edls.coordinator', worker.id);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<WorkerEdlsState>({
    queryKey: ["/api/workers", worker.id, "edls"],
  });

  const setActive = useMutation({
    mutationFn: async (active: boolean) => {
      return apiRequest("PUT", `/api/workers/${worker.id}/edls`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "edls"] });
      toast({ title: "EDLS state updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update EDLS state",
        description: err?.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>EDLS</CardTitle>
        <CardDescription>
          Toggle whether this worker is active in the Employer Day Labor Scheduler.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <div className="flex items-center space-x-3">
            <Switch
              id="edls-active"
              checked={data.active}
              disabled={!canEdit || setActive.isPending}
              onCheckedChange={(checked) => setActive.mutate(checked)}
              data-testid="switch-edls-active"
            />
            <Label htmlFor="edls-active" data-testid="label-edls-active">
              {data.active ? "Active in EDLS" : "Inactive in EDLS"}
            </Label>
          </div>
        )}
        {!canEdit && (
          <p className="text-sm text-muted-foreground mt-2">
            You do not have permission to change this setting.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerEdls() {
  return (
    <WorkerLayout activeTab="edls">
      <WorkerEdlsContent />
    </WorkerLayout>
  );
}
