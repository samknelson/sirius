import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Plus, ChevronLeft, Play, Info } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Wizard, WizardType } from "@/lib/wizard-types";

export default function ReportType() {
  const [, params] = useRoute("/reports/:reportType");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const reportTypeName = params?.reportType || "";

  const { data: allWizardTypes, isLoading: typesLoading } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  const reportType = allWizardTypes?.find(wt => wt.name === reportTypeName);

  const { data: allWizards, isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
  });

  const reportWizards = (allWizards?.filter(w => w.type === reportTypeName) || [])
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const createReportMutation = useMutation<Wizard, Error>({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/wizards`, {
        type: reportTypeName,
        status: "draft",
        entityId: null,
        data: {}
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      setIsCreateDialogOpen(false);
      toast({
        title: "Report Created",
        description: "The report wizard has been created successfully.",
      });
      setLocation(`/wizards/${newWizard.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create report",
        variant: "destructive",
      });
    },
  });

  const handleCreateReport = () => {
    createReportMutation.mutate();
  };

  // Show loading state while wizard types are loading
  if (typesLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  // Only show "not found" after types have loaded
  if (!reportType) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Alert variant="destructive">
          <AlertDescription>
            Report type "{reportTypeName}" not found.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/reports">
              <Button variant="ghost" size="sm" className="mb-2" data-testid="button-back-to-reports">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Reports
              </Button>
            </Link>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                <FileText className="text-primary-foreground" size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="text-report-type-title">
                  {reportType.displayName}
                </h1>
                {reportType.description && (
                  <p className="text-sm text-muted-foreground">
                    {reportType.description}
                  </p>
                )}
              </div>
            </div>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-report">
                <Plus className="h-4 w-4 mr-2" />
                New Report
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Report</DialogTitle>
                <DialogDescription>
                  Create a new {reportType.displayName} report
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    This will create a new report wizard. You'll be able to configure and run it on the next page.
                  </AlertDescription>
                </Alert>
                
                <div className="flex justify-end gap-2 pt-6">
                  <Button
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    data-testid="button-cancel-create"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateReport}
                    disabled={createReportMutation.isPending}
                    data-testid="button-confirm-create"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {createReportMutation.isPending ? "Creating..." : "Create Report"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {wizardsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !reportWizards || reportWizards.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <FileText className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">No Reports Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first {reportType.displayName} report to get started
              </p>
              <Button 
                variant="outline" 
                onClick={() => setIsCreateDialogOpen(true)}
                data-testid="button-create-first-report"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Report
              </Button>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportWizards.map(wizard => {
                    const recordCount = wizard.data?.reportMeta?.recordCount;
                    return (
                      <TableRow 
                        key={wizard.id}
                        className="cursor-pointer"
                        onClick={() => setLocation(`/wizards/${wizard.id}`)}
                        data-testid={`row-report-${wizard.id}`}
                      >
                        <TableCell>
                          {format(new Date(wizard.date), 'PPp')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={wizard.status === 'completed' ? 'default' : 'secondary'}>
                            {wizard.status}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-record-count-${wizard.id}`}>
                          {recordCount !== undefined ? recordCount.toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLocation(`/wizards/${wizard.id}`);
                            }}
                            data-testid={`button-view-report-${wizard.id}`}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
