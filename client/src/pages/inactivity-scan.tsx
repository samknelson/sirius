import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Play, Search, Users, User, FlaskConical, Zap } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/contexts/PageTitleContext";

interface WorkerScanDetail {
  workerId: string;
  workerName: string;
  currentStatus: string;
  lastActiveDate: string | null;
  action: "deactivated" | "already_inactive" | "still_active" | "not_union" | "error";
  reason: string;
}

interface ScanResult {
  scanned: number;
  deactivated: number;
  alreadyInactive: number;
  errors: string[];
  mode: "live" | "test";
  details: WorkerScanDetail[];
}

export default function InactivityScan() {
  usePageTitle("Inactivity Scan");
  const { toast } = useToast();
  const [mode, setMode] = useState<"test" | "live">("test");
  const [scope, setScope] = useState<"all" | "single">("all");
  const [workerId, setWorkerId] = useState("");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);

  const scanMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/sitespecific/hta/inactivity-scan", {
        mode,
        workerId: scope === "single" ? workerId.trim() : undefined,
      });
    },
    onSuccess: (data: ScanResult) => {
      setLastResult(data);
      if (data.mode === "live" && data.deactivated > 0) {
        toast({
          title: "Scan complete",
          description: `${data.deactivated} worker(s) deactivated.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Scan failed", description: error.message, variant: "destructive" });
    },
  });

  const getActionBadge = (action: WorkerScanDetail["action"]) => {
    switch (action) {
      case "deactivated":
        return <Badge variant="destructive" data-testid="badge-action-deactivated">Deactivated</Badge>;
      case "already_inactive":
        return <Badge variant="secondary" data-testid="badge-action-inactive">Already Inactive</Badge>;
      case "still_active":
        return <Badge variant="default" className="bg-green-600" data-testid="badge-action-active">Still Active</Badge>;
      case "not_union":
        return <Badge variant="outline" data-testid="badge-action-not-union">Not Union</Badge>;
      case "error":
        return <Badge variant="destructive" data-testid="badge-action-error">Error</Badge>;
    }
  };

  const canRun = scope === "all" || (scope === "single" && workerId.trim());

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-scan-title">Inactivity Scan</h1>
        <p className="text-muted-foreground" data-testid="text-scan-description">
          Scan Union workers and deactivate those with no Active work status entry in the last 3 months.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Scan Configuration
          </CardTitle>
          <CardDescription>
            Use Test mode to preview what would happen without making changes. Live mode will create Inactive work status entries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "test" | "live")}>
                <SelectTrigger data-testid="select-scan-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="test">
                    <span className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" />
                      Test (dry run — no changes)
                    </span>
                  </SelectItem>
                  <SelectItem value="live">
                    <span className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      Live (apply changes)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => { setScope(v as "all" | "single"); if (v === "all") setWorkerId(""); }}>
                <SelectTrigger data-testid="select-scan-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      All Union Workers
                    </span>
                  </SelectItem>
                  <SelectItem value="single">
                    <span className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Single Worker
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {scope === "single" && (
            <div className="space-y-2">
              <Label>Worker ID</Label>
              <Input
                placeholder="Enter worker ID"
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                data-testid="input-worker-id"
              />
              <p className="text-xs text-muted-foreground">
                You can find the worker ID in the URL when viewing a worker profile.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={() => scanMutation.mutate()}
              disabled={!canRun || scanMutation.isPending}
              variant={mode === "live" ? "destructive" : "default"}
              data-testid="button-run-scan"
            >
              <Play className="h-4 w-4 mr-2" />
              {scanMutation.isPending
                ? "Scanning..."
                : mode === "live"
                  ? "Run Live Scan"
                  : "Run Test Scan"}
            </Button>
            {mode === "live" && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                This will create Inactive work status entries for qualifying workers.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {lastResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Results
              <Badge variant={lastResult.mode === "test" ? "secondary" : "destructive"} data-testid="badge-result-mode">
                {lastResult.mode === "test" ? "Test Mode" : "Live Mode"}
              </Badge>
            </CardTitle>
            <CardDescription>
              {lastResult.mode === "test"
                ? "No changes were made. This is a preview of what would happen."
                : "Changes have been applied."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-scanned-count">{lastResult.scanned}</div>
                <div className="text-sm text-muted-foreground">Scanned</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-destructive" data-testid="text-deactivated-count">
                  {lastResult.deactivated}
                </div>
                <div className="text-sm text-muted-foreground">
                  {lastResult.mode === "test" ? "Would Deactivate" : "Deactivated"}
                </div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold text-muted-foreground" data-testid="text-inactive-count">
                  {lastResult.alreadyInactive}
                </div>
                <div className="text-sm text-muted-foreground">Already Inactive</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold" data-testid="text-error-count">
                  {lastResult.errors.length}
                </div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </div>
            </div>

            {lastResult.errors.length > 0 && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-1">
                <div className="font-medium text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Errors
                </div>
                {lastResult.errors.map((err, i) => (
                  <p key={i} className="text-sm text-destructive" data-testid={`text-error-${i}`}>{err}</p>
                ))}
              </div>
            )}

            {lastResult.details.length > 0 && (
              <>
                <Separator />
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Worker</TableHead>
                        <TableHead>Current Status</TableHead>
                        <TableHead>Last Active Date</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lastResult.details.map((detail, i) => (
                        <TableRow key={detail.workerId + '-' + i} data-testid={`row-scan-result-${i}`}>
                          <TableCell>
                            <div>
                              <div className="font-medium" data-testid={`text-worker-name-${i}`}>{detail.workerName}</div>
                              <div className="text-xs text-muted-foreground font-mono" data-testid={`text-worker-id-${i}`}>
                                {detail.workerId}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-current-status-${i}`}>{detail.currentStatus}</TableCell>
                          <TableCell data-testid={`text-last-active-${i}`}>
                            {detail.lastActiveDate || "—"}
                          </TableCell>
                          <TableCell>{getActionBadge(detail.action)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-xs" data-testid={`text-reason-${i}`}>
                            {detail.reason}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
