import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { LogIn, Loader2 } from "lucide-react";

interface AsiResponse {
  asi: boolean;
}

function DispatchAsiContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<AsiResponse>({
    queryKey: ["/api/worker-dispatch-asi/worker", worker.id],
  });

  const updateMutation = useMutation({
    mutationFn: async (asi: boolean) => {
      return await apiRequest("PUT", `/api/worker-dispatch-asi/worker/${worker.id}`, { asi });
    },
    onSuccess: (result: AsiResponse) => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-asi/worker", worker.id] });
      toast({
        title: "Saved",
        description: `Auto Sign-In is now ${result?.asi ? "on" : "off"}.`,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update Auto Sign-In.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-64" />
        </CardContent>
      </Card>
    );
  }

  const asi = data?.asi ?? false;

  return (
    <Card>
      <CardHeader className="space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="flex items-center gap-2" data-testid="text-asi-title">
            <LogIn className="h-5 w-5" />
            Auto Sign-In
          </CardTitle>
          {updateMutation.isPending && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <CardDescription data-testid="text-asi-description">
          When Auto Sign-In is on, this worker is automatically signed in for dispatch.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 pt-2">
          <Switch
            id="asi-toggle"
            checked={asi}
            disabled={updateMutation.isPending}
            onCheckedChange={(checked) => updateMutation.mutate(checked)}
            data-testid="switch-asi"
          />
          <Label htmlFor="asi-toggle" data-testid="text-asi-state">
            Auto Sign-In is {asi ? "on" : "off"}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}

export default function WorkerDispatchAsi() {
  return (
    <WorkerLayout activeTab="dispatch-asi">
      <DispatchAsiContent />
    </WorkerLayout>
  );
}
