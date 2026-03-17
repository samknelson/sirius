import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Upload, Building2, Check, AlertTriangle, Loader2, ExternalLink } from "lucide-react";

interface WorkerLoadStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function WorkerLoadStep({ wizardId, data }: WorkerLoadStepProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const employerId = data?.employerId;
  const processingResults = data?.processingResults;
  const childWizardId = data?.childWizardId;

  const { data: childWizard } = useQuery<any>({
    queryKey: [`/api/wizards/${childWizardId}`],
    enabled: !!childWizardId,
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/wizards/${wizardId}/employer-onboarding/process`, {});
      return response;
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Employer Created",
        description: `Successfully created employer "${data?.employerName}"`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Processing Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createChildWizardMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      const response = await apiRequest("POST", "/api/wizards", {
        type: "gbhet_legal_workers_monthly",
        status: "draft",
        entityId: employerId,
        data: {
          launchArguments: {
            year: now.getFullYear(),
            month: now.getMonth() + 1,
          },
          mode: "create",
        },
      });
      return response;
    },
    onSuccess: async (result: any) => {
      await apiRequest("PATCH", `/api/wizards/${wizardId}`, {
        data: {
          childWizardId: result.id,
          progress: {
            ...(data?.progress || {}),
            worker_load: {
              ...((data?.progress || {}).worker_load || {}),
              childWizardCreated: true,
            },
          },
        },
      });
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Worker Import Wizard Created",
        description: "You can now load workers for this employer",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!employerId) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Upload className="text-primary" size={20} />
            </div>
            <div>
              <CardTitle>Worker Load</CardTitle>
              <CardDescription>Create the employer and load initial workers</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <Building2 className="h-4 w-4" />
            <AlertTitle>Ready to Create Employer</AlertTitle>
            <AlertDescription>
              This will create the employer "<span className="font-medium">{data?.employerName}</span>" with the configured
              attributes, contacts, and ledger accounts. Once created, you can load initial workers.
            </AlertDescription>
          </Alert>

          {processingResults?.errors?.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Processing Errors</AlertTitle>
              <AlertDescription>
                <ul className="list-disc ml-4 mt-2 space-y-1">
                  {processingResults.errors.map((err: any, i: number) => (
                    <li key={i} className="text-sm">{err.message} ({err.type})</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Employer:</span> {data?.employerName}</p>
            {data?.contacts?.length > 0 && (
              <p><span className="font-medium">Contacts:</span> {data.contacts.length} will be created
                {data.contacts.filter((c: any) => c.promoteToUser).length > 0 && (
                  <span> ({data.contacts.filter((c: any) => c.promoteToUser).length} with user accounts)</span>
                )}
              </p>
            )}
            {data?.ledgerAccountIds?.length > 0 && (
              <p><span className="font-medium">Ledger Accounts:</span> {data.ledgerAccountIds.length} will be linked</p>
            )}
          </div>

          <Button
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending}
            className="w-full sm:w-auto"
          >
            {processMutation.isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Creating Employer...
              </>
            ) : (
              <>
                <Building2 size={16} className="mr-2" />
                Create Employer & Process
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
            <Check className="text-green-600 dark:text-green-400" size={20} />
          </div>
          <div>
            <CardTitle>Worker Load</CardTitle>
            <CardDescription>Employer created successfully. Now load initial workers.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <Check className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-800 dark:text-green-200">Employer Created</AlertTitle>
          <AlertDescription className="text-green-700 dark:text-green-300">
            {processingResults?.employer?.name} has been created successfully.
            {processingResults?.contacts?.length > 0 && (
              <span> {processingResults.contacts.length} contact(s) linked.</span>
            )}
            {processingResults?.users?.length > 0 && (
              <span> {processingResults.users.length} user account(s) created.</span>
            )}
            {processingResults?.ledgerLinks?.length > 0 && (
              <span> {processingResults.ledgerLinks.length} ledger account(s) linked.</span>
            )}
          </AlertDescription>
        </Alert>

        <div className="border rounded-lg p-4 space-y-4">
          <h3 className="font-medium">Initial Worker Import</h3>
          <p className="text-sm text-muted-foreground">
            Use the GBHET Legal Workers wizard to load an initial set of workers for this employer.
            This step is optional - you can skip it and load workers later.
          </p>

          {childWizardId ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={childWizard?.status === 'completed' ? 'default' : 'secondary'}>
                  {childWizard?.status || 'Loading...'}
                </Badge>
                <span className="text-sm">Worker Import Wizard</span>
              </div>
              <Button
                variant="outline"
                onClick={() => setLocation(`/wizards/${childWizardId}`)}
              >
                <ExternalLink size={16} className="mr-2" />
                {childWizard?.status === 'completed' ? 'View Completed Import' : 'Continue Worker Import'}
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => createChildWizardMutation.mutate()}
              disabled={createChildWizardMutation.isPending}
              variant="outline"
            >
              {createChildWizardMutation.isPending ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Upload size={16} className="mr-2" />
                  Launch Worker Import Wizard
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
