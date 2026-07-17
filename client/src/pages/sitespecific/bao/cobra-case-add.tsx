import { ShieldPlus, ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CobraCaseForm,
  type CobraCaseFormValues,
} from "@/components/sitespecific/bao/CobraCaseForm";

export default function BaoCobraCaseAdd() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async (values: CobraCaseFormValues) => {
      const response = await apiRequest("POST", "/api/sitespecific/bao/cobra/cases", values);
      return response.json();
    },
    onSuccess: async (created: { id: string }) => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/sitespecific/bao/cobra/cases"],
      });
      toast({ title: "COBRA case created" });
      navigate(`/cobra/cases/${created.id}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create COBRA case",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="New COBRA Case"
        icon={<ShieldPlus className="text-primary-foreground" size={16} />}
        actions={
          <Link href="/cobra/cases">
            <Button variant="ghost" size="sm" data-testid="button-back-to-cobra-cases">
              <ArrowLeft size={16} className="mr-2" />
              Back to COBRA Cases
            </Button>
          </Link>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <CobraCaseForm
          submitLabel="Create Case"
          submitting={createMutation.isPending}
          onSubmit={(values) => createMutation.mutate(values)}
          onCancel={() => navigate("/cobra/cases")}
        />
      </main>
    </div>
  );
}
