import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle, Download, DollarSign, FileCheck, FileWarning, FileX, FileMinus } from "lucide-react";
import { format } from "date-fns";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessError {
  rowIndex: number;
  message: string;
  data?: Record<string, any>;
}

interface ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  errors: ProcessError[];
  resultsFileId?: string;
  completedAt?: string;
}

interface CardCheckComparisonEntry {
  workerId: string;
  workerSiriusId: number;
  workerName: string;
  bargainingUnitName: string | null;
  employerNames: string[];
  allocatedAmount?: number;
  cardCheckRate?: number | null;
}

interface WorkerNotFoundEntry {
  rowIndex: number;
  bpsEmployeeId: string;
  workerNameFromFile: string | null;
  amount: number;
  date: string;
  deductionCode: string | null;
}

interface CardCheckComparisonReport {
  matchingRate: CardCheckComparisonEntry[];
  mismatchingRate: CardCheckComparisonEntry[];
  noCardCheck: CardCheckComparisonEntry[];
  cardCheckNoAllocation: CardCheckComparisonEntry[];
  workerNotFound: WorkerNotFoundEntry[];
}

function ComparisonTable({ entries, showAmount = true, showCardRate = true }: { 
  entries: CardCheckComparisonEntry[]; 
  showAmount?: boolean;
  showCardRate?: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No workers in this category</p>;
  }
  
  return (
    <ScrollArea className="h-80">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Worker Name</TableHead>
            <TableHead>Worker ID</TableHead>
            <TableHead>Bargaining Unit</TableHead>
            <TableHead>Employers</TableHead>
            {showAmount && <TableHead className="text-right">Allocated</TableHead>}
            {showCardRate && <TableHead className="text-right">Card Rate</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry, idx) => (
            <TableRow key={entry.workerId + '-' + idx} data-testid={`row-comparison-${entry.workerId}`}>
              <TableCell data-testid={`text-worker-name-${entry.workerId}`}>{entry.workerName}</TableCell>
              <TableCell data-testid={`text-worker-id-${entry.workerId}`}>{entry.workerSiriusId}</TableCell>
              <TableCell data-testid={`text-bu-${entry.workerId}`}>{entry.bargainingUnitName || '—'}</TableCell>
              <TableCell data-testid={`text-employers-${entry.workerId}`}>
                {entry.employerNames.length > 0 ? entry.employerNames.join(', ') : '—'}
              </TableCell>
              {showAmount && (
                <TableCell className="text-right" data-testid={`text-amount-${entry.workerId}`}>
                  {entry.allocatedAmount != null ? `$${entry.allocatedAmount.toFixed(2)}` : '—'}
                </TableCell>
              )}
              {showCardRate && (
                <TableCell className="text-right" data-testid={`text-card-rate-${entry.workerId}`}>
                  {entry.cardCheckRate != null ? `$${entry.cardCheckRate.toFixed(2)}` : '—'}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

function WorkerNotFoundTable({ entries }: { entries: WorkerNotFoundEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No workers in this category</p>;
  }
  
  return (
    <ScrollArea className="h-80">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead>
            <TableHead>Employee ID</TableHead>
            <TableHead>Name (from file)</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Deduction Code</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`notfound-${entry.rowIndex}`} data-testid={`row-not-found-${entry.rowIndex}`}>
              <TableCell data-testid={`text-row-${entry.rowIndex}`}>{entry.rowIndex + 1}</TableCell>
              <TableCell data-testid={`text-empid-${entry.rowIndex}`}>{entry.bpsEmployeeId}</TableCell>
              <TableCell data-testid={`text-name-${entry.rowIndex}`}>{entry.workerNameFromFile || '—'}</TableCell>
              <TableCell className="text-right" data-testid={`text-amount-${entry.rowIndex}`}>
                ${entry.amount.toFixed(2)}
              </TableCell>
              <TableCell data-testid={`text-date-${entry.rowIndex}`}>{entry.date || '—'}</TableCell>
              <TableCell data-testid={`text-code-${entry.rowIndex}`}>{entry.deductionCode || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}

export function ResultsStep({ wizardId, wizardType, data, onDataChange }: ResultsStepProps) {
  const results: ProcessResults | null = data?.processResults || null;
  const comparisonReport: CardCheckComparisonReport | null = data?.cardCheckComparisonReport || null;

  const { data: accounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const accountId = data?.accountId;
  const selectedAccount = accounts.find((a: any) => a.id === accountId);

  if (!results) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            No results available. Please complete the processing step first.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isSuccess = results.failureCount === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isSuccess ? (
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            ) : (
              <AlertCircle className="h-6 w-6 text-amber-600" />
            )}
            Import Results
          </CardTitle>
          <CardDescription>
            {isSuccess
              ? "All dues allocations were processed successfully"
              : `Completed with ${results.failureCount} error(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold">{results.totalRows.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Total Rows</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-green-600">{results.createdCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Entries Created</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 text-center">
                <div className="text-3xl font-bold text-blue-600">{results.successCount.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Successful</div>
              </CardContent>
            </Card>
            {results.failureCount > 0 && (
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="text-3xl font-bold text-red-600">{results.failureCount.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">Errors</div>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Import Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {selectedAccount && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ledger Account:</span>
                  <span className="font-medium">{selectedAccount.name}</span>
                </div>
              )}
              {results.completedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed:</span>
                  <span className="font-medium">{format(new Date(results.completedAt), 'PPpp')}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {results.errors && results.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Processing Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="space-y-2">
                    {results.errors.map((error, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm p-2 rounded bg-red-50 dark:bg-red-950/20">
                        <XCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-medium">Row {error.rowIndex + 1}:</span>{' '}
                          <span className="text-muted-foreground">{error.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {comparisonReport && (
        <Card data-testid="card-check-comparison-report">
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Card Check Comparison Report
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  window.open(`/api/wizards/${wizardId}/export-comparison-report`, '_blank');
                }}
                data-testid="button-export-comparison-report"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Report
              </Button>
            </div>
            <CardDescription>
              Compare dues allocations with signed card checks on file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{comparisonReport.matchingRate.length}</div>
                  <div className="text-xs text-muted-foreground">Matching Rate</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-amber-600">{comparisonReport.mismatchingRate.length}</div>
                  <div className="text-xs text-muted-foreground">Mismatched Rate</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-red-600">{comparisonReport.noCardCheck.length}</div>
                  <div className="text-xs text-muted-foreground">No Card Check</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{comparisonReport.cardCheckNoAllocation.length}</div>
                  <div className="text-xs text-muted-foreground">Card, No Allocation</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">{comparisonReport.workerNotFound?.length || 0}</div>
                  <div className="text-xs text-muted-foreground">Worker Not Found</div>
                </CardContent>
              </Card>
            </div>

            <Tabs defaultValue="matching" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="matching" className="flex items-center gap-1" data-testid="tab-matching">
                  <FileCheck className="h-3 w-3" />
                  <span className="hidden sm:inline">Matching</span>
                  <Badge variant="secondary" className="ml-1">{comparisonReport.matchingRate.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="mismatched" className="flex items-center gap-1" data-testid="tab-mismatched">
                  <FileWarning className="h-3 w-3" />
                  <span className="hidden sm:inline">Mismatched</span>
                  <Badge variant="secondary" className="ml-1">{comparisonReport.mismatchingRate.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="no-card" className="flex items-center gap-1" data-testid="tab-no-card">
                  <FileX className="h-3 w-3" />
                  <span className="hidden sm:inline">No Card</span>
                  <Badge variant="secondary" className="ml-1">{comparisonReport.noCardCheck.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="card-no-alloc" className="flex items-center gap-1" data-testid="tab-card-no-alloc">
                  <FileMinus className="h-3 w-3" />
                  <span className="hidden sm:inline">Card Only</span>
                  <Badge variant="secondary" className="ml-1">{comparisonReport.cardCheckNoAllocation.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="not-found" className="flex items-center gap-1" data-testid="tab-not-found">
                  <AlertCircle className="h-3 w-3" />
                  <span className="hidden sm:inline">Not Found</span>
                  <Badge variant="secondary" className="ml-1">{comparisonReport.workerNotFound?.length || 0}</Badge>
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="matching" data-testid="panel-matching">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Allocated with Matching Card Check Rate</CardTitle>
                    <CardDescription>Workers who had dues allocated and have a signed card check with matching rate</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ComparisonTable entries={comparisonReport.matchingRate} />
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="mismatched" data-testid="panel-mismatched">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Allocated with Mismatched Card Check Rate</CardTitle>
                    <CardDescription>Workers who had dues allocated but their card check rate doesn't match</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ComparisonTable entries={comparisonReport.mismatchingRate} />
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="no-card" data-testid="panel-no-card">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Allocated with No Card Check on File</CardTitle>
                    <CardDescription>Workers who had dues allocated but have no signed card check on file</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ComparisonTable entries={comparisonReport.noCardCheck} showCardRate={false} />
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="card-no-alloc" data-testid="panel-card-no-alloc">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Signed Card Check but No Allocation in Feed</CardTitle>
                    <CardDescription>Workers with signed card checks who were not in this import file</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ComparisonTable entries={comparisonReport.cardCheckNoAllocation} showAmount={false} />
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="not-found" data-testid="panel-not-found">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Worker Not Found in System</CardTitle>
                    <CardDescription>File rows with Employee IDs that don't match any worker in the system</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <WorkerNotFoundTable entries={comparisonReport.workerNotFound || []} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
