import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, XCircle, FileDown, Globe, SkipForward, UserX } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  processed: number;
  total: number;
  created: number;
  linked: number;
  skipped: number;
  errors: Array<{ nid: string; bpsId: string; error: string }>;
  processedRows: Array<{
    nid: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    action: string;
    esigId?: string;
    cardcheckId?: string;
  }>;
}

export function ResultsStep({ wizardId, wizardType, data, onDataChange }: ResultsStepProps) {
  const processResults: ProcessResults | null = data?.processResults || null;
  const previewData = data?.previewData;

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

  const exportResults = () => {
    if (!processResults) return;
    const lines = ['BPS ID,NID,Worker Name,Action,Worker ID'];
    for (const r of processResults.processedRows) {
      lines.push(`"${r.bpsId}","${r.nid}","${r.workerName}","${r.action}","${r.workerId}"`);
    }
    for (const e of processResults.errors) {
      lines.push(`"${e.bpsId}","${e.nid}","","error: ${e.error}",""`);
    }
    if (previewData?.unmatched) {
      for (const u of previewData.unmatched) {
        lines.push(`"${u.bpsId}","${u.nid}","${u.name}","unmatched: ${u.reason}",""`);
      }
    }
    if (previewData?.skipped) {
      for (const s of previewData.skipped) {
        lines.push(`"${s.bpsId}","${s.nid}","${s.workerName}","skipped: ${s.reason}","${s.workerId}"`);
      }
    }
    downloadCsv(lines.join('\n'), `scrape-import-results-${format(new Date(), 'yyyy-MM-dd')}.csv`);
  };

  if (!processResults) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center p-12 space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <p className="text-muted-foreground" data-testid="text-no-results">No processing results available</p>
            <p className="text-sm text-muted-foreground">
              Please complete the processing step first
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const created = processResults.processedRows.filter(r => r.action === 'created');
  const linked = processResults.processedRows.filter(r => r.action === 'linked');
  const skippedEsig = processResults.processedRows.filter(r => r.action === 'skipped_has_esig');
  const hasErrors = processResults.errors.length > 0;

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
                <CardTitle data-testid="text-results-title">Scraper Import Complete</CardTitle>
                <CardDescription>
                  Processed {processResults.total} matched rows
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" onClick={exportResults} data-testid="button-export-all">
              <FileDown className="h-4 w-4 mr-2" />
              Export Results
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold" data-testid="text-final-total">{processResults.total}</div>
              <div className="text-sm text-muted-foreground">Total Processed</div>
            </div>
            <div className="p-4 border rounded-lg text-center border-green-200 dark:border-green-900">
              <div className="text-3xl font-bold text-green-600" data-testid="text-final-created">{created.length}</div>
              <div className="text-sm text-muted-foreground">Card Checks Created</div>
            </div>
            <div className="p-4 border rounded-lg text-center border-blue-200 dark:border-blue-900">
              <div className="text-3xl font-bold text-blue-600" data-testid="text-final-linked">{linked.length}</div>
              <div className="text-sm text-muted-foreground">E-Sigs Linked</div>
            </div>
            <div className="p-4 border rounded-lg text-center border-red-200 dark:border-red-900">
              <div className="text-3xl font-bold text-red-600" data-testid="text-final-errors">{processResults.errors.length}</div>
              <div className="text-sm text-muted-foreground">Errors</div>
            </div>
          </div>

          <Accordion type="multiple" className="space-y-2">
            {created.length > 0 && (
              <AccordionItem value="created" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-created">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-green-600" />
                    <span>Card Checks Created</span>
                    <Badge variant="secondary" className="ml-2">{created.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead>NID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {created.map((row, idx) => (
                          <TableRow key={idx} data-testid={`row-created-${idx}`}>
                            <TableCell className="font-mono text-sm">{row.bpsId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${row.workerId}`} className="text-primary hover:underline">
                                {row.workerName}
                              </Link>
                            </TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{row.nid}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {linked.length > 0 && (
              <AccordionItem value="linked" className="border rounded-lg border-blue-200 dark:border-blue-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-linked">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-blue-600" />
                    <span>E-Sigs Linked to Existing Card Checks</span>
                    <Badge variant="secondary" className="ml-2">{linked.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead>NID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linked.map((row, idx) => (
                          <TableRow key={idx} data-testid={`row-linked-${idx}`}>
                            <TableCell className="font-mono text-sm">{row.bpsId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${row.workerId}`} className="text-primary hover:underline">
                                {row.workerName}
                              </Link>
                            </TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{row.nid}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {skippedEsig.length > 0 && (
              <AccordionItem value="skipped" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-skipped">
                  <div className="flex items-center gap-2">
                    <SkipForward className="h-4 w-4 text-amber-600" />
                    <span>Skipped (Already Has E-Sig)</span>
                    <Badge variant="secondary" className="ml-2">{skippedEsig.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead>NID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {skippedEsig.map((row, idx) => (
                          <TableRow key={idx} data-testid={`row-skipped-${idx}`}>
                            <TableCell className="font-mono text-sm">{row.bpsId}</TableCell>
                            <TableCell>{row.workerName}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{row.nid}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {previewData?.unmatched?.length > 0 && (
              <AccordionItem value="unmatched" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-unmatched">
                  <div className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-muted-foreground" />
                    <span>Unmatched Workers</span>
                    <Badge variant="secondary" className="ml-2">{previewData.unmatched.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.unmatched.map((u: any, idx: number) => (
                          <TableRow key={idx} data-testid={`row-unmatched-result-${idx}`}>
                            <TableCell className="font-mono text-sm">{u.bpsId}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{u.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{u.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {processResults.errors.length > 0 && (
              <AccordionItem value="errors" className="border rounded-lg border-red-200 dark:border-red-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-errors">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>Errors</span>
                    <Badge variant="destructive" className="ml-2">{processResults.errors.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>NID</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processResults.errors.map((error, idx) => (
                          <TableRow key={idx} data-testid={`row-error-${idx}`}>
                            <TableCell className="font-mono text-sm">{error.bpsId}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{error.nid}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{error.error}</TableCell>
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
