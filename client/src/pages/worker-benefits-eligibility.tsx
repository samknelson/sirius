import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Policy, TrustBenefit, Employer, Variable } from "@shared/schema";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Play } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PolicyData {
  benefitIds?: string[];
  eligibilityRules?: Record<string, EligibilityRule[]>;
}

interface EligibilityRule {
  pluginKey: string;
  appliesTo: ("start" | "continue")[];
  config: Record<string, unknown>;
}

interface EligibilityPluginResult {
  pluginKey: string;
  eligible: boolean;
  reason?: string;
}

interface BenefitEligibilityResult {
  benefitId: string;
  eligible: boolean;
  results: EligibilityPluginResult[];
}

interface EligibilityPlugin {
  id: string;
  name: string;
  description: string;
}

interface WorkerWs {
  id: string;
  name: string;
}

function WorkerBenefitsEligibilityContent() {
  const { worker } = useWorkerLayout();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
  const [selectedBenefitId, setSelectedBenefitId] = useState<string>("");
  const [selectedScanType, setSelectedScanType] = useState<"start" | "continue">("start");
  const [eligibilityResult, setEligibilityResult] = useState<BenefitEligibilityResult | null>(null);

  const { data: policies = [] } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const { data: allBenefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const { data: plugins = [] } = useQuery<EligibilityPlugin[]>({
    queryKey: ["/api/eligibility-plugins"],
  });

  const { data: workStatuses = [] } = useQuery<WorkerWs[]>({
    queryKey: ["/api/options/worker-ws"],
  });

  const { data: homeEmployer } = useQuery<Employer>({
    queryKey: ["/api/employers", worker.denormHomeEmployerId],
    enabled: !!worker.denormHomeEmployerId,
  });

  const { data: defaultPolicyVariable } = useQuery<Variable | null>({
    queryKey: ["/api/variables/by-name", "policy_default"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/variables/by-name/policy_default");
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Failed to fetch");
        return response.json();
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (selectedPolicyId || policies.length === 0) return;
    
    let workerPolicyId: string | null = null;
    
    if (homeEmployer?.denormPolicyId) {
      workerPolicyId = homeEmployer.denormPolicyId;
    } else if (defaultPolicyVariable?.value) {
      workerPolicyId = defaultPolicyVariable.value as string;
    }
    
    if (workerPolicyId) {
      setSelectedPolicyId(workerPolicyId);
    }
  }, [policies, homeEmployer, defaultPolicyVariable, selectedPolicyId]);

  const selectedPolicy = policies.find((p) => p.id === selectedPolicyId);
  const policyData = (selectedPolicy?.data as PolicyData) || {};
  const policyBenefitIds = policyData.benefitIds || [];
  const policyBenefits = allBenefits.filter((b) => policyBenefitIds.includes(b.id));
  const eligibilityRules = policyData.eligibilityRules || {};

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/eligibility/evaluate", {
        workerId: worker.id,
        benefitId: selectedBenefitId,
        policyId: selectedPolicyId,
        scanType: selectedScanType,
        asOfMonth: parseInt(selectedMonth),
        asOfYear: parseInt(selectedYear),
        stopAfterIneligible: false,
      });
      return response;
    },
    onSuccess: (data) => {
      setEligibilityResult(data as BenefitEligibilityResult);
    },
  });

  const handleEvaluate = () => {
    if (!selectedPolicyId || !selectedBenefitId) return;
    evaluateMutation.mutate();
  };

  const getPluginName = (pluginKey: string) => {
    const plugin = plugins.find((p) => p.id === pluginKey);
    return plugin?.name || pluginKey;
  };

  const getStatusName = (statusId: string) => {
    const status = workStatuses.find((ws) => ws.id === statusId);
    return status?.name || statusId;
  };

  const formatRuleDescription = (rule: EligibilityRule): string => {
    if (rule.pluginKey === "work-status") {
      const allowedStatuses = (rule.config.allowedStatusIds as string[]) || [];
      const statusNames = allowedStatuses.map(getStatusName);
      return `Allowed work statuses: ${statusNames.length > 0 ? statusNames.join(", ") : "none configured"}`;
    }
    if (rule.pluginKey === "gbhet-legal") {
      const monthsOffset = (rule.config.monthsOffset as number) || 4;
      return `Requires nonzero hours ${monthsOffset} months prior`;
    }
    return JSON.stringify(rule.config);
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

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

  const selectedBenefitRules = selectedBenefitId ? (eligibilityRules[selectedBenefitId] || []) : [];
  const applicableRules = selectedBenefitRules.filter((r) => r.appliesTo.includes(selectedScanType));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Eligibility Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Test whether this worker is eligible for a benefit under a specific policy. Select the
            policy, benefit, date, and scan type to evaluate eligibility rules.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="policy">Policy</Label>
              <Select
                value={selectedPolicyId}
                onValueChange={(value) => {
                  setSelectedPolicyId(value);
                  setSelectedBenefitId("");
                  setEligibilityResult(null);
                }}
              >
                <SelectTrigger id="policy" data-testid="select-policy">
                  <SelectValue placeholder="Select a policy" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((policy) => (
                    <SelectItem key={policy.id} value={policy.id}>
                      {policy.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="benefit">Benefit</Label>
              <Select
                value={selectedBenefitId}
                onValueChange={(value) => {
                  setSelectedBenefitId(value);
                  setEligibilityResult(null);
                }}
                disabled={!selectedPolicyId}
              >
                <SelectTrigger id="benefit" data-testid="select-benefit">
                  <SelectValue placeholder={selectedPolicyId ? "Select a benefit" : "Select a policy first"} />
                </SelectTrigger>
                <SelectContent>
                  {policyBenefits.map((benefit) => (
                    <SelectItem key={benefit.id} value={benefit.id}>
                      {benefit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPolicyId && policyBenefits.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This policy has no benefits configured.
                  {allBenefits.length === 0 && " (Benefits are still loading...)"}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="year">Year</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger id="year" data-testid="select-year">
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
              <Label htmlFor="month">Month</Label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger id="month" data-testid="select-month">
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
              <Label htmlFor="scan-type">Scan Type</Label>
              <Select
                value={selectedScanType}
                onValueChange={(value) => {
                  setSelectedScanType(value as "start" | "continue");
                  setEligibilityResult(null);
                }}
              >
                <SelectTrigger id="scan-type" data-testid="select-scan-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="start">Start</SelectItem>
                  <SelectItem value="continue">Continue</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                "Start" is for new benefit enrollment, "Continue" is for ongoing eligibility.
              </p>
            </div>
          </div>

          {selectedBenefitId && (
            <div className="mt-4 p-4 border border-border rounded-md bg-muted/30">
              <h4 className="font-medium mb-2">Rules to be evaluated ({applicableRules.length})</h4>
              {applicableRules.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No eligibility rules apply to the "{selectedScanType}" scan type for this benefit.
                  Worker will be considered eligible by default.
                </p>
              ) : (
                <ul className="space-y-2">
                  {applicableRules.map((rule, index) => (
                    <li key={index} className="text-sm flex items-start gap-2">
                      <Badge variant="outline" className="shrink-0">{getPluginName(rule.pluginKey)}</Badge>
                      <span className="text-muted-foreground">{formatRuleDescription(rule)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleEvaluate}
              disabled={!selectedPolicyId || !selectedBenefitId || evaluateMutation.isPending}
              data-testid="button-evaluate"
            >
              {evaluateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Evaluate Eligibility
            </Button>
          </div>
        </CardContent>
      </Card>

      {eligibilityResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Evaluation Results</CardTitle>
              {eligibilityResult.eligible ? (
                <Badge className="bg-green-500 hover:bg-green-600">
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Eligible
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="h-4 w-4 mr-1" />
                  Not Eligible
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {eligibilityResult.results.length === 0 ? (
              <p className="text-muted-foreground">
                No eligibility rules were evaluated. The worker is eligible by default when no rules
                apply.
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {eligibilityResult.results.length} rule(s) were evaluated.
                </p>
                {eligibilityResult.results.map((result, index) => (
                  <div
                    key={index}
                    className={`p-4 border rounded-md ${
                      result.eligible 
                        ? "border-green-500/50 bg-green-500/10" 
                        : "border-destructive/50 bg-destructive/10"
                    }`}
                    data-testid={`result-plugin-${result.pluginKey}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {result.eligible ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )}
                      <span className="font-medium">{getPluginName(result.pluginKey)}</span>
                      <Badge variant={result.eligible ? "secondary" : "destructive"}>
                        {result.eligible ? "Passed" : "Failed"}
                      </Badge>
                    </div>
                    {result.reason && (
                      <p className="text-sm ml-7">{result.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {evaluateMutation.isError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>
                {evaluateMutation.error instanceof Error
                  ? evaluateMutation.error.message
                  : "An error occurred while evaluating eligibility"}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function WorkerBenefitsEligibility() {
  return (
    <WorkerLayout activeTab="benefits-eligibility">
      <WorkerBenefitsEligibilityContent />
    </WorkerLayout>
  );
}
