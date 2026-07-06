import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Wand2, ArrowLeft, Trash2, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RetentionSettings } from "@/components/wizards/RetentionSettings";
import { FrameworkWizardBody } from "@/components/wizards/framework/FrameworkWizardBody";
import type { WizardManifest } from "@/components/wizards/framework/types";
import type { WizardData } from "@shared/schema";
import type { ReportData } from "@shared/wizard-types";
import { Wizard, WizardType } from "@/lib/wizard-types";
import { Employer } from "@/lib/employer-types";

export default function WizardView() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: wizard, isLoading: wizardLoading, error: wizardError } = useQuery<Wizard>({
    queryKey: [`/api/wizards/${id}`],
    enabled: !!id,
    // Framework wizards attach a manifest; poll while a run step is in
    // progress so progress updates flow off this same load route.
    refetchInterval: (query) => {
      const m = (query.state.data as any)?.manifest as WizardManifest | undefined;
      if (!m) return false;
      const current = m.steps.find((s) => s.id === m.currentStep);
      return current?.progress?.status === "in_progress" ? 1000 : false;
    },
  });

  const manifest = (wizard as any)?.manifest as WizardManifest | undefined;

  const { data: allWizardTypes } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
    enabled: !!wizard,
  });

  const wizardType = allWizardTypes?.find(t => t.name === wizard?.type);

  const { data: employer } = useQuery<Employer>({
    queryKey: [`/api/employers/${wizard?.entityId}`],
    enabled: !!wizard?.entityId && wizardType?.entityType === 'employer',
  });

  const { data: wizardFiles = [] } = useQuery<any[]>({
    queryKey: ["/api/wizards", id, "files"],
    enabled: !!wizard && !!id,
  });

  const deleteWizardMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/wizards/${id}`, {});
    },
    onSuccess: () => {
      // Invalidate wizard list caches before navigating so lists refresh
      queryClient.invalidateQueries({ queryKey: ['/api/wizards'] });
      // Also invalidate the employer-specific wizard list if applicable
      if (wizard?.entityId) {
        queryClient.invalidateQueries({ queryKey: ['/api/wizards', { entityId: wizard.entityId }] });
      }

      toast({
        title: "Wizard Deleted",
        description: "The wizard and all associated files have been deleted successfully.",
      });
      // Navigate back to employer wizards page or homepage
      if (wizard?.entityId && wizardType?.entityType === 'employer') {
        setLocation(`/employers/${wizard.entityId}/wizards`);
      } else {
        setLocation("/");
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete wizard",
        variant: "destructive",
      });
    },
  });

  const wizardData = wizard?.data as WizardData | undefined;

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
              <h1 className="text-xl md:text-2xl font-semibold text-foreground" data-testid="text-wizard-title">
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

      <Tabs defaultValue="wizard" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="wizard" data-testid="tab-wizard">
            <Wand2 className="h-4 w-4 mr-2" />
            Wizard
          </TabsTrigger>
          {wizardType?.isReport && (
            <TabsTrigger value="retention" data-testid="tab-retention">
              <Clock className="h-4 w-4 mr-2" />
              Retention
            </TabsTrigger>
          )}
          <TabsTrigger value="delete" data-testid="tab-delete">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </TabsTrigger>
        </TabsList>

        <TabsContent value="wizard">
          {manifest ? (
            /* Framework (plugin-based) wizard: manifest-driven stepper + body */
            <FrameworkWizardBody
              wizardId={wizard.id}
              wizardType={wizard.type}
              data={wizardData}
              manifest={manifest}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                This wizard is not available.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {wizardType?.isReport && (
          <TabsContent value="retention">
            <RetentionSettings 
              wizardId={wizard.id} 
              currentRetention={(wizardData as ReportData)?.retention}
              wizardData={(wizardData as ReportData) ?? {}}
            />
          </TabsContent>
        )}

        <TabsContent value="delete">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Delete Wizard
              </CardTitle>
              <CardDescription>
                Permanently delete this wizard and all associated files
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
                <h3 className="font-medium mb-2">This action cannot be undone</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Deleting this wizard will:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                  <li>Permanently delete the wizard record</li>
                  <li>Delete all associated files from storage ({wizardFiles.length} file{wizardFiles.length !== 1 ? 's' : ''})</li>
                  <li>Remove all progress and validation data</li>
                  <li>This data cannot be recovered</li>
                </ul>
              </div>

              <div className="flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="destructive" 
                      disabled={deleteWizardMutation.isPending}
                      data-testid="button-delete-wizard"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      {deleteWizardMutation.isPending ? "Deleting..." : "Delete Wizard"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the wizard "{wizardType?.displayName || wizard.type}" 
                        and all {wizardFiles.length} associated file{wizardFiles.length !== 1 ? 's' : ''}. 
                        This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteWizardMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        data-testid="button-confirm-delete"
                      >
                        Delete Wizard
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
