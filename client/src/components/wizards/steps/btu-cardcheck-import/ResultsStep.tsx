import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, XCircle, FileDown, FileCheck, UserX } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { stringify } from "csv-stringify/browser/esm/sync";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface CardcheckWorkerInfo {
  workerId: string;
  bpsEmployeeId: string;
  workerName: string;
  signedDate: string;
  bargainingUnitName?: string;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: Array<{ rowIndex: number; message: string; data?: Record<string, any> }>;
  completedAt?: string;
  cardchecksCreated?: CardcheckWorkerInfo[];
  skippedDuplicate?: CardcheckWorkerInfo[];
  notFoundBpsIds?: Array<{ bpsEmployeeId: string; rowIndex: number }>;
}

export function ResultsStep({ wizardId, wizardType, data, onDataChange }: ResultsStepProps) {
  const processResults: ProcessResults | null = data?.processResults || null;

  const downloadCsv = (csv: string, filename: string) => {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const exportCreated = () => {
    if (!processResults?.cardchecksCreated) return;
    const csvData = processResults.cardchecksCreated.map(w => ({
      "BPS Employee ID": w.bpsEmployeeId,
      "Worker Name": w.workerName,
      "Signed Date": w.signedDate,
      "Bargaining Unit": w.bargainingUnitName || '',
      "Worker ID": w.workerId,
    }));
    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `cardchecks-created-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const exportDuplicates = () => {
    if (!processResults?.skippedDuplicate) return;
    const csvData = processResults.skippedDuplicate.map(w => ({
      "BPS Employee ID": w.bpsEmployeeId,
      "Worker Name": w.workerName,
      "Signed Date": w.signedDate,
      "Bargaining Unit": w.bargainingUnitName || '',
      "Worker ID": w.workerId,
    }));
    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `cardchecks-duplicates-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const exportNotFound = () => {
    if (!processResults?.notFoundBpsIds) return;
    const csvData = processResults.notFoundBpsIds.map(nf => ({
      "BPS Employee ID": nf.bpsEmployeeId,
      "Row Number": nf.rowIndex + 1,
    }));
    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `cardchecks-not-found-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const exportErrors = () => {
    if (!processResults?.errors) return;
    const csvData = processResults.errors.map(e => ({
      "Row": e.rowIndex + 1,
      "Error Message": e.message,
      "Data": e.data ? JSON.stringify(e.data) : '',
    }));
    const csv = stringify(csvData, { header: true });
    downloadCsv(csv, `cardcheck-import-errors-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  const exportAll = () => {
    if (!processResults) return;
    const allData: Array<Record<string, string>> = [];

    processResults.cardchecksCreated?.forEach(w => {
      allData.push({
        "Category": "Created",
        "BPS Employee ID": w.bpsEmployeeId,
        "Worker Name": w.workerName,
        "Signed Date": w.signedDate,
        "Bargaining Unit": w.bargainingUnitName || '',
        "Status": "Success",
      });
    });

    processResults.skippedDuplicate?.forEach(w => {
      allData.push({
        "Category": "Duplicate (Skipped)",
        "BPS Employee ID": w.bpsEmployeeId,
        "Worker Name": w.workerName,
        "Signed Date": w.signedDate,
        "Bargaining Unit": w.bargainingUnitName || '',
        "Status": "Skipped",
      });
    });

    processResults.notFoundBpsIds?.forEach(nf => {
      allData.push({
        "Category": "Not Found",
        "BPS Employee ID": nf.bpsEmployeeId,
        "Worker Name": "",
        "Signed Date": "",
        "Bargaining Unit": "",
        "Status": `Row ${nf.rowIndex + 1}`,
      });
    });

    const csv = stringify(allData, { header: true });
    downloadCsv(csv, `cardcheck-import-results-${format(new Date(), 'yyyy-MM-dd')}.csv`);
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

  const created = processResults.cardchecksCreated || [];
  const duplicates = processResults.skippedDuplicate || [];
  const notFound = processResults.notFoundBpsIds || [];
  const hasErrors = processResults.failureCount > 0;

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
            <Button variant="outline" onClick={exportAll} data-testid="button-export-all">
              <FileDown className="h-4 w-4 mr-2" />
              Export All Results
            </Button>
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
                <div className="text-3xl font-bold text-green-600">{created.length.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Created</div>
              </CardContent>
            </Card>
            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900">
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-blue-600">{duplicates.length.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Duplicates Skipped</div>
              </CardContent>
            </Card>
            <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900">
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-red-600">{notFound.length.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Not Found</div>
              </CardContent>
            </Card>
          </div>

          <Accordion type="multiple" className="space-y-2">
            {created.length > 0 && (
              <AccordionItem value="created" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-created">
                  <div className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-green-600" />
                    <span>Card Checks Created</span>
                    <Badge variant="secondary" className="ml-2">{created.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="flex justify-end mb-2">
                    <Button variant="ghost" size="sm" onClick={exportCreated} data-testid="button-export-created">
                      <FileDown className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Signed Date</TableHead>
                          <TableHead>Bargaining Unit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {created.map((worker, idx) => (
                          <TableRow key={`created-${worker.workerId}-${idx}`} data-testid={`row-created-${worker.workerId}`}>
                            <TableCell className="font-mono text-sm">{worker.bpsEmployeeId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${worker.workerId}`} className="text-primary hover:underline">
                                {worker.workerName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-sm">{worker.signedDate}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{worker.bargainingUnitName || '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {duplicates.length > 0 && (
              <AccordionItem value="duplicates" className="border rounded-lg border-blue-200 dark:border-blue-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-duplicates">
                  <div className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-blue-600" />
                    <span>Duplicates Skipped</span>
                    <Badge variant="secondary" className="ml-2">{duplicates.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-md border border-blue-200 dark:border-blue-900">
                      <p className="text-sm text-blue-800 dark:text-blue-200">
                        These workers already had a signed card check of this type and were skipped to prevent duplicates.
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={exportDuplicates} data-testid="button-export-duplicates">
                      <FileDown className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Signed Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {duplicates.map((worker, idx) => (
                          <TableRow key={`dup-${worker.workerId}-${idx}`} data-testid={`row-duplicate-${worker.workerId}`}>
                            <TableCell className="font-mono text-sm">{worker.bpsEmployeeId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${worker.workerId}`} className="text-primary hover:underline">
                                {worker.workerName}
                              </Link>
                            </TableCell>
                            <TableCell className="text-sm">{worker.signedDate}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {notFound.length > 0 && (
              <AccordionItem value="not-found" className="border rounded-lg border-red-200 dark:border-red-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-not-found">
                  <div className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-red-600" />
                    <span>Workers Not Found</span>
                    <Badge variant="destructive" className="ml-2">{notFound.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 p-3 bg-red-50 dark:bg-red-950/30 rounded-md border border-red-200 dark:border-red-900">
                      <p className="text-sm text-red-800 dark:text-red-200">
                        No workers were found in the system matching these BPS Employee IDs. 
                        These workers may need to be imported first using the Worker Import wizard.
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={exportNotFound} data-testid="button-export-not-found">
                      <FileDown className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS Employee ID</TableHead>
                          <TableHead>File Row</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {notFound.map((nf, idx) => (
                          <TableRow key={`nf-${idx}`} data-testid={`row-not-found-${idx}`}>
                            <TableCell className="font-mono text-sm">{nf.bpsEmployeeId}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">Row {nf.rowIndex + 1}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {processResults.errors && processResults.errors.length > 0 && (
              <AccordionItem value="errors" className="border rounded-lg border-red-200 dark:border-red-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-errors">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>Processing Errors</span>
                    <Badge variant="destructive" className="ml-2">{processResults.errors.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="flex justify-end mb-2">
                    <Button variant="ghost" size="sm" onClick={exportErrors} data-testid="button-export-errors">
                      <FileDown className="h-4 w-4 mr-1" />
                      Export
                    </Button>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">Row</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processResults.errors.map((error, idx) => (
                          <TableRow key={`err-${idx}`} data-testid={`row-error-${idx}`}>
                            <TableCell className="font-mono text-sm">{error.rowIndex + 1}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{error.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
