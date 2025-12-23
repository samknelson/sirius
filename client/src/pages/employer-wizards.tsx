import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Wand2, Plus } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Wizard, WizardType } from "@/lib/wizard-types";

interface LaunchArgument {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'month' | 'year';
  required: boolean;
  description?: string;
  options?: Array<{ value: string | number; label: string }>;
  defaultValue?: any;
}

function EmployerWizardsContent() {
  const { employer } = useEmployerLayout();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedWizardType, setSelectedWizardType] = useState<string>("");
  const [launchArgValues, setLaunchArgValues] = useState<Record<string, any>>({});

  const { data: wizardTypes } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const { data: launchArguments } = useQuery<LaunchArgument[]>({
    queryKey: ["/api/wizard-types", selectedWizardType, "launch-arguments"],
    queryFn: async () => {
      if (!selectedWizardType) return [];
      const response = await fetch(`/api/wizard-types/${selectedWizardType}/launch-arguments`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch launch arguments");
      return response.json();
    },
    enabled: !!selectedWizardType,
  });

  useEffect(() => {
    if (launchArguments && launchArguments.length > 0) {
      const defaultValues: Record<string, any> = {};
      launchArguments.forEach(arg => {
        if (arg.defaultValue !== undefined) {
          defaultValues[arg.id] = arg.defaultValue;
        }
      });
      setLaunchArgValues(defaultValues);
    } else {
      setLaunchArgValues({});
    }
  }, [launchArguments]);

  const { data: wizards, isLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards", { entityId: employer.id }],
    queryFn: async () => {
      const response = await fetch(`/api/wizards?entityId=${employer.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch wizards");
      return response.json();
    },
  });

  const createWizardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wizards`, {
        type: selectedWizardType,
        status: "draft",
        entityId: employer.id,
        data: { launchArguments: launchArgValues }
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      setIsCreateDialogOpen(false);
      setSelectedWizardType("");
      setLaunchArgValues({});
      toast({
        title: "Wizard Created",
        description: "The wizard has been created successfully.",
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

  const employerWizardTypes = wizardTypes?.filter(wt => wt.entityType === 'employer') || [];

  // Check if all required launch arguments are filled with valid values
  const areRequiredArgsValid = () => {
    if (!launchArguments || launchArguments.length === 0) return true;
    
    return launchArguments.every(arg => {
      if (!arg.required) return true;
      const value = launchArgValues[arg.id];
      // Check for undefined, null, empty string, or zero (invalid for year/month)
      return value !== undefined && value !== null && value !== '' && value !== 0;
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Wizards</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Wizards</CardTitle>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-wizard">
                <Plus className="h-4 w-4 mr-2" />
                Create Wizard
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Wizard</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="wizard-type">Wizard Type</Label>
                  <Select value={selectedWizardType} onValueChange={setSelectedWizardType}>
                    <SelectTrigger id="wizard-type" data-testid="select-wizard-type">
                      <SelectValue placeholder="Select wizard type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employerWizardTypes.map((wizardType) => (
                        <SelectItem key={wizardType.name} value={wizardType.name}>
                          {wizardType.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedWizardType && (
                    <p className="text-sm text-muted-foreground">
                      {employerWizardTypes.find(wt => wt.name === selectedWizardType)?.description}
                    </p>
                  )}
                </div>

                {launchArguments && launchArguments.length > 0 && (
                  <div className="space-y-4 pt-2 border-t">
                    <h3 className="text-sm font-medium">Configuration</h3>
                    {launchArguments.map((arg) => (
                      <div key={arg.id} className="space-y-2">
                        <Label htmlFor={`arg-${arg.id}`}>
                          {arg.name}
                          {arg.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        {arg.type === 'year' && (
                          <Input
                            id={`arg-${arg.id}`}
                            type="number"
                            placeholder="Enter year"
                            value={launchArgValues[arg.id] || ''}
                            onChange={(e) => setLaunchArgValues({ ...launchArgValues, [arg.id]: parseInt(e.target.value) || 0 })}
                            data-testid={`input-arg-${arg.id}`}
                          />
                        )}
                        {arg.type === 'month' && (
                          <Select
                            value={launchArgValues[arg.id]?.toString() || ''}
                            onValueChange={(value) => setLaunchArgValues({ ...launchArgValues, [arg.id]: parseInt(value) })}
                          >
                            <SelectTrigger id={`arg-${arg.id}`} data-testid={`select-arg-${arg.id}`}>
                              <SelectValue placeholder="Select month..." />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                                <SelectItem key={month} value={month.toString()}>
                                  {new Date(2000, month - 1).toLocaleString('default', { month: 'long' })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {arg.type === 'number' && (
                          <Input
                            id={`arg-${arg.id}`}
                            type="number"
                            placeholder={`Enter ${arg.name.toLowerCase()}`}
                            value={launchArgValues[arg.id] || ''}
                            onChange={(e) => setLaunchArgValues({ ...launchArgValues, [arg.id]: parseFloat(e.target.value) || 0 })}
                            data-testid={`input-arg-${arg.id}`}
                          />
                        )}
                        {arg.type === 'text' && (
                          <Input
                            id={`arg-${arg.id}`}
                            type="text"
                            placeholder={`Enter ${arg.name.toLowerCase()}`}
                            value={launchArgValues[arg.id] || ''}
                            onChange={(e) => setLaunchArgValues({ ...launchArgValues, [arg.id]: e.target.value })}
                            data-testid={`input-arg-${arg.id}`}
                          />
                        )}
                        {arg.type === 'select' && arg.options && (
                          <Select
                            value={launchArgValues[arg.id]?.toString() || ''}
                            onValueChange={(value) => setLaunchArgValues({ ...launchArgValues, [arg.id]: value })}
                          >
                            <SelectTrigger id={`arg-${arg.id}`} data-testid={`select-arg-${arg.id}`}>
                              <SelectValue placeholder={`Select ${arg.name.toLowerCase()}...`} />
                            </SelectTrigger>
                            <SelectContent>
                              {arg.options.map((option) => (
                                <SelectItem key={option.value} value={option.value.toString()}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {arg.description && (
                          <p className="text-xs text-muted-foreground">{arg.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreateDialogOpen(false);
                      setSelectedWizardType("");
                      setLaunchArgValues({});
                    }}
                    data-testid="button-cancel-create"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createWizardMutation.mutate()}
                    disabled={!selectedWizardType || !areRequiredArgsValid() || createWizardMutation.isPending}
                    data-testid="button-confirm-create"
                  >
                    {createWizardMutation.isPending ? "Creating..." : "Create"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {!wizards || wizards.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Wand2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No wizards found for this employer</p>
            <p className="text-sm mt-2">Create a wizard to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {wizards.map((wizard) => {
              const wizardType = wizardTypes?.find(wt => wt.name === wizard.type);
              const launchArgs = wizard.data?.launchArguments;
              const monthName = launchArgs?.month ? new Date(2000, launchArgs.month - 1).toLocaleString('default', { month: 'long' }) : null;
              
              return (
                <div
                  key={wizard.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => setLocation(`/wizards/${wizard.id}`)}
                  data-testid={`wizard-item-${wizard.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-foreground">
                        {wizardType?.displayName || wizard.type}
                      </h4>
                      {launchArgs?.year && launchArgs?.month && (
                        <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary font-medium">
                          {monthName} {launchArgs.year}
                        </span>
                      )}
                      <span className="text-xs px-2 py-1 rounded bg-muted text-muted-foreground">
                        {wizard.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm text-muted-foreground">
                        Created: {format(new Date(wizard.date), 'PPP')}
                      </p>
                      {wizard.currentStep && (
                        <>
                          <span className="text-muted-foreground">•</span>
                          <p className="text-sm text-muted-foreground">
                            Step: {wizard.currentStep}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EmployerWizards() {
  return (
    <EmployerLayout activeTab="wizards">
      <EmployerWizardsContent />
    </EmployerLayout>
  );
}
