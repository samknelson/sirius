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

interface RerunWizardResult {
  wizardId: string;
  employerId: string;
  employerName: string | null;
  year: number;
  month: number;
  wmbProcessed: number;
  wmbErrors: number;
  hoursProcessed: number;
  hoursErrors: number;
  totalTransactions: number;
  error?: string;
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ChargePluginRerunPage() {
  usePageTitle("Rerun Charge Plugins");
  const { toast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [triggerWmb, setTriggerWmb] = useState(true);
  const [triggerHours, setTriggerHours] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResults, setLastResults] = useState<RerunWizardResult[]>([]);

  const { data: wizards = [], isLoading } = useQuery<RerunWizard[]>({
    queryKey: ["/api/charge-plugin-rerun/wizards"],
  });

  const selectedWizards = useMemo(
    () => wizards.filter((w) => selectedIds.has(w.id)),
    [wizards, selectedIds]
  );

  const totalWmb = useMemo(
    () => selectedWizards.reduce((sum, w) => sum + w.wmbCount, 0),
    [selectedWizards]
  );
  const totalHours = useMemo(
    () => selectedWizards.reduce((sum, w) => sum + w.hoursCount, 0),
    [selectedWizards]
  );

  const allSelected = wizards.length > 0 && selectedIds.size === wizards.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < wizards.length;

  const rerunMutation = useMutation({
    mutationFn: async ({ wizardIds, triggers }: { wizardIds: string[]; triggers: string[] }) => {
      return apiRequest("POST", "/api/charge-plugin-rerun/execute", { wizardIds, triggers });
    },
    onSuccess: (data: { results: RerunWizardResult[] }) => {
      setLastResults(data.results);
      const totalTx = data.results.reduce((s, r) => s + r.totalTransactions, 0);
      const totalErrors = data.results.reduce((s, r) => s + r.wmbErrors + r.hoursErrors, 0);
      const failedWizards = data.results.filter((r) => r.error).length;
      toast({
        title: totalErrors > 0 || failedWizards > 0 ? "Rerun completed with issues" : "Rerun completed",
        description: `${data.results.length} wizard(s) processed. ${totalTx} ledger entries created/updated.${failedWizards > 0 ? ` ${failedWizards} wizard(s) had errors.` : ""}`,
        variant: totalErrors > 0 || failedWizards > 0 ? "destructive" : "default",
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

  function toggleWizard(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(wizards.map((w) => w.id)));
    }
  }

  function handleRunClick() {
    if (selectedIds.size === 0) return;
    if (!triggerWmb && !triggerHours) {
      toast({ title: "Select at least one trigger type", variant: "destructive" });
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    const triggers: string[] = [];
    if (triggerWmb) triggers.push("wmb_saved");
    if (triggerHours) triggers.push("hours_saved");
    setConfirmOpen(false);
    setLastResults([]);
    rerunMutation.mutate({ wizardIds: Array.from(selectedIds), triggers });
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
            Re-execute charge plugins for completed wizards. This replays WMB and/or Hours events
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
                    <TableHead className="w-12">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={toggleAll}
                        aria-label="Select all"
                      />
                    </TableHead>
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
                      className={`cursor-pointer ${selectedIds.has(w.id) ? "bg-muted" : ""}`}
                      onClick={() => toggleWizard(w.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(w.id)}
                          onCheckedChange={() => toggleWizard(w.id)}
                        />
                      </TableCell>
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

      {selectedIds.size > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Rerun {selectedIds.size} wizard{selectedIds.size > 1 ? "s" : ""}
            </CardTitle>
            <CardDescription>
              {selectedWizards.map((w) => (
                <span key={w.id} className="inline-block mr-3">
                  {w.employerName ?? w.displayName}
                  {w.year && w.month ? ` (${MONTH_NAMES[w.month]} ${w.year})` : ""}
                </span>
              ))}
            </CardDescription>
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
                  WMB Saved ({totalWmb} total records)
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="trigger-hours"
                  checked={triggerHours}
                  onCheckedChange={(v) => setTriggerHours(!!v)}
                />
                <label htmlFor="trigger-hours" className="text-sm cursor-pointer">
                  Hours Saved ({totalHours} total records)
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

            {lastResults.length > 0 && (
              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium">Results</p>
                {lastResults.map((r) => {
                  const hasErrors = r.wmbErrors > 0 || r.hoursErrors > 0 || !!r.error;
                  return (
                    <div
                      key={r.wizardId}
                      className={`p-4 border rounded-md space-y-2 ${hasErrors ? "bg-red-50 border-red-200" : "bg-muted/50"}`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {hasErrors ? (
                          <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        )}
                        <span>
                          {r.employerName ?? r.wizardId.slice(0, 8)}
                          {r.year && r.month ? ` — ${MONTH_NAMES[r.month]} ${r.year}` : ""}
                        </span>
                      </div>
                      {r.error ? (
                        <p className="text-sm text-red-600">{r.error}</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                          <span className="text-muted-foreground">WMB records processed:</span>
                          <span>{r.wmbProcessed}</span>
                          {r.wmbErrors > 0 && (
                            <>
                              <span className="text-red-600">WMB errors:</span>
                              <span className="text-red-600">{r.wmbErrors}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">Hours records processed:</span>
                          <span>{r.hoursProcessed}</span>
                          {r.hoursErrors > 0 && (
                            <>
                              <span className="text-red-600">Hours errors:</span>
                              <span className="text-red-600">{r.hoursErrors}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">Ledger entries created/updated:</span>
                          <span className="font-medium">{r.totalTransactions}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="pt-2 border-t text-sm font-medium">
                  Total ledger entries: {lastResults.reduce((s, r) => s + r.totalTransactions, 0)}
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
                  <strong>{selectedIds.size} wizard{selectedIds.size > 1 ? "s" : ""}</strong>:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  {selectedWizards.map((w) => (
                    <li key={w.id}>
                      {w.employerName ?? w.displayName}
                      {w.year && w.month
                        ? ` — ${MONTH_NAMES[w.month]} ${w.year}`
                        : ""}
                    </li>
                  ))}
                </ul>
                <p>
                  Triggers:{" "}
                  {[
                    triggerWmb && `WMB (${totalWmb} records)`,
                    triggerHours && `Hours (${totalHours} records)`,
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
            <AlertDialogAction onClick={handleConfirm}>
              Confirm Rerun ({selectedIds.size} wizard{selectedIds.size > 1 ? "s" : ""})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
