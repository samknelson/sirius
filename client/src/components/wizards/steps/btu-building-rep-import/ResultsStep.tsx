import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, XCircle, FileDown, SkipForward, Info } from "lucide-react";
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
  alreadyAssignedRows: Array<{
    name: string;
    badgeId: string;
    workerId: string;
    employerName: string;
    bargainingUnitName: string;
  }>;
  skippedDuringProcess: Array<{
    name: string;
    badgeId: string;
    workerId: string;
    employerName: string;
    reason: string;
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
    const lines = ['Name,Badge ID,Worker ID,Employer,Bargaining Unit,Status,Reason'];
    for (const a of processResults.createdAssignments) {
      lines.push(`"${a.name}","${a.badgeId}","${a.workerId}","${a.employerName}","${a.bargainingUnitName}","Created",""`);
    }
    for (const a of (processResults.alreadyAssignedRows || [])) {
      lines.push(`"${a.name}","${a.badgeId}","${a.workerId}","${a.employerName}","${a.bargainingUnitName}","Skipped","Already assigned"`);
    }
    for (const s of (processResults.skippedDuringProcess || [])) {
      lines.push(`"${s.name}","${s.badgeId}","${s.workerId}","${s.employerName}","","Skipped","${s.reason}"`);
    }
    for (const e of processResults.errors) {
      lines.push(`"${e.name}","${e.badgeId}","","","","Error","${e.error}"`);
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

  const alreadyAssignedRows = processResults.alreadyAssignedRows || [];
  const skippedDuringProcess = processResults.skippedDuringProcess || [];
  const totalNotCreated = alreadyAssignedRows.length + skippedDuringProcess.length + processResults.errors.length;

  interface ReasonRow {
    name: string;
    badgeId: string;
    workerId?: string;
    employerName?: string;
    bargainingUnitName?: string;
  }
  interface ReasonGroup {
    reason: string;
    count: number;
    rows: ReasonRow[];
    hasDetailColumns: boolean;
  }

  const allReasons: ReasonGroup[] = [];

  if (alreadyAssignedRows.length > 0) {
    allReasons.push({
      reason: 'Already assigned as Building Rep',
      count: alreadyAssignedRows.length,
      hasDetailColumns: true,
      rows: alreadyAssignedRows.map(r => ({
        name: r.name, badgeId: r.badgeId, workerId: r.workerId,
        employerName: r.employerName, bargainingUnitName: r.bargainingUnitName,
      })),
    });
  }

  if (skippedDuringProcess.length > 0) {
    allReasons.push({
      reason: 'Duplicate found during processing',
      count: skippedDuringProcess.length,
      hasDetailColumns: true,
      rows: skippedDuringProcess.map(r => ({
        name: r.name, badgeId: r.badgeId, workerId: r.workerId,
        employerName: r.employerName,
      })),
    });
  }

  const errorsByReason = new Map<string, ReasonRow[]>();
  for (const e of processResults.errors) {
    const reason = e.error || 'Unknown';
    if (!errorsByReason.has(reason)) {
      errorsByReason.set(reason, []);
    }
    errorsByReason.get(reason)!.push({ name: e.name, badgeId: e.badgeId });
  }
  for (const [reason, rows] of Array.from(errorsByReason.entries()).sort((a, b) => b[1].length - a[1].length)) {
    allReasons.push({ reason, count: rows.length, rows, hasDetailColumns: false });
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
            <p className="text-xs text-muted-foreground">Assignments Created</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600" data-testid="text-result-skipped">{totalNotCreated}</div>
            <p className="text-xs text-muted-foreground">Not Imported</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold" data-testid="text-result-reasons">{allReasons.length}</div>
            <p className="text-xs text-muted-foreground">Distinct Reasons</p>
          </CardContent>
        </Card>
      </div>

      {totalNotCreated > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-muted-foreground" />
              Why {totalNotCreated} Records Were Not Imported
            </CardTitle>
            <CardDescription>
              Each record that was skipped has a specific reason listed below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {allReasons.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-1.5 border-b last:border-b-0" data-testid={`reason-row-${idx}`}>
                  <span className="text-sm">{item.reason}</span>
                  <Badge variant="secondary">{item.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

        {allReasons.map((item, idx) => (
          <AccordionItem value={`reason-${idx}`} key={`reason-${idx}`}>
            <AccordionTrigger data-testid={`accordion-reason-${idx}`}>
              <div className="flex items-center gap-2">
                {item.hasDetailColumns
                  ? <SkipForward className="h-4 w-4 text-amber-600" />
                  : <XCircle className="h-4 w-4 text-red-600" />
                }
                {item.reason} ({item.count})
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Badge ID</TableHead>
                      {item.hasDetailColumns && <TableHead>Employer</TableHead>}
                      {item.hasDetailColumns && item.rows.some(r => r.bargainingUnitName) && <TableHead>Bargaining Unit</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.rows.map((r, rIdx) => (
                      <TableRow key={rIdx} data-testid={`row-reason-${idx}-${rIdx}`}>
                        <TableCell>
                          {r.workerId ? (
                            <Link href={`/workers/${r.workerId}`} className="text-primary hover:underline">
                              {r.name}
                            </Link>
                          ) : (
                            r.name
                          )}
                        </TableCell>
                        <TableCell>{r.badgeId || '-'}</TableCell>
                        {item.hasDetailColumns && <TableCell>{r.employerName || '-'}</TableCell>}
                        {item.hasDetailColumns && item.rows.some(row => row.bargainingUnitName) && <TableCell>{r.bargainingUnitName || '-'}</TableCell>}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
