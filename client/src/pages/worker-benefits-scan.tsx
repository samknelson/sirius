import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Scan, Loader2, Calendar, CheckCircle, XCircle, AlertCircle, ArrowRight, Play, FlaskConical } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PluginResult {
  pluginKey: string;
  eligible: boolean;
  reason?: string;
}

interface BenefitScanAction {
  benefitId: string;
  benefitName: string;
  scanType: "start" | "continue";
  eligible: boolean;
  action: "create" | "delete" | "none";
  actionReason: string;
  pluginResults: PluginResult[];
  executed?: boolean;
  executionError?: string;
}

interface ScanResult {
  workerId: string;
  month: number;
  year: number;
  mode: "test" | "live";
  policyId: string;
  policyName: string;
  policySource: string;
  employerId: string | null;
  employerName: string | null;
  previousMonthBenefitIds: string[];
  actions: BenefitScanAction[];
  summary: {
    totalEvaluated: number;
    eligible: number;
    ineligible: number;
    created: number;
    deleted: number;
    unchanged: number;
  };
}

function WorkerBenefitsScanContent() {
  const { worker, contact } = useWorkerLayout();
  const { toast } = useToast();
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState<string>(currentDate.getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState<string>((currentDate.getMonth() + 1).toString());
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const years = Array.from({ length: 10 }, (_, i) => currentDate.getFullYear() - i);
  const months = [
    { value: "1", label: "January" },
    { value: "2", label: "February" },
    { value: "3", label: "March" },
    { value: "4", label: "April" },
    { value: "5", label: "May" },
    { value: "6", label: "June" },
    { value: "7", label: "July" },
    { value: "8", label: "August" },
    { value: "9", label: "September" },
    { value: "10", label: "October" },
    { value: "11", label: "November" },
    { value: "12", label: "December" },
  ];

  const scanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/workers/${worker.id}/benefits/scan`, {
        month: parseInt(selectedMonth),
        year: parseInt(selectedYear),
        mode: isLiveMode ? "live" : "test",
      });
      return response.json();
    },
    onSuccess: (result: ScanResult) => {
      setScanResult(result);
      toast({
        title: result.mode === "live" ? "Scan Completed" : "Test Scan Completed",
        description: `Evaluated ${result.summary.totalEvaluated} benefits. ${result.summary.created} created, ${result.summary.deleted} deleted.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Scan Failed",
        description: error.message || "Failed to run benefits scan",
        variant: "destructive",
      });
    },
  });

  const getMonthName = (month: number) => months.find((m) => m.value === month.toString())?.label || "";

  const getActionBadge = (action: BenefitScanAction) => {
    if (action.action === "create") {
      return <Badge variant="default" className="bg-green-600">Create</Badge>;
    }
    if (action.action === "delete") {
      return <Badge variant="destructive">Delete</Badge>;
    }
    return <Badge variant="secondary">No Change</Badge>;
  };

  const getScanTypeBadge = (scanType: "start" | "continue") => {
    if (scanType === "start") {
      return <Badge variant="outline">Start</Badge>;
    }
    return <Badge variant="outline">Continue</Badge>;
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground" data-testid="heading-benefits-scan">
          Benefits Eligibility Scan
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Run an eligibility scan for {contact?.displayName || "this worker"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Scan Configuration
          </CardTitle>
          <CardDescription>
            Select the year and month for the eligibility scan
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-xl">
            <div className="space-y-2">
              <Label htmlFor="year-select">Year</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger id="year-select" data-testid="select-scan-year">
                  <SelectValue placeholder="Select year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="month-select">Month</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger id="month-select" data-testid="select-scan-month">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <div className="flex items-center gap-3 h-9">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Test</span>
                </div>
                <Switch
                  checked={isLiveMode}
                  onCheckedChange={setIsLiveMode}
                  data-testid="switch-scan-mode"
                />
                <div className="flex items-center gap-2">
                  <Play className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Live</span>
                </div>
              </div>
            </div>
          </div>

          {isLiveMode && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md">
              <p className="text-sm text-amber-800 dark:text-amber-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Live mode will create and delete benefit records. Use test mode first to preview changes.
              </p>
            </div>
          )}

          <div className="pt-4 border-t border-border flex items-center gap-4 flex-wrap">
            <Button
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              variant={isLiveMode ? "default" : "secondary"}
              data-testid="button-run-scan"
            >
              {scanMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Scan className="mr-2 h-4 w-4" />
              )}
              {isLiveMode ? "Run Live Scan" : "Run Test Scan"}
            </Button>
            {scanMutation.isPending && (
              <span className="text-sm text-muted-foreground">
                Evaluating eligibility rules...
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {scanResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Scan Results
              {scanResult.mode === "test" && (
                <Badge variant="secondary">Test Mode</Badge>
              )}
              {scanResult.mode === "live" && (
                <Badge variant="default">Live Mode</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {getMonthName(scanResult.month)} {scanResult.year}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-sm text-muted-foreground">Policy</p>
                <p className="font-medium">{scanResult.policyName}</p>
                <p className="text-xs text-muted-foreground">{scanResult.policySource}</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-sm text-muted-foreground">Evaluated</p>
                <p className="text-2xl font-bold">{scanResult.summary.totalEvaluated}</p>
              </div>
              <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-md">
                <p className="text-sm text-muted-foreground">Eligible</p>
                <p className="text-2xl font-bold text-green-600">{scanResult.summary.eligible}</p>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-md">
                <p className="text-sm text-muted-foreground">Ineligible</p>
                <p className="text-2xl font-bold text-red-600">{scanResult.summary.ineligible}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 border rounded-md text-center">
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="text-xl font-bold text-green-600">{scanResult.summary.created}</p>
              </div>
              <div className="p-3 border rounded-md text-center">
                <p className="text-sm text-muted-foreground">Deleted</p>
                <p className="text-xl font-bold text-red-600">{scanResult.summary.deleted}</p>
              </div>
              <div className="p-3 border rounded-md text-center">
                <p className="text-sm text-muted-foreground">Unchanged</p>
                <p className="text-xl font-bold text-muted-foreground">{scanResult.summary.unchanged}</p>
              </div>
            </div>

            {scanResult.actions.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-medium">Benefit Details</h3>
                <Accordion type="multiple" className="w-full">
                  {scanResult.actions.map((action, index) => (
                    <AccordionItem key={action.benefitId} value={`item-${index}`}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3 flex-wrap">
                          {action.eligible ? (
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-600" />
                          )}
                          <span className="font-medium">{action.benefitName}</span>
                          {getScanTypeBadge(action.scanType)}
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          {getActionBadge(action)}
                          {action.executed === false && action.executionError && (
                            <Badge variant="destructive">Error</Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pl-7">
                          <p className="text-sm text-muted-foreground">{action.actionReason}</p>
                          
                          {action.executionError && (
                            <div className="p-2 bg-red-50 dark:bg-red-950/30 rounded-md">
                              <p className="text-sm text-red-600">Error: {action.executionError}</p>
                            </div>
                          )}

                          {action.pluginResults.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Plugin Results:</p>
                              {action.pluginResults.map((result, i) => (
                                <div
                                  key={i}
                                  className={`p-2 rounded-md text-sm ${
                                    result.eligible
                                      ? "bg-green-50 dark:bg-green-950/30"
                                      : "bg-red-50 dark:bg-red-950/30"
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {result.eligible ? (
                                      <CheckCircle className="h-3 w-3 text-green-600" />
                                    ) : (
                                      <XCircle className="h-3 w-3 text-red-600" />
                                    )}
                                    <span className="font-mono text-xs">{result.pluginKey}</span>
                                  </div>
                                  {result.reason && (
                                    <p className="text-muted-foreground mt-1 pl-5">{result.reason}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {action.pluginResults.length === 0 && (
                            <p className="text-sm text-muted-foreground italic">
                              No eligibility rules configured for this benefit with scan type "{action.scanType}"
                            </p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            )}

            {scanResult.actions.length === 0 && (
              <div className="p-4 bg-muted/50 rounded-md text-center">
                <p className="text-muted-foreground">No benefits configured for this policy</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function WorkerBenefitsScan() {
  return (
    <WorkerLayout activeTab="benefits-scan">
      <WorkerBenefitsScanContent />
    </WorkerLayout>
  );
}
