import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, Plus, Wand2, Info, Play } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Wizard {
  id: string;
  date: string;
  type: string;
  status: string;
  entityId: string | null;
  currentStep?: string;
  data: any;
}

interface WizardType {
  name: string;
  displayName: string;
  description?: string;
  isFeed?: boolean;
  entityType?: string;
}

export default function Reports() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<WizardType | null>(null);

  const { data: allWizardTypes } = useQuery<WizardType[]>({
    queryKey: ["/api/wizard-types"],
  });

  // Filter to only report wizard types (those starting with "report_")
  const reportTypes = allWizardTypes?.filter(wt => wt.name.startsWith('report_')) || [];

  const { data: allWizards, isLoading: wizardsLoading } = useQuery<Wizard[]>({
    queryKey: ["/api/wizards"],
  });

  // Filter report wizards client-side from all wizards
  const reportWizards = allWizards?.filter(w => w.type.startsWith('report_')) || [];

  const createReportMutation = useMutation<Wizard, Error, string>({
    mutationFn: async (reportType: string) => {
      return await apiRequest("POST", `/api/wizards`, {
        type: reportType,
        status: "draft",
        entityId: null,
        data: {}
      });
    },
    onSuccess: (newWizard: Wizard) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wizards"] });
      setIsCreateDialogOpen(false);
      setSelectedReportType(null);
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
    if (!selectedReportType) return;
    createReportMutation.mutate(selectedReportType.name);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <FileText className="text-primary-foreground" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground" data-testid="text-reports-title">
                Reports
              </h1>
              <p className="text-sm text-muted-foreground">
                Generate and view worker data reports
              </p>
            </div>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-report">
                <Plus className="h-4 w-4 mr-2" />
                New Report
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create New Report</DialogTitle>
                <DialogDescription>
                  Select a report type to analyze your worker data
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {reportTypes.length === 0 ? (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      No report types are available at this time.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {reportTypes.map(reportType => (
                      <Card 
                        key={reportType.name}
                        className={`cursor-pointer transition-all ${
                          selectedReportType?.name === reportType.name 
                            ? 'ring-2 ring-primary bg-accent' 
                            : 'hover:bg-accent/50'
                        }`}
                        onClick={() => setSelectedReportType(reportType)}
                        data-testid={`card-report-type-${reportType.name}`}
                      >
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-base">{reportType.displayName}</CardTitle>
                              {reportType.description && (
                                <CardDescription className="mt-1">
                                  {reportType.description}
                                </CardDescription>
                              )}
                            </div>
                            {selectedReportType?.name === reportType.name && (
                              <div className="ml-2 h-6 w-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                <div className="h-2 w-2 rounded-full bg-primary-foreground" />
                              </div>
                            )}
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                )}
                
                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsCreateDialogOpen(false);
                      setSelectedReportType(null);
                    }}
                    data-testid="button-cancel-create"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateReport}
                    disabled={!selectedReportType || createReportMutation.isPending}
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
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-muted-foreground" />
            Recent Reports
          </CardTitle>
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
                Create your first report to get started analyzing worker data
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
                    <TableHead>Report Type</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportWizards.map(wizard => {
                    const reportType = reportTypes.find(rt => rt.name === wizard.type);
                    const recordCount = wizard.data?.reportMeta?.recordCount;
                    return (
                      <TableRow 
                        key={wizard.id}
                        className="cursor-pointer"
                        onClick={() => setLocation(`/wizards/${wizard.id}`)}
                        data-testid={`row-report-${wizard.id}`}
                      >
                        <TableCell className="font-medium">
                          {reportType?.displayName || wizard.type}
                        </TableCell>
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
