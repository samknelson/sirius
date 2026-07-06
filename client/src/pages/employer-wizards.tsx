import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Wand2, Plus } from "lucide-react";
import { format } from "date-fns";
import { WizardLauncher } from "@/components/wizards/WizardLauncher";
import { Wizard, WizardType } from "@/lib/wizard-types";

function EmployerWizardsContent() {
  const { employer } = useEmployerLayout();
  const [, setLocation] = useLocation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedWizardType, setSelectedWizardType] = useState<string>("");

  const { data: wizardTypes } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const { data: wizards, isLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards", { entityId: employer.id }],
    queryFn: async () => {
      const response = await fetch(`/api/wizards?entityId=${employer.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch wizards");
      return response.json();
    },
  });

  const employerWizardTypes = wizardTypes?.filter(wt => wt.entityType === 'employer') || [];

  const closeDialog = () => {
    setIsCreateDialogOpen(false);
    setSelectedWizardType("");
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
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={(open) => (open ? setIsCreateDialogOpen(true) : closeDialog())}
          >
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

                {selectedWizardType ? (
                  <WizardLauncher
                    key={selectedWizardType}
                    inline
                    type={selectedWizardType}
                    entityId={employer.id}
                    successTitle="Wizard Created"
                    successDescription="The wizard has been created successfully."
                    submitLabel="Create"
                    onCancel={closeDialog}
                    onCreated={(wizard) => {
                      closeDialog();
                      setLocation(`/wizards/${wizard.id}`);
                    }}
                  />
                ) : (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={closeDialog}
                      data-testid="button-cancel-create"
                    >
                      Cancel
                    </Button>
                    <Button disabled data-testid="button-confirm-create">
                      Create
                    </Button>
                  </div>
                )}
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
