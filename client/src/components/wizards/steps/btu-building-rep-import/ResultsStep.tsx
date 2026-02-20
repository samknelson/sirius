import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, XCircle, FileDown, Users } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface ProcessResults {
  total: number;
  processed: number;
  created: number;
  skipped: number;
  alreadyAssigned: number;
  errors: Array<{ name: string; badgeId: string; error: string }>;
  createdAssignments: Array<{
    name: string;
    badgeId: string;
    workerId: string;
    employerName: string;
    bargainingUnitName: string;
    assignmentId: string;
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
    const lines = ['Name,Badge ID,Worker ID,Employer,Bargaining Unit,Status'];
    for (const a of processResults.createdAssignments) {
      lines.push(`"${a.name}","${a.badgeId}","${a.workerId}","${a.employerName}","${a.bargainingUnitName}","Created"`);
    }
    for (const e of processResults.errors) {
      lines.push(`"${e.name}","${e.badgeId}","","","","Error: ${e.error}"`);
    }
    downloadCsv(lines.join('\n'), `building-rep-import-results-${format(new Date(), 'yyyy-MM-dd')}.csv`);
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold" data-testid="text-result-total">{processResults.total}</div>
            <p className="text-xs text-muted-foreground">Total Rows</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600" data-testid="text-result-created">{processResults.created}</div>
            <p className="text-xs text-muted-foreground">Created</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600" data-testid="text-result-skipped">{processResults.alreadyAssigned + processResults.skipped}</div>
            <p className="text-xs text-muted-foreground">Skipped</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600" data-testid="text-result-errors">{processResults.errors.length}</div>
            <p className="text-xs text-muted-foreground">Errors</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={exportResults} data-testid="button-export-results">
          <FileDown className="h-4 w-4 mr-2" />
          Export Results CSV
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={["created"]}>
        {processResults.createdAssignments.length > 0 && (
          <AccordionItem value="created">
            <AccordionTrigger data-testid="accordion-created">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Created Assignments ({processResults.createdAssignments.length})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Badge ID</TableHead>
                      <TableHead>Employer</TableHead>
                      <TableHead>Bargaining Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processResults.createdAssignments.map((a, idx) => (
                      <TableRow key={idx} data-testid={`row-result-created-${idx}`}>
                        <TableCell>
                          <Link href={`/workers/${a.workerId}`} className="text-primary hover:underline">
                            {a.name}
                          </Link>
                        </TableCell>
                        <TableCell>{a.badgeId}</TableCell>
                        <TableCell>{a.employerName}</TableCell>
                        <TableCell>{a.bargainingUnitName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}

        {processResults.errors.length > 0 && (
          <AccordionItem value="errors">
            <AccordionTrigger data-testid="accordion-errors">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                Errors & Unmatched ({processResults.errors.length})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Badge ID</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processResults.errors.map((e, idx) => (
                      <TableRow key={idx} data-testid={`row-result-error-${idx}`}>
                        <TableCell>{e.name}</TableCell>
                        <TableCell>{e.badgeId || '-'}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{e.error}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>
    </div>
  );
}
