import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, CheckCircle2, XCircle, AlertCircle, Loader2, Search, SkipForward } from "lucide-react";
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
    nid: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    postDate: string;
    name: string;
    hasExistingCardcheck: boolean;
    existingHasUploadEsig: boolean;
  }>;
  unmatched: Array<{
    nid: string;
    bpsId: string;
    name: string;
    reason: string;
  }>;
  skipped: Array<{
    nid: string;
    bpsId: string;
    workerId: string;
    workerName: string;
    reason: string;
  }>;
  totalRows: number;
  matchedCount: number;
  unmatchedCount: number;
  skippedCount: number;
}

export function PreviewStep({ wizardId, wizardType, data, onDataChange }: PreviewStepProps) {
  const { toast } = useToast();
  const [previewData, setPreviewData] = useState<PreviewData | null>(data?.previewData || null);

  const previewMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/btu-scraper-import/preview", { wizardId });
    },
    onSuccess: (result: PreviewData) => {
      setPreviewData(result);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      toast({
        title: "Preview Generated",
        description: `${result.matchedCount} matched, ${result.unmatchedCount} unmatched, ${result.skippedCount} skipped.`,
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
            Review which scraped rows match workers in the system before processing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!previewData && (
            <div className="flex flex-col items-center justify-center p-12 space-y-4">
              <Search className="h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground" data-testid="text-preview-prompt">
                Generate a preview to see which rows match workers
              </p>
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                data-testid="button-generate-preview"
              >
                {previewMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Matching workers...
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 border rounded-lg text-center">
                  <div className="text-2xl font-bold" data-testid="text-total-rows">{previewData.totalRows}</div>
                  <div className="text-sm text-muted-foreground">Total Rows</div>
                </div>
                <div className="p-4 border rounded-lg text-center border-green-200 dark:border-green-900">
                  <div className="text-2xl font-bold text-green-600" data-testid="text-matched-count">{previewData.matchedCount}</div>
                  <div className="text-sm text-muted-foreground">Matched</div>
                </div>
                <div className="p-4 border rounded-lg text-center border-red-200 dark:border-red-900">
                  <div className="text-2xl font-bold text-red-600" data-testid="text-unmatched-count">{previewData.unmatchedCount}</div>
                  <div className="text-sm text-muted-foreground">Unmatched</div>
                </div>
                <div className="p-4 border rounded-lg text-center border-amber-200 dark:border-amber-900">
                  <div className="text-2xl font-bold text-amber-600" data-testid="text-skipped-count">{previewData.skippedCount}</div>
                  <div className="text-sm text-muted-foreground">Skipped</div>
                </div>
              </div>

              {previewData.matched.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-4 border-b">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      Matched Workers ({previewData.matched.length})
                    </div>
                  </div>
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead>Name (from site)</TableHead>
                          <TableHead>Post Date</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.matched.map((m, idx) => (
                          <TableRow key={idx} data-testid={`row-matched-${idx}`}>
                            <TableCell className="font-mono text-sm">{m.bpsId}</TableCell>
                            <TableCell>{m.workerName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{m.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{m.postDate}</TableCell>
                            <TableCell>
                              {m.hasExistingCardcheck ? (
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
                </div>
              )}

              {previewData.skipped.length > 0 && (
                <div className="border rounded-lg border-amber-200 dark:border-amber-900">
                  <div className="p-4 border-b">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <SkipForward className="h-4 w-4 text-amber-600" />
                      Skipped - Already Has Upload ({previewData.skipped.length})
                    </div>
                  </div>
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Worker</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.skipped.map((s, idx) => (
                          <TableRow key={idx} data-testid={`row-skipped-${idx}`}>
                            <TableCell className="font-mono text-sm">{s.bpsId}</TableCell>
                            <TableCell>{s.workerName}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}

              {previewData.unmatched.length > 0 && (
                <div className="border rounded-lg border-red-200 dark:border-red-900">
                  <div className="p-4 border-b">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <XCircle className="h-4 w-4 text-red-600" />
                      Unmatched Workers ({previewData.unmatched.length})
                    </div>
                  </div>
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPS ID</TableHead>
                          <TableHead>Name (from site)</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.unmatched.map((u, idx) => (
                          <TableRow key={idx} data-testid={`row-unmatched-${idx}`}>
                            <TableCell className="font-mono text-sm">{u.bpsId}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{u.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{u.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
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
