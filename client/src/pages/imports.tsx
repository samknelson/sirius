import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileSpreadsheet, Plus, Clock, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { WizardType, Wizard, LaunchArgument } from "@/lib/wizard-types";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Imports() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedWizardType, setSelectedWizardType] = useState<string>("");
  const [launchArgValues, setLaunchArgValues] = useState<Record<string, any>>({});

  const { data: allWizardTypes, isLoading: typesLoading } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const feedTypes = allWizardTypes?.filter(wt => wt.isFeed && !wt.entityType) || [];

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

  const { data: allWizards, isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
  });

  const feedWizards = allWizards?.filter(w => feedTypes.some(ft => ft.name === w.type)) || [];

  const createWizardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wizards`, {
        type: selectedWizardType,
        status: "draft",
        data: { launchArguments: launchArgValues }
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      setIsCreateDialogOpen(false);
      setSelectedWizardType("");
      setLaunchArgValues({});
      toast({ title: "Import created", description: "Your import wizard has been created." });
      setLocation(`/wizards/${newWizard.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = typesLoading || wizardsLoading;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "complete":
        return <Badge variant="default" data-testid={`badge-status-${status}`}>Complete</Badge>;
      case "draft":
        return <Badge variant="secondary" data-testid={`badge-status-${status}`}>Draft</Badge>;
      default:
        return <Badge variant="outline" data-testid={`badge-status-${status}`}>{status}</Badge>;
    }
  };

  const allLaunchArgsValid = !launchArguments || launchArguments.length === 0 ||
    launchArguments.filter(arg => arg.required).every(arg => launchArgValues[arg.id]);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-imports-title">Imports</h1>
          <p className="text-muted-foreground" data-testid="text-imports-description">
            Upload and process data imports
          </p>
        </div>
        {feedTypes.length > 0 && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-import">
                <Plus className="h-4 w-4 mr-2" />
                New Import
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Import</DialogTitle>
                <DialogDescription>
                  Select the type of import to create.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Import Type</Label>
                  <Select value={selectedWizardType} onValueChange={setSelectedWizardType}>
                    <SelectTrigger data-testid="select-import-type">
                      <SelectValue placeholder="Select import type" />
                    </SelectTrigger>
                    <SelectContent>
                      {feedTypes.map(ft => (
                        <SelectItem key={ft.name} value={ft.name} data-testid={`option-import-type-${ft.name}`}>
                          {ft.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {launchArguments && launchArguments.length > 0 && launchArguments.map(arg => (
                  <div key={arg.id} className="space-y-2">
                    <Label>{arg.name}{arg.required && " *"}</Label>
                    {arg.description && (
                      <p className="text-sm text-muted-foreground">{arg.description}</p>
                    )}
                    {arg.type === "select" && arg.options ? (
                      <Select
                        value={launchArgValues[arg.id] || ""}
                        onValueChange={(val) => setLaunchArgValues(prev => ({ ...prev, [arg.id]: val }))}
                      >
                        <SelectTrigger data-testid={`select-launch-arg-${arg.id}`}>
                          <SelectValue placeholder={`Select ${arg.name.toLowerCase()}`} />
                        </SelectTrigger>
                        <SelectContent>
                          {arg.options.map((opt: { value: string; label: string }) => (
                            <SelectItem key={opt.value} value={opt.value} data-testid={`option-launch-arg-${arg.id}-${opt.value}`}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <input
                        type="text"
                        className="w-full border rounded px-3 py-2"
                        value={launchArgValues[arg.id] || ""}
                        onChange={(e) => setLaunchArgValues(prev => ({ ...prev, [arg.id]: e.target.value }))}
                        data-testid={`input-launch-arg-${arg.id}`}
                      />
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  data-testid="button-cancel-import"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => createWizardMutation.mutate()}
                  disabled={!selectedWizardType || !allLaunchArgsValid || createWizardMutation.isPending}
                  data-testid="button-create-import"
                >
                  {createWizardMutation.isPending ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : feedWizards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2" data-testid="text-no-imports">No imports yet</h3>
            <p className="text-muted-foreground text-center mb-4" data-testid="text-no-imports-description">
              Click "New Import" to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {feedWizards
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map(wizard => {
              const wizardType = feedTypes.find(ft => ft.name === wizard.type);
              const wizardData = wizard.data as any;
              const launchArgs = wizardData?.launchArguments || {};
              return (
                <Card
                  key={wizard.id}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => setLocation(`/wizards/${wizard.id}`)}
                  data-testid={`card-import-${wizard.id}`}
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div className="flex items-center gap-4">
                      <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <div className="font-medium" data-testid={`text-import-type-${wizard.id}`}>
                          {wizardType?.displayName || wizard.type}
                          {Object.keys(launchArgs).length > 0 && (
                            <span className="text-muted-foreground ml-2 text-sm">
                              ({Object.values(launchArgs).join(", ")})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span data-testid={`text-import-date-${wizard.id}`}>
                            {format(new Date(wizard.date), "MMM d, yyyy h:mm a")}
                          </span>
                          {wizard.currentStep && (
                            <span>• Step: {wizard.currentStep}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(wizard.status)}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}
