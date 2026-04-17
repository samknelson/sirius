import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, CheckCircle2, XCircle, AlertCircle, Loader2, Search } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PreviewStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

interface PreviewData {
  matched: Array<{
    filename: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    hasExistingCardcheck: boolean;
    existingCardcheckHasEsig: boolean;
  }>;
  unmatched: Array<{
    filename: string;
    bpsId: string | null;
    reason: string;
  }>;
  totalFiles: number;
  matchedCount: number;
  unmatchedCount: number;
}

export function PreviewStep({ wizardId, wizardType, data, onDataChange }: PreviewStepProps) {
  const { toast } = useToast();
  const [previewData, setPreviewData] = useState<PreviewData | null>(data?.previewData || null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/btu-sig-import/preview", { wizardId });
    },
    onSuccess: (result: PreviewData) => {
      setPreviewData(result);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Preview Generated",
        description: `${result.matchedCount} files matched, ${result.unmatchedCount} unmatched.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Preview Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview Matches
          </CardTitle>
          <CardDescription>
            Review which files match workers in the system before processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!previewData && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Search className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                Generate a preview to see which files match workers
              </p>
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                data-testid="button-generate-preview"
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Matching files...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Generate Preview
                  </>
                )}
              </Button>
            </div>
          )}

          {previewData && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6 text-center">
                    <div className="text-2xl font-bold">{previewData.totalFiles}</div>
                    <div className="text-sm text-muted-foreground">Total Files</div>
                  </CardContent>
                </Card>
                <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900">
                  <CardContent className="pt-6 text-center">
                    <div className="text-2xl font-bold text-green-600">{previewData.matchedCount}</div>
                    <div className="text-sm text-muted-foreground">Matched</div>
                  </CardContent>
                </Card>
                <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900">
                  <CardContent className="pt-6 text-center">
                    <div className="text-2xl font-bold text-red-600">{previewData.unmatchedCount}</div>
                    <div className="text-sm text-muted-foreground">Unmatched</div>
                  </CardContent>
                </Card>
              </div>

              {previewData.matched.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      Matched Files ({previewData.matched.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>BPS ID</TableHead>
                            <TableHead>Worker</TableHead>
                            <TableHead>Filename</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.matched.map((m, idx) => (
                            <TableRow key={idx} data-testid={`row-matched-${idx}`}>
                              <TableCell className="font-mono text-sm">{m.bpsId}</TableCell>
                              <TableCell>{m.workerName}</TableCell>
                              <TableCell className="text-sm text-muted-foreground truncate max-w-48">{m.filename}</TableCell>
                              <TableCell>
                                {m.existingCardcheckHasEsig ? (
                                  <Badge variant="secondary">Has E-Sig</Badge>
                                ) : m.hasExistingCardcheck ? (
                                  <Badge variant="outline">Will Link</Badge>
                                ) : (
                                  <Badge>Will Create</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {previewData.unmatched.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      Unmatched Files ({previewData.unmatched.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-48">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>BPS ID</TableHead>
                            <TableHead>Filename</TableHead>
                            <TableHead>Reason</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.unmatched.map((u, idx) => (
                            <TableRow key={idx} data-testid={`row-unmatched-${idx}`}>
                              <TableCell className="font-mono text-sm">{u.bpsId || '-'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground truncate max-w-48">{u.filename}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{u.reason}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}

              {previewData.matched.some(m => m.existingCardcheckHasEsig) && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Some card checks already have signatures</AlertTitle>
                  <AlertDescription>
                    Files matching workers who already have an e-signature on their card check will still create a new offline e-sig record, but the existing card check will not be updated.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => previewMutation.mutate()}
                  disabled={previewMutation.isPending}
                  data-testid="button-refresh-preview"
                >
                  {previewMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4 mr-2" />
                  )}
                  Refresh Preview
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
