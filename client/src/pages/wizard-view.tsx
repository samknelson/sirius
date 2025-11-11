import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wand2, ArrowLeft, Building2 } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Wizard {
  id: string;
  date: string;
  type: string;
  status: string;
  entityId: string | null;
  data: any;
}

interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isFeed?: boolean;
  entityType?: string;
}

interface WizardStatus {
  id: string;
  name: string;
  description?: string;
}

interface WizardStep {
  id: string;
  name: string;
  description?: string;
}

interface Employer {
  id: string;
  name: string;
  siriusId: number;
}

export default function WizardView() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: wizard, isLoading: wizardLoading, error: wizardError } = useQuery<Wizard>({
    queryKey: ["/api/wizards", id],
    queryFn: async () => {
      const response = await fetch(`/api/wizards/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Wizard not found");
      return response.json();
    },
  });

  const { data: allWizardTypes } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
    enabled: !!wizard,
  });

  const wizardType = allWizardTypes?.find(t => t.name === wizard?.type);

  const { data: wizardStatuses } = useQuery<WizardStatus[]>({
    queryKey: ["/api/wizard-types", wizard?.type, "statuses"],
    queryFn: async () => {
      const response = await fetch(`/api/wizard-types/${wizard?.type}/statuses`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch statuses");
      return response.json();
    },
    enabled: !!wizard,
  });

  const { data: wizardSteps } = useQuery<WizardStep[]>({
    queryKey: ["/api/wizard-types", wizard?.type, "steps"],
    queryFn: async () => {
      const response = await fetch(`/api/wizard-types/${wizard?.type}/steps`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch steps");
      return response.json();
    },
    enabled: !!wizard,
  });

  const { data: employer } = useQuery<Employer>({
    queryKey: ["/api/employers", wizard?.entityId],
    queryFn: async () => {
      const response = await fetch(`/api/employers/${wizard?.entityId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Employer not found");
      return response.json();
    },
    enabled: !!wizard?.entityId && wizardType?.entityType === 'employer',
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const response = await apiRequest("PATCH", `/api/wizards/${id}`, { status: newStatus });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards", id] });
      toast({
        title: "Status Updated",
        description: "Wizard status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update status",
        variant: "destructive",
      });
    },
  });

  if (wizardError) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <Wand2 className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">Wizard Not Found</h3>
            <p className="text-muted-foreground text-center">
              The wizard you're looking for doesn't exist or has been removed.
            </p>
            <Link href="/employers">
              <Button className="mt-4" data-testid="button-return-to-employers">
                Return to Employers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (wizardLoading || !wizard) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Skeleton className="h-16 w-16 rounded-full mb-4" />
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Wand2 className="text-primary-foreground" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground" data-testid="text-wizard-title">
                {wizardType?.displayName || wizard.type}
              </h1>
              <p className="text-sm text-muted-foreground">
                Created {format(new Date(wizard.date), 'PPP')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {employer && (
              <Link href={`/employers/${employer.id}/wizards`}>
                <Button variant="outline" size="sm" data-testid="button-back-to-employer">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to {employer.name}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details Card */}
          <Card>
            <CardHeader>
              <CardTitle>Wizard Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Type</label>
                  <p className="text-foreground" data-testid="text-wizard-type">
                    {wizardType?.displayName || wizard.type}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <div>
                    <Badge variant="secondary" data-testid="badge-wizard-status">
                      {wizard.status}
                    </Badge>
                  </div>
                </div>
                {wizard.currentStep && (
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-medium text-muted-foreground">Current Step</label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" data-testid="badge-current-step">
                        {wizardSteps?.find(s => s.id === wizard.currentStep)?.name || wizard.currentStep}
                      </Badge>
                    </div>
                  </div>
                )}
                {employer && (
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-medium text-muted-foreground">Associated Employer</label>
                    <Link href={`/employers/${employer.id}`}>
                      <div className="flex items-center gap-2 text-foreground hover:text-primary cursor-pointer">
                        <Building2 className="h-4 w-4" />
                        <span data-testid="link-employer-name">{employer.name}</span>
                      </div>
                    </Link>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Steps Card */}
          {wizardSteps && wizardSteps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {wizardSteps.map((step, index) => {
                    const isCurrentStep = wizard.currentStep === step.id;
                    return (
                      <div
                        key={step.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border ${
                          isCurrentStep 
                            ? 'border-primary bg-primary/5' 
                            : 'border-border'
                        }`}
                        data-testid={`step-${step.id}`}
                      >
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium ${
                          isCurrentStep 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-muted'
                        }`}>
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-foreground">{step.name}</h4>
                            {isCurrentStep && (
                              <Badge variant="default" className="text-xs">Current</Badge>
                            )}
                          </div>
                          {step.description && (
                            <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Status Management */}
          {wizardStatuses && wizardStatuses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Update Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Change Status</label>
                  <Select
                    value={wizard.status}
                    onValueChange={(value) => updateStatusMutation.mutate(value)}
                    disabled={updateStatusMutation.isPending}
                  >
                    <SelectTrigger data-testid="select-update-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {wizardStatuses.map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          {status.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Wizard ID:</span>
                <p className="font-mono text-xs mt-1" data-testid="text-wizard-id">{wizard.id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <p className="mt-1">{format(new Date(wizard.date), 'PPpp')}</p>
              </div>
              {wizardType?.description && (
                <div>
                  <span className="text-muted-foreground">Description:</span>
                  <p className="mt-1">{wizardType.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
