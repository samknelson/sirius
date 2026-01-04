import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DispatchJobTypeLayout, useDispatchJobTypeLayout } from "@/components/layouts/DispatchJobTypeLayout";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Loader2, AlertTriangle } from "lucide-react";

function DispatchJobTypeDeleteContent() {
  const { jobType } = useDispatchJobTypeLayout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/dispatch-job-types/${jobType.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch-job-types"] });
      toast({
        title: "Success",
        description: "Job type deleted successfully.",
      });
      setLocation("/config/dispatch-job-types");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete job type.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive" data-testid="title-delete">
          <AlertTriangle className="h-5 w-5" />
          Delete Job Type
        </CardTitle>
        <CardDescription>
          This action cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-4">
          <p className="text-foreground">
            Are you sure you want to delete the job type <strong>"{jobType.name}"</strong>?
          </p>
          <p className="text-muted-foreground mt-2">
            Jobs that use this job type will no longer have an associated type.
          </p>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="destructive" 
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete"
          >
            {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Job Type
          </Button>
          <Button 
            variant="ghost" 
            onClick={() => setLocation(`/config/dispatch-job-type/${jobType.id}`)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobTypeDeletePage() {
  usePageTitle("Delete Job Type");
  return (
    <DispatchJobTypeLayout activeTab="delete">
      <DispatchJobTypeDeleteContent />
    </DispatchJobTypeLayout>
  );
}
