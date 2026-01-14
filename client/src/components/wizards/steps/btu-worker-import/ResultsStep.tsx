import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, Download, Users, AlertTriangle, XCircle, Building, UserMinus, UserPlus, UserCheck } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ImportedWorkerInfo {
  workerId: string;
  bpsEmployeeId: string;
  workerName: string;
  isNew: boolean;
}

interface TerminatedWorkerInfo {
  workerId: string;
  bpsEmployeeId: string;
  workerName: string;
  employerId: string;
  employerName: string;
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
  withEmployerMatch?: {
    created: ImportedWorkerInfo[];
    updated: ImportedWorkerInfo[];
  };
  withoutEmployerMatch?: {
    created: ImportedWorkerInfo[];
    updated: ImportedWorkerInfo[];
  };
  terminatedByAbsence?: TerminatedWorkerInfo[];
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
  const withMatch = processResults.withEmployerMatch || { created: [], updated: [] };
  const withoutMatch = processResults.withoutEmployerMatch || { created: [], updated: [] };
  const terminatedWorkers = processResults.terminatedByAbsence || [];
  
  const withMatchTotal = withMatch.created.length + withMatch.updated.length;
  const withoutMatchTotal = withoutMatch.created.length + withoutMatch.updated.length;
  const terminatedTotal = terminatedWorkers.length;

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold">{processResults.totalRows.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </CardContent>
            </Card>
            <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900">
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-green-600">{withMatchTotal.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">With Employer</div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900">
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-amber-600">{withoutMatchTotal.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">No Employer</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-red-600">{processResults.failureCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple" className="space-y-2">
            {withMatchTotal > 0 && (
              <AccordionItem value="with-employer" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-with-employer">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-green-600" />
                    <span>Workers with Employer Match</span>
                    <Badge variant="secondary" className="ml-2">
                      {withMatchTotal}
                    </Badge>
                    <Badge variant="outline" className="ml-1">
                      <UserPlus className="h-3 w-3 mr-1" />
                      {withMatch.created.length} new
                    </Badge>
                    <Badge variant="outline">
                      <UserCheck className="h-3 w-3 mr-1" />
                      {withMatch.updated.length} updated
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...withMatch.created, ...withMatch.updated].map((worker, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{worker.bpsEmployeeId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${worker.workerId}`} className="text-primary hover:underline">
                                {worker.workerName}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {worker.isNew ? (
                                <Badge variant="default" className="bg-green-600">New</Badge>
                              ) : (
                                <Badge variant="secondary">Updated</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {withoutMatchTotal > 0 && (
              <AccordionItem value="without-employer" className="border rounded-lg border-amber-200 dark:border-amber-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-without-employer">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span>Workers without Employer Match</span>
                    <Badge variant="secondary" className="ml-2 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                      {withoutMatchTotal}
                    </Badge>
                    <Badge variant="outline" className="ml-1">
                      <UserPlus className="h-3 w-3 mr-1" />
                      {withoutMatch.created.length} new
                    </Badge>
                    <Badge variant="outline">
                      <UserCheck className="h-3 w-3 mr-1" />
                      {withoutMatch.updated.length} updated
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/30 rounded-md border border-amber-200 dark:border-amber-900">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      These workers were imported but no employer mapping was found for their department/location/job code combination. 
                      They need employer assignments added manually or via the Employer Mapping tool.
                    </p>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-24">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...withoutMatch.created, ...withoutMatch.updated].map((worker, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{worker.bpsEmployeeId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${worker.workerId}`} className="text-primary hover:underline">
                                {worker.workerName}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {worker.isNew ? (
                                <Badge variant="default" className="bg-green-600">New</Badge>
                              ) : (
                                <Badge variant="secondary">Updated</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {terminatedTotal > 0 && (
              <AccordionItem value="terminated" className="border rounded-lg border-orange-200 dark:border-orange-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-terminated">
                  <div className="flex items-center gap-2">
                    <UserMinus className="h-4 w-4 text-orange-600" />
                    <span>Workers Terminated by Absence</span>
                    <Badge variant="secondary" className="ml-2 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                      {terminatedTotal}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="mb-3 p-3 bg-orange-50 dark:bg-orange-950/30 rounded-md border border-orange-200 dark:border-orange-900">
                    <p className="text-sm text-orange-800 dark:text-orange-200">
                      These workers had active employment records at the processed employers but were not present in the import file.
                      Their employment status has been set to terminated as of {asOfDate ? format(new Date(asOfDate), 'MMMM d, yyyy') : 'the as-of date'}.
                    </p>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Employer</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {terminatedWorkers.map((worker, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{worker.bpsEmployeeId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${worker.workerId}`} className="text-primary hover:underline">
                                {worker.workerName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{worker.employerName}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {hasErrors && processResults.errors && processResults.errors.length > 0 && (
              <AccordionItem value="errors" className="border rounded-lg border-red-200 dark:border-red-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-errors">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>Processing Errors</span>
                    <Badge variant="destructive" className="ml-2">
                      {processResults.errors.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
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
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>

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
                  <span className="text-muted-foreground">Created:</span>
                  <span className="font-medium">{processResults.createdCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Updated:</span>
                  <span className="font-medium">{processResults.updatedCount.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
