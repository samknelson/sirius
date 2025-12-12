import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, FileText, Download, AlertCircle, FileSpreadsheet, Gift, DollarSign } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ReviewStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface BenefitSummary {
  benefitId: string;
  benefitName: string;
  count: number;
}

interface ChargesSummary {
  count: number;
  totalAmount: string;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: any[];
  resultsFileId?: string;
  completedAt?: string;
  benefitsSummary?: BenefitSummary[];
  chargesSummary?: ChargesSummary;
}

interface File {
  id: string;
  fileName: string;
  mimeType?: string;
  size: number;
  uploadedAt: string;
  metadata?: any;
}

export function ReviewStep({ wizardId, wizardType, data, onDataChange }: ReviewStepProps) {
  // Fetch all files associated with the wizard
  const { data: files, isLoading: filesLoading, error: filesError } = useQuery<File[]>({
    queryKey: ["/api/wizards", wizardId, "files"],
  });

  // Get processing results from the data prop (passed from wizard-view)
  const processResults: ProcessResults | null = data?.processResults || null;
  
  // Derive status from processing results
  const wizardStatus = processResults 
    ? (processResults.failureCount > 0 ? 'needs_review' : 'complete')
    : null;

  // Helper function to format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Helper function to get file icon based on mime type
  const getFileIcon = (mimeType?: string) => {
    if (!mimeType) return FileText;
    if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) {
      return FileSpreadsheet;
    }
    return FileText;
  };

  // Handle files error - show warning but continue with results
  const hasFilesError = !!filesError;
  
  if (filesLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-96" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Processing Results Summary */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Processing Results</CardTitle>
              <CardDescription>
                Summary of the data processing operation
              </CardDescription>
            </div>
            {wizardStatus && (
              <Badge 
                variant={wizardStatus === 'complete' ? 'default' : 'secondary'}
                data-testid="badge-wizard-status"
              >
                {wizardStatus === 'complete' ? 'Complete' : wizardStatus === 'needs_review' ? 'Needs Review' : wizardStatus}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {processResults ? (
            <div className="space-y-6">
              {/* Statistics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-2xl font-bold" data-testid="text-review-total-rows">
                        {processResults.totalRows.toLocaleString()}
                      </p>
                      <p className="text-sm text-muted-foreground">Total Rows</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <p className="text-2xl font-bold text-green-600" data-testid="text-review-created">
                          {(processResults.createdCount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Created</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle2 className="h-5 w-5 text-blue-600" />
                        <p className="text-2xl font-bold text-blue-600" data-testid="text-review-updated">
                          {(processResults.updatedCount ?? 0).toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Updated</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <XCircle className="h-5 w-5 text-red-600" />
                        <p className="text-2xl font-bold text-red-600" data-testid="text-review-failed">
                          {processResults.failureCount.toLocaleString()}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">Failed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Benefits & Charges Summary */}
              {(processResults.benefitsSummary || processResults.chargesSummary) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Benefits Summary */}
                  {processResults.benefitsSummary && processResults.benefitsSummary.length > 0 && (
                    <Card className="border-purple-200 bg-purple-50/50">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <Gift className="h-5 w-5 text-purple-600 mt-0.5" />
                          <div>
                            <p className="font-medium text-purple-900">Benefits Created</p>
                            <div className="mt-2 space-y-1">
                              {processResults.benefitsSummary.map((benefit) => (
                                <p key={benefit.benefitId} className="text-sm text-purple-700" data-testid={`text-benefit-summary-${benefit.benefitId}`}>
                                  {benefit.count} {benefit.count === 1 ? 'benefit' : 'benefits'} of type "{benefit.benefitName}"
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Charges Summary */}
                  {processResults.chargesSummary && (
                    <Card className="border-emerald-200 bg-emerald-50/50">
                      <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                          <DollarSign className="h-5 w-5 text-emerald-600 mt-0.5" />
                          <div>
                            <p className="font-medium text-emerald-900">Charges Generated</p>
                            <p className="text-sm text-emerald-700 mt-2" data-testid="text-charges-summary">
                              {processResults.chargesSummary.count} {processResults.chargesSummary.count === 1 ? 'charge' : 'charges'} for a total of ${processResults.chargesSummary.totalAmount}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}

              {/* Completion Info */}
              {processResults.completedAt && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>
                    Completed {formatDistanceToNow(new Date(processResults.completedAt), { addSuffix: true })}
                  </span>
                </div>
              )}

              {/* Results File Download */}
              {processResults.resultsFileId && (
                <Alert>
                  <FileSpreadsheet className="h-4 w-4" />
                  <AlertTitle>Results Spreadsheet Available</AlertTitle>
                  <AlertDescription className="flex items-center justify-between">
                    <span>Download the detailed results spreadsheet with status and message for each row.</span>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      data-testid="button-review-download-results"
                    >
                      <a href={`/api/files/${processResults.resultsFileId}/download`} download>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </a>
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Errors Summary */}
              {processResults.failureCount > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Processing Errors</AlertTitle>
                  <AlertDescription>
                    {processResults.failureCount} {processResults.failureCount === 1 ? 'row' : 'rows'} failed to process.
                    {processResults.resultsFileId && ' Download the results spreadsheet for detailed error messages.'}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No Processing Results</AlertTitle>
              <AlertDescription>
                This wizard has not been processed yet. Complete the previous steps to process the data.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Attached Files */}
      <Card>
        <CardHeader>
          <CardTitle>Attached Files</CardTitle>
          <CardDescription>
            All files associated with this wizard
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasFilesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Failed to Load Files</AlertTitle>
              <AlertDescription>
                Unable to load attached files. Please try refreshing the page.
                <br />
                <span className="text-xs mt-2 block">Error: {filesError instanceof Error ? filesError.message : 'Unknown error'}</span>
              </AlertDescription>
            </Alert>
          ) : files && files.length > 0 ? (
            <div className="space-y-3">
              {files.map((file) => {
                const FileIcon = getFileIcon(file.mimeType);
                const isResultsFile = file.id === processResults?.resultsFileId;
                
                return (
                  <div 
                    key={file.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`file-item-${file.id}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium truncate" data-testid="text-file-name">
                            {file.fileName}
                          </p>
                          {isResultsFile && (
                            <Badge variant="secondary" className="flex-shrink-0">
                              Results
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span data-testid="text-file-size">{formatFileSize(file.size)}</span>
                          <span>•</span>
                          <span data-testid="text-file-uploaded">
                            {formatDistanceToNow(new Date(file.uploadedAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      asChild
                      data-testid={`button-download-${file.id}`}
                    >
                      <a href={`/api/files/${file.id}/download`} download>
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
              <div className="text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No files attached to this wizard</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
