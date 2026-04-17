import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Plus, Clock, CheckCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Wizard, WizardStatus } from "@/lib/wizard-types";

export default function BtuDuesAllocationPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: wizards, isLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards", { type: "btu_dues_allocation" }],
  });

  const { data: statuses } = useQuery<WizardStatus[]>({
    queryKey: ["/api/wizard-types/btu_dues_allocation/statuses"],
  });

  const createWizardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wizards`, {
        type: "btu_dues_allocation",
        status: "draft",
        entityId: null,
        data: {}
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      toast({
        title: "Import Started",
        description: "New BTU Dues Allocation wizard created.",
      });
      setLocation(`/wizards/${newWizard.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create wizard",
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof CheckCircle }> = {
      draft: { variant: "secondary", icon: Clock },
      completed: { variant: "default", icon: CheckCircle },
      completed_with_errors: { variant: "destructive", icon: AlertTriangle },
    };
    const config = statusConfig[status] || { variant: "outline", icon: Clock };
    const Icon = config.icon;
    const statusDef = statuses?.find(s => s.id === status);
    return (
      <Badge variant={config.variant}>
        <Icon className="h-3 w-3 mr-1" />
        {statusDef?.name || status}
      </Badge>
    );
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" data-testid="page-title">BTU Dues Allocation</h1>
          <p className="text-muted-foreground">Import dues allocations from payroll deduction files</p>
        </div>
        <Button
          onClick={() => createWizardMutation.mutate()}
          disabled={createWizardMutation.isPending}
          data-testid="button-new-import"
        >
          <Plus className="h-4 w-4 mr-2" />
          {createWizardMutation.isPending ? "Creating..." : "New Import"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Recent Imports
          </CardTitle>
          <CardDescription>
            View and manage your BTU dues allocation wizards
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !wizards || wizards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No imports yet</p>
              <p className="text-sm">Click "New Import" to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {wizards.map(wizard => {
                const data = wizard.data as any;
                const processResults = data?.processResults;
                return (
                  <div
                    key={wizard.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                    onClick={() => setLocation(`/wizards/${wizard.id}`)}
                    data-testid={`wizard-item-${wizard.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusBadge(wizard.status)}
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(wizard.date), "MMM d, yyyy h:mm a")}
                        </span>
                      </div>
                      {processResults && (
                        <div className="text-sm text-muted-foreground">
                          Created: {processResults.createdCount || 0} | 
                          Errors: {processResults.failureCount || 0}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
