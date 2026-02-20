import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Plus, Clock, CheckCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Wizard, WizardStatus } from "@/lib/wizard-types";

export default function BtuBuildingRepImportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: wizards, isLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards", { type: "btu_building_rep_import" }],
  });

  const { data: statuses } = useQuery<WizardStatus[]>({
    queryKey: ["/api/wizard-types/btu_building_rep_import/statuses"],
  });

  const createWizardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wizards`, {
        type: "btu_building_rep_import",
        status: "draft",
        entityId: null,
        data: {}
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      toast({
        title: "Import Started",
        description: "New Building Rep Import wizard created.",
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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold" data-testid="page-title">BTU Building Rep Import</h1>
          <p className="text-muted-foreground">Import building representatives from CSV files</p>
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
            <Upload className="h-5 w-5" />
            Recent Imports
          </CardTitle>
          <CardDescription>
            View and manage your building rep import wizards
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
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Upload className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-no-imports">No building rep imports yet</p>
              <p className="text-sm text-muted-foreground">
                Click "New Import" to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {wizards.map((wizard) => (
                <div
                  key={wizard.id}
                  className="flex items-center justify-between p-4 border rounded-md hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/wizards/${wizard.id}`)}
                  data-testid={`card-wizard-${wizard.id}`}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {(wizard.data as any)?.csvFileName || `Import ${wizard.id.slice(0, 8)}`}
                      </span>
                      {getStatusBadge(wizard.status)}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      Created {wizard.date ? format(new Date(wizard.date), 'MMM d, yyyy h:mm a') : 'Unknown'}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" data-testid={`button-view-wizard-${wizard.id}`}>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
