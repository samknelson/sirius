import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, AlertCircle, Eye } from "lucide-react";
import { format } from "date-fns";

interface ResultsStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
}

interface ReportData {
  totalRecords: number;
  recordCount: number;
  records: any[];
  generatedAt: string;
  columns: Array<{ id: string; header: string; type: string }>;
}

export function ResultsStep({ wizardId, wizardType, data }: ResultsStepProps) {
  const { data: reportData, isLoading, error} = useQuery<ReportData>({
    queryKey: [`/api/wizards/${wizardId}/report-data`],
  });

  const handleExport = () => {
    if (!reportData) return;

    const { columns, records } = reportData;
    
    // For duplicate SSN report, export ungrouped data with all columns
    // Filter out action columns like 'viewLink' from CSV export
    const exportColumns = columns.filter(col => col.id !== 'viewLink');
    const exportRecords = records;
    
    // Convert to CSV
    const headers = exportColumns.map(col => col.header).join(',');
    const rows = exportRecords.map(record => 
      exportColumns.map(col => {
        const value = record[col.id];
        // Escape commas and quotes in CSV
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    );
    
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${wizardType}_${format(new Date(), 'yyyy-MM-dd_HHmmss')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const wizardDisplayName = wizardType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Results</CardTitle>
          <CardDescription>Loading report data...</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Results</CardTitle>
          <CardDescription>Error loading report data</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {error instanceof Error ? error.message : "Failed to load report data"}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!reportData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report Results</CardTitle>
          <CardDescription>No report data found</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertDescription>
              No report has been generated yet. Please go back to the Run step and generate the report.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { columns, records, recordCount, generatedAt } = reportData;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Report Results</CardTitle>
            <CardDescription>
              {wizardDisplayName} - Generated {format(new Date(generatedAt), 'PPp')}
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExport}
            data-testid="button-export-report"
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" data-testid="badge-record-count">
            {recordCount} {recordCount === 1 ? 'record' : 'records'}
          </Badge>
        </div>

        {recordCount === 0 ? (
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertDescription>
              No records found matching the report criteria.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted">
                  <TableRow>
                    {columns.map((col: any) => (
                      <TableHead key={col.id} className="font-semibold">
                        {col.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((record: any, idx: number) => (
                    <TableRow key={idx} data-testid={`row-record-${idx}`}>
                      {columns.map((col: any) => (
                        <TableCell key={col.id}>
                          {col.id === 'viewLink' && record.employerContactId ? (
                            <Link 
                              href={`/employer-contacts/${record.employerContactId}`}
                              className="inline-flex items-center text-primary hover:text-primary/80"
                              data-testid={`link-view-${record.employerContactId}`}
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                          ) : col.id === 'workers' && record.workerDetails ? (
                            <div className="space-y-1">
                              {record.workerDetails.map((worker: any) => (
                                <div key={worker.workerId}>
                                  <Link 
                                    href={`/workers/${worker.workerId}`} 
                                    className="text-sm font-medium text-primary hover:underline" 
                                    data-testid={`link-worker-${worker.workerId}`}
                                  >
                                    {worker.displayName} (ID: {worker.siriusId})
                                  </Link>
                                </div>
                              ))}
                            </div>
                          ) : col.type === 'date' && record[col.id] ? (
                            format(new Date(record[col.id]), 'PP')
                          ) : col.type === 'boolean' ? (
                            record[col.id] ? 'Yes' : 'No'
                          ) : (
                            record[col.id] || '-'
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
