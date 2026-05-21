import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Calculator, Search, User, DollarSign, TrendingUp, AlertCircle, Info, Table } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WorkerSearchResult {
  id: string;
  siriusId: number;
  displayName: string;
}

interface WorkerSearchResponse {
  workers: WorkerSearchResult[];
  total: number;
}

interface WorkerPensionSummary {
  workerId: string;
  workerName: string;
  dateOfBirth: string | null;
  totalShares: string;
  totalSla: string;
  currentShareValue: string;
  accumulatedBenefit: string;
  qualifiedYears: number;
  earlyRetirementReasons: string[];
  availableElectionTypes: string[];
}

interface ElectionTypeResult {
  electionType: string;
  label: string;
  benefitType: "monthly" | "lump_sum";
  payoutFactor: string | null;
  aiFactor: string | null;
  finalBenefitAmount: string | null;
  interestRate: string | null;
  interestMonths: number | null;
  interestAmount: string | null;
  finalAmountWithInterest: string | null;
  error: string | null;
}

interface AIYearDetail {
  aiDate: string;
  ageYear: number;
  ageMonth: number;
  interpolatedFactor: number;
  prevInterpolatedFactor: number;
  aiRatio: number;
  aiEarnedAnnuity: number;
  aiEarnedShare: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitEndAnnuity: number;
  accruedBenefitEndShare: number;
}

interface AI705Result {
  applies: boolean;
  seventyHalfYearMonth: string | null;
  mrd: string | null;
  terminationDateTruncated: string | null;
  totalAnnuity: number;
  totalShares: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitAnnuity: number;
  accruedBenefitShare: number;
  accruedBenefitShareValue: number;
  ai705Total: number;
  ai705Source: "annuity" | "share";
  yearDetails: AIYearDetail[];
  breakdown: string[];
}

interface DotToDobcAIResult {
  applies: boolean;
  startDate: string;
  startAge: number;
  endDate: string;
  endAge: number;
  totalAnnuity: number;
  totalShares: number;
  aiRunningTotalAnnuity: number;
  aiRunningTotalShare: number;
  accruedBenefitAnnuity: number;
  accruedBenefitShare: number;
  accruedBenefitShareValue: number;
  dotToDobcTotal: number;
  dotToDobcSource: "annuity" | "share";
  yearDetails: AIYearDetail[];
  breakdown: string[];
}

interface PerYearAccrual {
  year: number;
  plan: string;
  annuity: number;
  shares: number;
}

interface ComputeAllResult {
  workerName: string;
  dateOfBirth: string;
  dobc: string;
  dot: string | null;
  paymentDate: string | null;
  subscriberAge: number;
  spouseDob: string | null;
  beneficiaryAge: number | null;
  totalShares: string;
  currentShareValue: string;
  variableBenefit: string;
  variableBenefitMonthly: string;
  totalSla: string;
  totalSlaMonthly: string;
  accumulatedBenefit: string;
  accumulatedBenefitSource: "variable" | "sla" | "ai705_annuity" | "ai705_share";
  aiFactor: string | null;
  aiFactorDescription: string | null;
  ai705: AI705Result | null;
  dotToDobcAI: DotToDobcAIResult | null;
  perYearAccruals: PerYearAccrual[] | null;
  earlyRetirementFactor: string | null;
  earlyRetirementMonths: number | null;
  earlyRetirementAdjustment: string | null;
  earlyRetirementDescription: string | null;
  lumpSumEligible: boolean;
  results: ElectionTypeResult[];
  breakdown: string[];
}

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

export default function PensionPayoutCalculatorPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState("");
  const [dobc, setDobc] = useState("");
  const [dot, setDot] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [spouseDob, setSpouseDob] = useState("");
  const [earlyRetirementReason, setEarlyRetirementReason] = useState("");
  const [factorYear, setFactorYear] = useState("");
  const [result, setResult] = useState<ComputeAllResult | null>(null);

  const { data: searchResults, isLoading: isSearching } = useQuery<WorkerSearchResponse>({
    queryKey: [`/api/workers/search?q=${encodeURIComponent(searchQuery)}&limit=10`],
    enabled: searchQuery.trim().length >= 2,
  });

  const { data: pensionSummary, isLoading: isSummaryLoading } = useQuery<WorkerPensionSummary>({
    queryKey: ["/api/sitespecific/gbhet/pension/payout-calculator/worker", selectedWorkerId, "summary"],
    queryFn: () => apiRequest("GET", `/api/sitespecific/gbhet/pension/payout-calculator/worker/${selectedWorkerId}/summary`) as Promise<WorkerPensionSummary>,
    enabled: !!selectedWorkerId,
  });

  const computeMutation = useMutation({
    mutationFn: async (params: {
      workerId: string;
      dobc: string;
      dot?: string | null;
      paymentDate?: string | null;
      earlyRetirementReason?: string | null;
      factorYear?: number | null;
      spouseDob?: string | null;
    }) => {
      return await apiRequest("POST", "/api/sitespecific/gbhet/pension/payout-calculator/compute-all", params) as ComputeAllResult;
    },
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error: Error) => {
      toast({
        title: "Calculation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleWorkerSelect = (worker: WorkerSearchResult) => {
    setSelectedWorkerId(worker.id);
    setSelectedWorkerName(worker.displayName);
    setSearchQuery("");
    setResult(null);
  };

  const handleClearWorker = () => {
    setSelectedWorkerId(null);
    setSelectedWorkerName("");
    setResult(null);
    setDobc("");
    setDot("");
    setPaymentDate("");
    setSpouseDob("");
    setEarlyRetirementReason("");
    setFactorYear("");
  };

  const handleCalculate = () => {
    if (!selectedWorkerId || !dobc) return;

    computeMutation.mutate({
      workerId: selectedWorkerId,
      dobc,
      dot: dot || null,
      paymentDate: paymentDate || null,
      earlyRetirementReason: earlyRetirementReason || null,
      factorYear: factorYear ? parseInt(factorYear) : null,
      spouseDob: spouseDob || null,
    });
  };

  const canCalculate = selectedWorkerId && dobc;

  const monthlyResults = result?.results.filter(r => r.benefitType === "monthly") || [];
  const lumpSumResults = result?.results.filter(r => r.benefitType === "lump_sum") || [];

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Calculator className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">VDB Payout Calculator</h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            Compute projected retirement benefits across all election scenarios
          </p>
        </div>
      </div>

      <Card data-testid="card-worker-search">
        <CardHeader>
          <CardTitle className="text-lg">Select Worker</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedWorkerId ? (
            <div className="flex items-center justify-between" data-testid="selected-worker-display">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium" data-testid="text-selected-worker-name">{selectedWorkerName}</p>
                  {pensionSummary?.dateOfBirth && (
                    <p className="text-sm text-muted-foreground" data-testid="text-selected-worker-dob">
                      DOB: {pensionSummary.dateOfBirth}
                    </p>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleClearWorker} data-testid="button-clear-worker">
                Change Worker
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-worker-search"
              />
              {isSearching && searchQuery.trim().length >= 2 && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-md p-2">
                  <Skeleton className="h-8 w-full mb-1" />
                  <Skeleton className="h-8 w-full mb-1" />
                  <Skeleton className="h-8 w-full" />
                </div>
              )}
              {searchResults && searchResults.workers.length > 0 && searchQuery.trim().length >= 2 && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-md max-h-60 overflow-y-auto">
                  {searchResults.workers.map((worker) => (
                    <button
                      key={worker.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center gap-2"
                      onClick={() => handleWorkerSelect(worker)}
                      data-testid={`button-select-worker-${worker.siriusId}`}
                    >
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{worker.displayName}</span>
                      <span className="text-muted-foreground text-sm">#{worker.siriusId}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResults && searchResults.workers.length === 0 && searchQuery.trim().length >= 2 && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-background border rounded-md shadow-md p-3 text-center text-muted-foreground text-sm">
                  No workers found
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWorkerId && (
        <>
          {isSummaryLoading ? (
            <Card>
              <CardContent className="pt-6">
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ) : pensionSummary ? (
            <Card data-testid="card-pension-summary">
              <CardHeader>
                <CardTitle className="text-lg">Pension Summary</CardTitle>
                <CardDescription>Current accumulated pension data for {pensionSummary.workerName}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1" data-testid="summary-total-shares">
                    <p className="text-sm text-muted-foreground">Total Shares</p>
                    <p className="text-lg font-semibold">{parseFloat(pensionSummary.totalShares).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</p>
                  </div>
                  <div className="space-y-1" data-testid="summary-share-value">
                    <p className="text-sm text-muted-foreground">Share Value</p>
                    <p className="text-lg font-semibold">{formatCurrency(pensionSummary.currentShareValue)}</p>
                  </div>
                  <div className="space-y-1" data-testid="summary-accumulated-benefit">
                    <p className="text-sm text-muted-foreground">Accumulated Benefit</p>
                    <p className="text-lg font-semibold text-primary">{formatCurrency(pensionSummary.accumulatedBenefit)}</p>
                  </div>
                  <div className="space-y-1" data-testid="summary-qualified-years">
                    <p className="text-sm text-muted-foreground">Qualified Years</p>
                    <p className="text-lg font-semibold">{pensionSummary.qualifiedYears}</p>
                  </div>
                </div>
                {parseFloat(pensionSummary.totalSla) > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm text-muted-foreground">Total SLA: <span className="font-medium text-foreground">{formatCurrency(pensionSummary.totalSla)}</span></p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card data-testid="card-calculator-form">
            <CardHeader>
              <CardTitle className="text-lg">Calculator Inputs</CardTitle>
              <CardDescription>Configure benefit scenario parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dobc">Date of Benefit Commencement (DoBC)</Label>
                  <Input
                    id="dobc"
                    type="date"
                    value={dobc}
                    onChange={(e) => { setDobc(e.target.value); setResult(null); }}
                    data-testid="input-dobc"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="dot">Date of Termination (DoT)</Label>
                  <Input
                    id="dot"
                    type="date"
                    value={dot}
                    onChange={(e) => { setDot(e.target.value); setResult(null); }}
                    data-testid="input-dot"
                  />
                  <p className="text-xs text-muted-foreground">Optional. Used for DoT-to-DoBC actuarial increase calculation.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payment-date">Payment Date</Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentDate}
                    onChange={(e) => { setPaymentDate(e.target.value); setResult(null); }}
                    data-testid="input-payment-date"
                  />
                  <p className="text-xs text-muted-foreground">Optional. Used for lump sum interest calculation (DoBC to Payment Date).</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="spouse-dob">Spouse's Date of Birth</Label>
                  <Input
                    id="spouse-dob"
                    type="date"
                    value={spouseDob}
                    onChange={(e) => { setSpouseDob(e.target.value); setResult(null); }}
                    data-testid="input-spouse-dob"
                  />
                  <p className="text-xs text-muted-foreground">Optional. When provided, Joint & Survivor options are included.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="early-retirement">Early Retirement Reason (optional)</Label>
                  <Select
                    value={earlyRetirementReason}
                    onValueChange={(v) => { setEarlyRetirementReason(v === "none" ? "" : v); setResult(null); }}
                  >
                    <SelectTrigger id="early-retirement" data-testid="select-early-retirement">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" data-testid="option-early-retirement-none">None</SelectItem>
                      {pensionSummary?.earlyRetirementReasons.map((reason) => (
                        <SelectItem key={reason} value={reason} data-testid={`option-early-retirement-${reason}`}>
                          {reason}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="factor-year">Factor Year (optional)</Label>
                  <Input
                    id="factor-year"
                    type="number"
                    min={2000}
                    max={2100}
                    value={factorYear}
                    onChange={(e) => { setFactorYear(e.target.value); setResult(null); }}
                    placeholder="Defaults to DoBC year"
                    data-testid="input-factor-year"
                  />
                  <p className="text-xs text-muted-foreground">Used for lump sum factor lookups. Leave blank to use DoBC year.</p>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  onClick={handleCalculate}
                  disabled={!canCalculate || computeMutation.isPending}
                  size="lg"
                  data-testid="button-calculate"
                >
                  {computeMutation.isPending ? (
                    <>Calculating...</>
                  ) : (
                    <>
                      <Calculator className="h-4 w-4 mr-2" />
                      Calculate All Benefits
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {result && (
            <>
              <Card data-testid="card-shared-breakdown" className="border-primary/30">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Benefit Summary
                  </CardTitle>
                  <CardDescription>
                    Benefit projection for {result.workerName}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="result-breakdown-table">
                    <div className="text-muted-foreground">Worker</div>
                    <div className="font-medium">{result.workerName}</div>

                    <div className="text-muted-foreground">Date of Birth</div>
                    <div className="font-medium">{result.dateOfBirth}</div>

                    <div className="text-muted-foreground">Date of Benefit Commencement (DoBC)</div>
                    <div className="font-medium">{result.dobc}</div>

                    <div className="text-muted-foreground">Age at DoBC</div>
                    <div className="font-medium">{result.subscriberAge}</div>

                    {result.dot && (
                      <>
                        <div className="text-muted-foreground">Date of Termination (DoT)</div>
                        <div className="font-medium">{result.dot}</div>
                      </>
                    )}

                    {result.paymentDate && (
                      <>
                        <div className="text-muted-foreground">Payment Date</div>
                        <div className="font-medium">{result.paymentDate}</div>
                      </>
                    )}

                    {result.spouseDob && (
                      <>
                        <div className="text-muted-foreground">Spouse's Date of Birth</div>
                        <div className="font-medium">{result.spouseDob}</div>

                        <div className="text-muted-foreground">Beneficiary Age at DoBC</div>
                        <div className="font-medium">{result.beneficiaryAge}</div>
                      </>
                    )}

                    <div className="col-span-2">
                      <Separator className="my-2" />
                    </div>

                    <div className="text-muted-foreground">Total Shares</div>
                    <div className="font-medium">{parseFloat(result.totalShares).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>

                    <div className="text-muted-foreground">Share Value</div>
                    <div className="font-medium">{formatCurrency(result.currentShareValue)}</div>

                    <div className="text-muted-foreground">Variable Benefit (annual)</div>
                    <div className="font-medium">{formatCurrency(result.variableBenefit)}</div>

                    <div className="text-muted-foreground">SLA Floor Benefit (annual)</div>
                    <div className="font-medium">{formatCurrency(result.totalSla)}</div>

                    <div className="text-muted-foreground">Accumulated Benefit (annual)</div>
                    <div className="font-medium text-primary">
                      {formatCurrency(result.accumulatedBenefit)}
                      {" "}
                      <span className="text-xs text-muted-foreground">
                        ({result.accumulatedBenefitSource === "sla" ? "SLA floor used"
                          : result.accumulatedBenefitSource === "ai705_annuity" ? "70.5 AI, annuity used"
                          : result.accumulatedBenefitSource === "ai705_share" ? "70.5 AI, share value used"
                          : "variable benefit used"})
                      </span>
                    </div>

                    {result.aiFactor && (
                      <>
                        <div className="col-span-2">
                          <Separator className="my-2" />
                        </div>
                        <div className="text-muted-foreground">AI Factor</div>
                        <div className="font-medium">{result.aiFactor}</div>
                      </>
                    )}

                    {result.earlyRetirementAdjustment && (
                      <>
                        <div className="text-muted-foreground">Early Retirement</div>
                        <div className="font-medium">
                          {result.earlyRetirementMonths} months x {result.earlyRetirementFactor}/mo = {result.earlyRetirementAdjustment} factor
                        </div>
                      </>
                    )}

                    {result.lumpSumEligible !== undefined && (
                      <>
                        <div className="col-span-2">
                          <Separator className="my-2" />
                        </div>
                        <div className="text-muted-foreground">Lump Sum Eligible</div>
                        <div className="font-medium">
                          {result.lumpSumEligible ? (
                            <Badge variant="default" data-testid="badge-lump-eligible">Yes (monthly life ≤ $100)</Badge>
                          ) : (
                            <Badge variant="secondary" data-testid="badge-lump-ineligible">No (monthly life &gt; $100)</Badge>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {result.ai705?.applies && (
                <Card data-testid="card-ai705-breakdown" className="border-amber-500/30">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-amber-600" />
                      70.5 Actuarial Increase
                    </CardTitle>
                    <CardDescription>
                      Post-70.5 actuarial increases applied from MRD through {result.dot ? "DoT" : "DoBC"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="ai705-summary">
                      <div className="text-muted-foreground">70.5 Year-Month</div>
                      <div className="font-medium">{result.ai705.seventyHalfYearMonth}</div>

                      <div className="text-muted-foreground">Mandatory Retirement Date</div>
                      <div className="font-medium">{result.ai705.mrd}</div>

                      <div className="text-muted-foreground">End Date (Truncated)</div>
                      <div className="font-medium">{result.ai705.terminationDateTruncated}</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">Base Annuity Total (annual)</div>
                      <div className="font-medium">{formatCurrency(result.ai705.totalAnnuity)}</div>

                      <div className="text-muted-foreground">Base Shares Total</div>
                      <div className="font-medium">{result.ai705.totalShares.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">AI Running Total (Annuity)</div>
                      <div className="font-medium">{formatCurrency(result.ai705.aiRunningTotalAnnuity)}</div>

                      <div className="text-muted-foreground">AI Running Total (Shares)</div>
                      <div className="font-medium">{result.ai705.aiRunningTotalShare.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">Accrued Benefit (Annuity)</div>
                      <div className="font-medium">{formatCurrency(result.ai705.accruedBenefitAnnuity)}</div>

                      <div className="text-muted-foreground">Accrued Benefit (Shares x Value)</div>
                      <div className="font-medium">{formatCurrency(result.ai705.accruedBenefitShareValue)}</div>

                      <div className="text-muted-foreground">AI 70.5 Total</div>
                      <div className="font-medium text-primary">
                        {formatCurrency(result.ai705.ai705Total)}
                        {" "}
                        <span className="text-xs text-muted-foreground">
                          ({result.ai705.ai705Source === "annuity" ? "annuity used" : "share value used"})
                        </span>
                      </div>
                    </div>

                    {result.ai705.yearDetails.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h4 className="font-medium mb-2 text-sm">Year-by-Year AI Calculation</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs" data-testid="table-ai705-details">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1.5 pr-2 font-medium text-muted-foreground">AI Date</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Age</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Interp. Factor</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Ratio</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Annuity</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Shares</th>
                                  <th className="text-right py-1.5 pl-2 font-medium text-muted-foreground">Accrued (Ann.)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {result.ai705.yearDetails.map((d, i) => (
                                  <tr key={i} className="border-b last:border-0" data-testid={`row-ai705-${i}`}>
                                    <td className="py-1.5 pr-2 font-mono">{d.aiDate}</td>
                                    <td className="py-1.5 px-2 text-right">{d.ageYear}y {d.ageMonth}m</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{d.interpolatedFactor.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{d.aiRatio.toFixed(6)}</td>
                                    <td className="py-1.5 px-2 text-right">{formatCurrency(d.aiEarnedAnnuity)}</td>
                                    <td className="py-1.5 px-2 text-right">{d.aiEarnedShare.toFixed(6)}</td>
                                    <td className="py-1.5 pl-2 text-right font-medium">{formatCurrency(d.accruedBenefitEndAnnuity)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {result.dotToDobcAI?.applies && (
                <Card data-testid="card-dot-dobc-ai-breakdown" className="border-blue-500/30">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                      DoT-to-DoBC Actuarial Increase
                    </CardTitle>
                    <CardDescription>
                      Single-period actuarial increase from DoT ({result.dotToDobcAI.startDate}, age {result.dotToDobcAI.startAge}) to DoBC ({result.dotToDobcAI.endDate}, age {result.dotToDobcAI.endAge})
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-testid="dot-dobc-ai-summary">
                      <div className="text-muted-foreground">Start Date</div>
                      <div className="font-medium">{result.dotToDobcAI.startDate} (age {result.dotToDobcAI.startAge})</div>

                      <div className="text-muted-foreground">End Date</div>
                      <div className="font-medium">{result.dotToDobcAI.endDate} (age {result.dotToDobcAI.endAge})</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">Input Annuity</div>
                      <div className="font-medium">{formatCurrency(result.dotToDobcAI.totalAnnuity)}</div>

                      <div className="text-muted-foreground">Input Shares</div>
                      <div className="font-medium">{result.dotToDobcAI.totalShares.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">AI Earned (Annuity)</div>
                      <div className="font-medium">{formatCurrency(result.dotToDobcAI.aiRunningTotalAnnuity)}</div>

                      <div className="text-muted-foreground">AI Earned (Shares)</div>
                      <div className="font-medium">{result.dotToDobcAI.aiRunningTotalShare.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>

                      <div className="col-span-2">
                        <Separator className="my-2" />
                      </div>

                      <div className="text-muted-foreground">Accrued Benefit (Annuity)</div>
                      <div className="font-medium">{formatCurrency(result.dotToDobcAI.accruedBenefitAnnuity)}</div>

                      <div className="text-muted-foreground">Accrued Benefit (Shares x Value)</div>
                      <div className="font-medium">{formatCurrency(result.dotToDobcAI.accruedBenefitShareValue)}</div>

                      <div className="text-muted-foreground">DoT-to-DoBC AI Total</div>
                      <div className="font-medium text-primary">
                        {formatCurrency(result.dotToDobcAI.dotToDobcTotal)}
                        {" "}
                        <span className="text-xs text-muted-foreground">
                          ({result.dotToDobcAI.dotToDobcSource === "annuity" ? "annuity used" : "share value used"})
                        </span>
                      </div>
                    </div>

                    {result.dotToDobcAI.yearDetails.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <h4 className="font-medium mb-2 text-sm">Single-Period AI Calculation</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs" data-testid="table-dot-dobc-ai-details">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-1.5 pr-2 font-medium text-muted-foreground">DoBC Date</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Age</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">DoBC Factor</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Ratio</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Annuity</th>
                                  <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">AI Shares</th>
                                  <th className="text-right py-1.5 pl-2 font-medium text-muted-foreground">Accrued (Ann.)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {result.dotToDobcAI.yearDetails.map((d, i) => (
                                  <tr key={i} className="border-b last:border-0" data-testid={`row-dot-dobc-ai-${i}`}>
                                    <td className="py-1.5 pr-2 font-mono">{d.aiDate}</td>
                                    <td className="py-1.5 px-2 text-right">{d.ageYear}y {d.ageMonth}m</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{d.interpolatedFactor.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{d.aiRatio.toFixed(6)}</td>
                                    <td className="py-1.5 px-2 text-right">{formatCurrency(d.aiEarnedAnnuity)}</td>
                                    <td className="py-1.5 px-2 text-right">{d.aiEarnedShare.toFixed(6)}</td>
                                    <td className="py-1.5 pl-2 text-right font-medium">{formatCurrency(d.accruedBenefitEndAnnuity)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {monthlyResults.length > 0 && (
                <Card data-testid="card-monthly-results">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      Monthly Benefit Options
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-monthly-results">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Election Type</th>
                            <th className="text-right py-2 px-4 font-medium text-muted-foreground">Payout Factor</th>
                            <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Monthly Benefit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyResults.map((r) => (
                            <tr key={r.electionType} className="border-b last:border-0" data-testid={`row-result-${r.electionType}`}>
                              <td className="py-3 pr-4">
                                <div className="font-medium">{r.label}</div>
                              </td>
                              {r.error ? (
                                <td colSpan={2} className="py-3 pl-4 text-right">
                                  <span className="text-muted-foreground text-xs">{r.error}</span>
                                </td>
                              ) : (
                                <>
                                  <td className="py-3 px-4 text-right text-muted-foreground">{r.payoutFactor}</td>
                                  <td className="py-3 pl-4 text-right font-semibold text-primary text-base">
                                    {formatCurrency(r.finalBenefitAmount!)}
                                    <span className="text-xs text-muted-foreground font-normal ml-1">/mo</span>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {lumpSumResults.length > 0 && (
                <Card data-testid="card-lumpsum-results">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Table className="h-5 w-5 text-primary" />
                      Lump Sum Options
                    </CardTitle>
                    {!result.lumpSumEligible && (
                      <CardDescription className="text-amber-600">
                        Lump sum not eligible — monthly life benefit exceeds $100
                      </CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-lumpsum-results">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Election Type</th>
                            <th className="text-right py-2 px-4 font-medium text-muted-foreground">Payout Factor</th>
                            <th className="text-right py-2 px-4 font-medium text-muted-foreground">Lump Sum</th>
                            {lumpSumResults.some(r => r.interestAmount != null) && (
                              <>
                                <th className="text-right py-2 px-4 font-medium text-muted-foreground">Interest</th>
                                <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Total w/ Interest</th>
                              </>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {lumpSumResults.map((r) => (
                            <tr key={r.electionType} className="border-b last:border-0" data-testid={`row-result-${r.electionType}`}>
                              <td className="py-3 pr-4">
                                <div className="font-medium">{r.label}</div>
                              </td>
                              {r.error ? (
                                <td colSpan={lumpSumResults.some(lr => lr.interestAmount != null) ? 4 : 2} className="py-3 pl-4 text-right">
                                  <span className="text-muted-foreground text-xs">{r.error}</span>
                                </td>
                              ) : (
                                <>
                                  <td className="py-3 px-4 text-right text-muted-foreground">{r.payoutFactor}</td>
                                  <td className="py-3 px-4 text-right font-semibold text-primary text-base">
                                    {formatCurrency(r.finalBenefitAmount!)}
                                  </td>
                                  {lumpSumResults.some(lr => lr.interestAmount != null) && (
                                    <>
                                      <td className="py-3 px-4 text-right text-muted-foreground">
                                        {r.interestAmount != null ? (
                                          <span>
                                            {formatCurrency(r.interestAmount)}
                                            <span className="text-xs block">
                                              ({r.interestMonths} mo)
                                            </span>
                                          </span>
                                        ) : "—"}
                                      </td>
                                      <td className="py-3 pl-4 text-right font-semibold text-primary text-base">
                                        {r.finalAmountWithInterest != null ? formatCurrency(r.finalAmountWithInterest) : "—"}
                                      </td>
                                    </>
                                  )}
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card data-testid="card-breakdown-steps">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    Step-by-Step Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1" data-testid="result-steps">
                    {result.breakdown.map((step, i) => (
                      <div key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <span className="text-primary font-mono text-xs mt-0.5">{i + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {computeMutation.isError && !result && (
            <Card className="border-destructive/30" data-testid="card-error">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p>{computeMutation.error?.message || "Calculation failed"}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
