import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, XCircle, FileDown, Globe } from "lucide-react";
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
  skipped: number;
  errors: Array<{ cardcheckId: string; externalId: string; error: string }>;
  processedRows: Array<{
    cardcheckId: string;
    externalId: string;
    workerId: string;
    action: string;
    esigId?: string;
  }>;
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

  const exportResults = () => {
    if (!processResults) return;
    const lines = ['Card Check ID,Source NID,Worker ID,Action,E-Sig ID'];
    for (const r of processResults.processedRows) {
      lines.push(`"${r.cardcheckId}","${r.externalId}","${r.workerId}","${r.action}","${r.esigId || ''}"`);
    }
    for (const e of processResults.errors) {
      lines.push(`"${e.cardcheckId}","${e.externalId}","","error: ${e.error}",""`);
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

  const linked = processResults.processedRows.filter(r => r.action === 'linked');
  const skipped = processResults.processedRows.filter(r => r.action === 'skipped');
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
                  Processed {processResults.total} card checks
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
              <div className="text-sm text-muted-foreground">Total</div>
            </div>
            <div className="p-4 border rounded-lg text-center border-green-200 dark:border-green-900">
              <div className="text-3xl font-bold text-green-600" data-testid="text-final-linked">{linked.length}</div>
              <div className="text-sm text-muted-foreground">PDFs Fetched & Linked</div>
            </div>
            <div className="p-4 border rounded-lg text-center">
              <div className="text-3xl font-bold text-amber-600" data-testid="text-final-skipped">{skipped.length}</div>
              <div className="text-sm text-muted-foreground">Skipped</div>
            </div>
            <div className="p-4 border rounded-lg text-center border-red-200 dark:border-red-900">
              <div className="text-3xl font-bold text-red-600" data-testid="text-final-errors">{processResults.errors.length}</div>
              <div className="text-sm text-muted-foreground">Errors</div>
            </div>
          </div>

          <Accordion type="multiple" className="space-y-2">
            {linked.length > 0 && (
              <AccordionItem value="linked" className="border rounded-lg border-green-200 dark:border-green-900">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-linked">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-green-600" />
                    <span>PDFs Fetched & Linked</span>
                    <Badge variant="secondary" className="ml-2">{linked.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Card Check ID</TableHead>
                          <TableHead>Source NID</TableHead>
                          <TableHead>Worker</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {linked.map((row, idx) => (
                          <TableRow key={idx} data-testid={`row-linked-${idx}`}>
                            <TableCell className="font-mono text-sm">{row.cardcheckId}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{row.externalId}</TableCell>
                            <TableCell>
                              <Link href={`/workers/${row.workerId}`} className="text-primary hover:underline">
                                {row.workerId}
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            )}

            {skipped.length > 0 && (
              <AccordionItem value="skipped" className="border rounded-lg">
                <AccordionTrigger className="px-4 hover:no-underline" data-testid="accordion-skipped">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span>Skipped</span>
                    <Badge variant="secondary" className="ml-2">{skipped.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Card Check ID</TableHead>
                          <TableHead>Source NID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {skipped.map((row, idx) => (
                          <TableRow key={idx} data-testid={`row-skipped-${idx}`}>
                            <TableCell className="font-mono text-sm">{row.cardcheckId}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{row.externalId}</TableCell>
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
                          <TableHead>Card Check ID</TableHead>
                          <TableHead>Source NID</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processResults.errors.map((error, idx) => (
                          <TableRow key={idx} data-testid={`row-error-${idx}`}>
                            <TableCell className="font-mono text-sm">{error.cardcheckId}</TableCell>
                            <TableCell className="font-mono text-sm text-muted-foreground">{error.externalId}</TableCell>
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
