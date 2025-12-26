import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Download, Users, AlertTriangle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount?: number;
  terminatedCount?: number;
  errors: Array<{ rowIndex: number; message: string; data?: Record<string, any> }>;
  resultsFileId?: string;
  completedAt?: string;
}

export function ResultsStep({ wizardId, wizardType, data, onDataChange }: ResultsStepProps) {
  const processResults: ProcessResults | null = data?.processResults || null;
  const asOfDate = data?.asOfDate;
  const terminateByAbsence = data?.terminateByAbsence;

  const downloadResultsFile = async () => {
    if (processResults?.resultsFileId) {
      window.open(`/api/files/${processResults.resultsFileId}/download`, '_blank');
    }
  };

  if (!processResults) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center p-12 space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <p className="text-muted-foreground">No processing results available</p>
            <p className="text-sm text-muted-foreground">
              Please complete the processing step first
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasErrors = processResults.failureCount > 0;
  const hasTerminations = (processResults.terminatedCount ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {hasErrors ? (
                <AlertTriangle className="h-6 w-6 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              )}
              <div>
                <CardTitle>Import Complete</CardTitle>
                <CardDescription>
                  {processResults.completedAt && (
                    <>Completed on {format(new Date(processResults.completedAt), 'MMMM d, yyyy at h:mm a')}</>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2">
              {processResults.resultsFileId && (
                <Button variant="outline" onClick={downloadResultsFile} data-testid="button-download-results">
                  <Download className="h-4 w-4 mr-2" />
                  Download Results CSV
                </Button>
              )}
              <Link href="/workers">
                <Button data-testid="link-view-workers">
                  <Users className="h-4 w-4 mr-2" />
                  View Workers
                </Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold">{processResults.totalRows.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-green-600">{processResults.createdCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Created</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-blue-600">{processResults.updatedCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Updated</div>
              </CardContent>
            </Card>
            {hasTerminations && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-orange-600">{(processResults.terminatedCount ?? 0).toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">Terminated</div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-red-600">{processResults.failureCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Configuration Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">As-Of Date:</span>
                  <span className="font-medium">{asOfDate ? format(new Date(asOfDate), 'MMMM d, yyyy') : 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Terminate by Absence:</span>
                  <Badge variant={terminateByAbsence ? "default" : "secondary"}>
                    {terminateByAbsence ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Processing Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Success Rate:</span>
                  <span className="font-medium">
                    {processResults.totalRows > 0 
                      ? Math.round((processResults.successCount / processResults.totalRows) * 100) 
                      : 0}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Processed:</span>
                  <span className="font-medium">{processResults.successCount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {hasErrors && processResults.errors && processResults.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  Processing Errors ({processResults.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead>Error Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processResults.errors.map((error, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{error.rowIndex + 1}</TableCell>
                          <TableCell className="text-muted-foreground">{error.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
