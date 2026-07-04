import { pluginManifestQueryKey, pluginSearch } from "@/plugins/_core";
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
import { Loader2, CheckCircle2, XCircle, AlertCircle, AlertTriangle, Play } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PolicyData {
  benefitIds?: string[];
}

interface EligibilityRule {
  pluginKey: string;
  appliesTo: ("start" | "continue")[];
  config: Record<string, unknown>;
}

/**
 * Flat (hydrated) trust-eligibility config envelope returned by `pluginSearch`.
 * `data` carries the rule config including the authoritative `appliesTo` array.
 */
interface EligibilityConfigRow {
  id: string;
  pluginId: string;
  data: Record<string, unknown> | null;
  benefit: string | null;
}

interface EligibilityPluginResult {
  pluginKey: string;
  eligible: boolean;
  reason?: string;
  warning?: string;
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

interface WorkerRelationOption {
  id: string;
  worker1: string;
  worker2: string;
  role: "worker_1" | "worker_2";
  isActive: boolean;
  startYmd: string | null;
  endYmd: string | null;
  relationType: string;
  relationTypeName: string | null;
  otherWorker: {
    id: string;
    siriusId: number | null;
    displayName: string | null;
    given: string | null;
    family: string | null;
  } | null;
}

const NO_DEPENDENT = "__none__";
const USE_RESOLVED_EMPLOYER = "__resolved__";

interface EmployerOption {
  id: string;
  name: string;
}

function lastDayOfMonthIso(year: number, month: number): string {
  const d = new Date(year, month, 0);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

function workerLabel(other: WorkerRelationOption["otherWorker"]): string {
  if (!other) return "(unknown worker)";
  return (
    other.displayName ||
    [other.given, other.family].filter(Boolean).join(" ") ||
    other.id
  );
}

function WorkerBenefitsEligibilityContent() {
  const { worker, contact } = useWorkerLayout();
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
  const [selectedBenefitId, setSelectedBenefitId] = useState<string>("");
  const [selectedScanType, setSelectedScanType] = useState<"start" | "continue">("start");
  const [selectedDependentId, setSelectedDependentId] = useState<string>(NO_DEPENDENT);
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>(USE_RESOLVED_EMPLOYER);
  const [evaluatedSubscriberName, setEvaluatedSubscriberName] = useState<string | null>(null);
  const [evaluatedDependentName, setEvaluatedDependentName] = useState<string | null>(null);
  const [eligibilityResult, setEligibilityResult] = useState<BenefitEligibilityResult | null>(null);

  const asOfDateIso = lastDayOfMonthIso(parseInt(selectedYear), parseInt(selectedMonth));

  const subscriberName =
    contact?.displayName ||
    [contact?.given, contact?.family].filter(Boolean).join(" ") ||
    worker.id;

  const { data: dependentRelations = [] } = useQuery<WorkerRelationOption[]>({
    queryKey: [
      "/api/workers",
      worker.id,
      "relations",
      { role: "worker_1", activeAt: asOfDateIso },
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        role: "worker_1",
        activeAt: asOfDateIso,
      });
      const res = await fetch(
        `/api/workers/${worker.id}/relations?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Failed to fetch relations");
      return res.json();
    },
  });

  // Drop the picked dependent if the new as-of date no longer has an
  // active relationship for them — keeps the picker honest.
  useEffect(() => {
    if (selectedDependentId === NO_DEPENDENT) return;
    const stillValid = dependentRelations.some(
      (r) => r.otherWorker?.id === selectedDependentId,
    );
    if (!stillValid) {
      setSelectedDependentId(NO_DEPENDENT);
      setEligibilityResult(null);
    }
  }, [dependentRelations, selectedDependentId]);

  const { data: policies = [] } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const { data: allBenefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const { data: plugins = [] } = useQuery<EligibilityPlugin[]>({
    queryKey: pluginManifestQueryKey("trust-eligibility"),
  });

  const { data: workStatuses = [] } = useQuery<WorkerWs[]>({
    queryKey: ["/api/options/worker-ws"],
  });

  const { data: homeEmployer } = useQuery<Employer>({
    queryKey: ["/api/employers", worker.denormHomeEmployerId],
    enabled: !!worker.denormHomeEmployerId,
  });

  const { data: employerOptions = [] } = useQuery<EmployerOption[]>({
    queryKey: ["/api/employers/lookup"],
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

  // Eligibility rules live in the unified plugin_configs table; load the rows
  // for the selected policy + benefit (ordered by the dispatcher).
  const { data: benefitRuleRows = [] } = useQuery<EligibilityConfigRow[]>({
    queryKey: [
      "/api/plugins/trust-eligibility/configs/search",
      selectedPolicyId,
      selectedBenefitId,
    ],
    queryFn: () =>
      pluginSearch<"trust-eligibility", EligibilityConfigRow>("trust-eligibility", {
        policy: selectedPolicyId,
        benefit: selectedBenefitId,
      }),
    enabled: !!selectedPolicyId && !!selectedBenefitId,
  });

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        workerId: worker.id,
        benefitId: selectedBenefitId,
        policyId: selectedPolicyId,
        scanType: selectedScanType,
        asOfMonth: parseInt(selectedMonth),
        asOfYear: parseInt(selectedYear),
        stopAfterIneligible: false,
      };
      if (selectedDependentId !== NO_DEPENDENT) {
        body.relationship = { dependentWorkerId: selectedDependentId };
      }
      if (selectedEmployerId !== USE_RESOLVED_EMPLOYER) {
        body.employerId = selectedEmployerId;
      }
      return apiRequest("POST", "/api/eligibility/evaluate", body);
    },
    onSuccess: (data) => {
      setEligibilityResult(data as BenefitEligibilityResult);
      setEvaluatedSubscriberName(subscriberName);
      if (selectedDependentId === NO_DEPENDENT) {
        setEvaluatedDependentName(null);
      } else {
        const rel = dependentRelations.find(
          (r) => r.otherWorker?.id === selectedDependentId,
        );
        setEvaluatedDependentName(
          rel ? workerLabel(rel.otherWorker) : selectedDependentId,
        );
      }
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

  const selectedBenefitRules: EligibilityRule[] = benefitRuleRows.map((row) => {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const appliesTo = Array.isArray(data.appliesTo)
      ? (data.appliesTo as ("start" | "continue")[])
      : [];
    return { pluginKey: row.pluginId, appliesTo, config: data };
  });
  const applicableRules = selectedBenefitRules.filter((r) => r.appliesTo.includes(selectedScanType));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Eligibility Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Test eligibility from <span className="font-medium">{subscriberName}</span>'s point of
            view as the subscriber. Leave the dependent picker on "None" to test this worker's own
            eligibility, or pick one of their dependents to test that dependent under this
            subscriber.
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

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="dependent">Dependent (optional)</Label>
              <Select
                value={selectedDependentId}
                onValueChange={(value) => {
                  setSelectedDependentId(value);
                  setEligibilityResult(null);
                }}
              >
                <SelectTrigger id="dependent" data-testid="select-dependent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DEPENDENT}>
                    None (test {subscriberName} themselves)
                  </SelectItem>
                  {dependentRelations
                    .filter((r) => r.otherWorker)
                    .map((r) => (
                      <SelectItem
                        key={r.id}
                        value={r.otherWorker!.id}
                        data-testid={`option-dependent-${r.otherWorker!.id}`}
                      >
                        {workerLabel(r.otherWorker)}
                        {r.relationTypeName ? ` — ${r.relationTypeName}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only dependents with an active relationship as of {selectedMonth}/
                {selectedYear} are listed.
                {dependentRelations.length === 0 &&
                  " This worker has no active dependents on that date."}
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="employer">Employer (optional)</Label>
              <Select
                value={selectedEmployerId}
                onValueChange={(value) => {
                  setSelectedEmployerId(value);
                  setEligibilityResult(null);
                }}
              >
                <SelectTrigger id="employer" data-testid="select-employer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USE_RESOLVED_EMPLOYER}>
                    Use the subscriber's active election employer
                  </SelectItem>
                  {employerOptions.map((emp) => (
                    <SelectItem
                      key={emp.id}
                      value={emp.id}
                      data-testid={`option-employer-${emp.id}`}
                    >
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Leave on the default to use the employer from the subscriber's
                active trust election. Pick an employer to evaluate as if the
                subscriber belonged to it.
              </p>
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
              <div>
                <CardTitle>Evaluation Results</CardTitle>
                <p
                  className="text-xs text-muted-foreground mt-1"
                  data-testid="text-evaluated-context"
                >
                  Tested with{" "}
                  <span className="font-medium">
                    {evaluatedSubscriberName ?? subscriberName}
                  </span>{" "}
                  as subscriber
                  {evaluatedDependentName && (
                    <>
                      {" "}for dependent{" "}
                      <span className="font-medium">{evaluatedDependentName}</span>
                    </>
                  )}
                  .
                </p>
              </div>
              {(() => {
                const hasWarnings = eligibilityResult.results.some(
                  (r) => r.eligible && r.warning,
                );
                if (!eligibilityResult.eligible) {
                  return (
                    <Badge variant="destructive" data-testid="badge-overall-status">
                      <XCircle className="h-4 w-4 mr-1" />
                      Not Eligible
                    </Badge>
                  );
                }
                if (hasWarnings) {
                  return (
                    <Badge
                      className="bg-yellow-500 hover:bg-yellow-600 text-black"
                      data-testid="badge-overall-status"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Eligible with warnings
                    </Badge>
                  );
                }
                return (
                  <Badge
                    className="bg-green-500 hover:bg-green-600"
                    data-testid="badge-overall-status"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Eligible
                  </Badge>
                );
              })()}
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
                {eligibilityResult.results.map((result, index) => {
                  const hasWarning = result.eligible && !!result.warning;
                  const containerClass = !result.eligible
                    ? "border-destructive/50 bg-destructive/10"
                    : hasWarning
                    ? "border-yellow-500/50 bg-yellow-500/10"
                    : "border-green-500/50 bg-green-500/10";
                  return (
                    <div
                      key={index}
                      className={`p-4 border rounded-md ${containerClass}`}
                      data-testid={`result-plugin-${result.pluginKey}`}
                      data-state={
                        !result.eligible
                          ? "failed"
                          : hasWarning
                          ? "warning"
                          : "passed"
                      }
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {!result.eligible ? (
                          <XCircle className="h-5 w-5 text-destructive" />
                        ) : hasWarning ? (
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                        ) : (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        )}
                        <span className="font-medium">{getPluginName(result.pluginKey)}</span>
                        {!result.eligible ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : hasWarning ? (
                          <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">
                            Warning
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Passed</Badge>
                        )}
                      </div>
                      {hasWarning ? (
                        <p
                          className="text-sm ml-7 text-yellow-700 dark:text-yellow-400"
                          data-testid={`text-warning-${result.pluginKey}`}
                        >
                          {result.warning}
                        </p>
                      ) : (
                        result.reason && (
                          <p className="text-sm ml-7">{result.reason}</p>
                        )
                      )}
                    </div>
                  );
                })}
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
