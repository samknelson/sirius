import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, AlertTriangle, XCircle, Users, Info } from "lucide-react";
import { Link } from "wouter";

interface PreviewStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface PreviewRow {
  rowIndex: number;
  name: string;
  badgeId: string;
  phone: string;
  email: string;
  matched: boolean;
  workerId?: string;
  workerName?: string;
  employerId?: string;
  employerName?: string;
  bargainingUnitId?: string;
  bargainingUnitName?: string;
  alreadyAssigned?: boolean;
  error?: string;
}

export function PreviewStep({ wizardId, wizardType, data, onDataChange }: PreviewStepProps) {
  const previewData = data?.previewData;

  if (!previewData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center p-12 space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500" />
            <p className="text-muted-foreground" data-testid="text-no-preview">No preview data available</p>
            <p className="text-sm text-muted-foreground">
              Please upload a CSV file in the Upload step first
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows: PreviewRow[] = previewData.rows || [];
  const toCreate = rows.filter(r => r.matched && !r.error && !r.alreadyAssigned);
  const alreadyAssigned = rows.filter(r => r.matched && !r.error && r.alreadyAssigned);
  const unmatched = rows.filter(r => !r.matched || !!r.error);

  const errorsByReason = new Map<string, number>();
  for (const row of unmatched) {
    const reason = row.error || 'Unknown';
    errorsByReason.set(reason, (errorsByReason.get(reason) || 0) + 1);
  }
  const sortedReasons = Array.from(errorsByReason.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold" data-testid="text-total-rows">{previewData.totalRows}</div>
            <p className="text-xs text-muted-foreground">Total Rows</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600" data-testid="text-to-create">{toCreate.length}</div>
            <p className="text-xs text-muted-foreground">To Create</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600" data-testid="text-already-assigned">{alreadyAssigned.length}</div>
            <p className="text-xs text-muted-foreground">Already Assigned</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600" data-testid="text-unmatched">{unmatched.length}</div>
            <p className="text-xs text-muted-foreground">Not Importable</p>
          </CardContent>
        </Card>
      </div>

      {unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-muted-foreground" />
              Skip Reason Breakdown
            </CardTitle>
            <CardDescription>
              Why {unmatched.length} records will not be imported
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sortedReasons.map(([reason, count], idx) => (
                <div key={idx} className="flex items-center justify-between py-1.5 border-b last:border-b-0" data-testid={`preview-reason-${idx}`}>
                  <span className="text-sm">{reason}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {toCreate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Workers to Assign as Building Reps ({toCreate.length})
            </CardTitle>
            <CardDescription>
              These workers will be assigned as stewards at their current employer
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                  {toCreate.map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-to-create-${idx}`}>
                      <TableCell>
                        {row.workerId ? (
                          <Link href={`/workers/${row.workerId}`} className="text-primary hover:underline">
                            {row.workerName || row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                      </TableCell>
                      <TableCell>{row.badgeId}</TableCell>
                      <TableCell>{row.employerName}</TableCell>
                      <TableCell>{row.bargainingUnitName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {alreadyAssigned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-amber-600" />
              Already Assigned ({alreadyAssigned.length})
            </CardTitle>
            <CardDescription>
              These workers already have steward assignments and will be skipped
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Badge ID</TableHead>
                    <TableHead>Employer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alreadyAssigned.map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-already-assigned-${idx}`}>
                      <TableCell>
                        {row.workerId ? (
                          <Link href={`/workers/${row.workerId}`} className="text-primary hover:underline">
                            {row.workerName || row.name}
                          </Link>
                        ) : (
                          row.name
                        )}
                      </TableCell>
                      <TableCell>{row.badgeId}</TableCell>
                      <TableCell>{row.employerName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {unmatched.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              Unmatched Rows ({unmatched.length})
            </CardTitle>
            <CardDescription>
              These rows could not be matched to workers and will be skipped
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Badge ID</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unmatched.map((row, idx) => (
                    <TableRow key={idx} data-testid={`row-unmatched-${idx}`}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.badgeId || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">{row.error}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
