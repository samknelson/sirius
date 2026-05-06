import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RerunWizard {
  id: string;
  type: string;
  displayName: string;
  date: string | null;
  entityId: string | null;
  employerName: string | null;
  year: number | undefined;
  month: number | undefined;
  wmbCount: number;
  hoursCount: number;
}

interface RerunResult {
  wizardId: string;
  employerId: string;
  year: number;
  month: number;
  wmbProcessed: number;
  wmbErrors: number;
  hoursProcessed: number;
  hoursErrors: number;
  totalTransactions: number;
  entriesDeleted: number;
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ChargePluginRerunPage() {
  usePageTitle("Rerun Charge Plugins");
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerWmb, setTriggerWmb] = useState(true);
  const [triggerHours, setTriggerHours] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<RerunResult | null>(null);

  const { data: wizards = [], isLoading } = useQuery<RerunWizard[]>({
    queryKey: ["/api/charge-plugin-rerun/wizards"],
  });

  const selectedWizard = useMemo(
    () => wizards.find((w) => w.id === selectedId) ?? null,
    [wizards, selectedId]
  );

  const rerunMutation = useMutation({
    mutationFn: async ({ wizardId, triggers }: { wizardId: string; triggers: string[] }) => {
      return apiRequest("POST", "/api/charge-plugin-rerun/execute", { wizardId, triggers });
    },
    onSuccess: (data: RerunResult) => {
      setLastResult(data);
      const totalErrors = data.wmbErrors + data.hoursErrors;
      toast({
        title: totalErrors > 0 ? "Rerun completed with errors" : "Rerun completed",
        description: `${data.totalTransactions} ledger entries created/updated.${totalErrors > 0 ? ` ${totalErrors} error(s).` : ""}`,
        variant: totalErrors > 0 ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Rerun failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleRunClick() {
    if (!selectedId) return;
    if (!triggerWmb && !triggerHours) {
      toast({ title: "Select at least one trigger type", variant: "destructive" });
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    if (!selectedId) return;
    const triggers: string[] = [];
    if (triggerWmb) triggers.push("wmb_saved");
    if (triggerHours) triggers.push("hours_saved");
    setConfirmOpen(false);
    setLastResult(null);
    rerunMutation.mutate({ wizardId: selectedId, triggers });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading wizards...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Rerun Charge Plugins
          </CardTitle>
          <CardDescription>
            Re-execute charge plugins for a completed wizard. This replays WMB and/or Hours events
            through the charge plugin system, recalculating ledger entries using current rates.
            Existing entries are updated (not duplicated) thanks to the charge plugin key system.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {wizards.length === 0 ? (
            <p className="text-muted-foreground text-sm">No completed wizards found.</p>
          ) : (
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Wizard</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">WMBs</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wizards.map((w) => (
                    <TableRow
                      key={w.id}
                      className={`cursor-pointer ${selectedId === w.id ? "bg-muted" : ""}`}
                      onClick={() => setSelectedId(w.id)}
                    >
                      <TableCell>
                        <div className="font-medium">{w.displayName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{w.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell>{w.employerName ?? "—"}</TableCell>
                      <TableCell>
                        {w.year && w.month
                          ? `${MONTH_NAMES[w.month]} ${w.year}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={w.wmbCount > 0 ? "default" : "secondary"}>
                          {w.wmbCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={w.hoursCount > 0 ? "default" : "secondary"}>
                          {w.hoursCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {w.date
                          ? new Date(w.date).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWizard && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Rerun: {selectedWizard.employerName ?? selectedWizard.displayName}
              {selectedWizard.year && selectedWizard.month
                ? ` — ${MONTH_NAMES[selectedWizard.month]} ${selectedWizard.year}`
                : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <p className="text-sm font-medium">Select triggers to replay:</p>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="trigger-wmb"
                  checked={triggerWmb}
                  onCheckedChange={(v) => setTriggerWmb(!!v)}
                />
                <label htmlFor="trigger-wmb" className="text-sm cursor-pointer">
                  WMB Saved ({selectedWizard.wmbCount} records)
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="trigger-hours"
                  checked={triggerHours}
                  onCheckedChange={(v) => setTriggerHours(!!v)}
                />
                <label htmlFor="trigger-hours" className="text-sm cursor-pointer">
                  Hours Saved ({selectedWizard.hoursCount} records)
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleRunClick}
                disabled={rerunMutation.isPending || (!triggerWmb && !triggerHours)}
              >
                {rerunMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Running...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Rerun Charge Plugins
                  </>
                )}
              </Button>
            </div>

            {lastResult && (
              <div
                className={`mt-4 p-4 border rounded-md space-y-2 ${
                  lastResult.wmbErrors > 0 || lastResult.hoursErrors > 0
                    ? "bg-red-50 border-red-200"
                    : "bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  {lastResult.wmbErrors > 0 || lastResult.hoursErrors > 0 ? (
                    <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  )}
                  <span>Results</span>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <span className="text-muted-foreground">WMB records processed:</span>
                  <span>{lastResult.wmbProcessed}</span>
                  {lastResult.wmbErrors > 0 && (
                    <>
                      <span className="text-red-600">WMB errors:</span>
                      <span className="text-red-600">{lastResult.wmbErrors}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Hours records processed:</span>
                  <span>{lastResult.hoursProcessed}</span>
                  {lastResult.hoursErrors > 0 && (
                    <>
                      <span className="text-red-600">Hours errors:</span>
                      <span className="text-red-600">{lastResult.hoursErrors}</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Old entries cleared:</span>
                  <span>{lastResult.entriesDeleted}</span>
                  <span className="text-muted-foreground">New entries created:</span>
                  <span className="font-medium">{lastResult.totalTransactions}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Charge Plugin Rerun
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will re-execute charge plugins for{" "}
                  <strong>
                    {selectedWizard?.employerName ?? selectedWizard?.displayName}
                    {selectedWizard?.year && selectedWizard?.month
                      ? ` — ${MONTH_NAMES[selectedWizard.month]} ${selectedWizard.year}`
                      : ""}
                  </strong>
                  .
                </p>
                <p>
                  Triggers:{" "}
                  {[
                    triggerWmb && `WMB (${selectedWizard?.wmbCount ?? 0} records)`,
                    triggerHours && `Hours (${selectedWizard?.hoursCount ?? 0} records)`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <p>
                  Existing ledger entries will be updated with recalculated amounts based on current
                  rate configuration. This cannot be undone.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Confirm Rerun</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
