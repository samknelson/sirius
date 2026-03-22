import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, CheckCircle2, XCircle, AlertCircle, User } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "wouter";

interface PluginCheckResult {
  pluginId: string;
  pluginName: string;
  passed: boolean;
  explanation: string;
  condition: {
    category: string;
    type: string;
    value: string;
  } | null;
}

interface WorkerEligibilityCheckResult {
  workerId: string;
  workerName: string;
  workerSiriusId: number;
  isEligible: boolean;
  seniorityPosition: number | null;
  totalEligible: number | null;
  pluginResults: PluginCheckResult[];
}

interface WorkerSearchResult {
  id: string;
  siriusId: number;
  displayName: string;
}

interface WorkerSearchResponse {
  workers: WorkerSearchResult[];
  total: number;
}

function EligibleWorkersCheckContent() {
  const { job } = useDispatchJobLayout();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  const { data: searchResults, isLoading: isSearching } = useQuery<WorkerSearchResponse>({
    queryKey: [`/api/workers/search?q=${encodeURIComponent(searchQuery)}&limit=10`],
    enabled: searchQuery.trim().length >= 2,
  });

  const { data: eligibilityResult, isLoading: isCheckingEligibility } = useQuery<WorkerEligibilityCheckResult>({
    queryKey: ['/api/dispatch-jobs', job.id, 'check-eligibility', selectedWorkerId],
    enabled: !!selectedWorkerId,
    staleTime: 0,
  });

  const handleWorkerSelect = (workerId: string) => {
    setSelectedWorkerId(workerId);
    setSearchQuery("");
  };

  const handleClearSelection = () => {
    setSelectedWorkerId(null);
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-worker-search">
        <CardHeader>
          <CardTitle data-testid="text-search-title">Check Worker Eligibility</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4" data-testid="text-search-description">
            Search for a worker by name or ID to check their eligibility for this job.
          </p>
          
          {!selectedWorkerId ? (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search by worker name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-worker-search"
              />
              
              {searchQuery.trim().length >= 2 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg max-h-60 overflow-auto" data-testid="dropdown-search-results">
                  {isSearching ? (
                    <div className="p-4">
                      <Skeleton className="h-4 w-full mb-2" />
                      <Skeleton className="h-4 w-3/4" />
                    </div>
                  ) : searchResults?.workers && searchResults.workers.length > 0 ? (
                    searchResults.workers.map((worker) => (
                      <Button
                        key={worker.id}
                        variant="ghost"
                        className="w-full justify-start gap-2"
                        onClick={() => handleWorkerSelect(worker.id)}
                        data-testid={`button-select-worker-${worker.id}`}
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span>{worker.displayName}</span>
                        <span className="text-muted-foreground text-sm">#{worker.siriusId}</span>
                      </Button>
                    ))
                  ) : (
                    <div className="p-4 text-muted-foreground text-center" data-testid="text-no-results">
                      No workers found
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-md" data-testid="selected-worker-display">
              <User className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <span className="font-medium" data-testid="text-selected-worker-name">
                  {eligibilityResult?.workerName || "Loading..."}
                </span>
                {eligibilityResult && (
                  <span className="text-muted-foreground text-sm ml-2" data-testid="text-selected-worker-id">
                    #{eligibilityResult.workerSiriusId}
                  </span>
                )}
              </div>
              <Link href={`/workers/${selectedWorkerId}`}>
                <Button variant="outline" size="sm" data-testid="button-view-worker">
                  View Worker
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleClearSelection} data-testid="button-clear-selection">
                Clear
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedWorkerId && (
        <Card data-testid="card-eligibility-result">
          <CardHeader>
            <CardTitle data-testid="text-result-title">Eligibility Result</CardTitle>
          </CardHeader>
          <CardContent>
            {isCheckingEligibility ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : eligibilityResult ? (
              <div className="space-y-6">
                <div 
                  className={`flex items-center gap-4 p-4 rounded-lg ${
                    eligibilityResult.isEligible 
                      ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800" 
                      : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
                  }`}
                  data-testid="eligibility-summary"
                >
                  {eligibilityResult.isEligible ? (
                    <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                  )}
                  <div>
                    <p className="font-medium text-lg" data-testid="text-eligibility-status">
                      {eligibilityResult.isEligible ? (
                        <>
                          <Link href={`/workers/${eligibilityResult.workerId}`}>
                            <span className="text-foreground hover:underline cursor-pointer" data-testid="link-worker-name">
                              {eligibilityResult.workerName}
                            </span>
                          </Link>
                          {" "}is eligible to be dispatched to this job
                        </>
                      ) : (
                        <>
                          <Link href={`/workers/${eligibilityResult.workerId}`}>
                            <span className="text-foreground hover:underline cursor-pointer" data-testid="link-worker-name">
                              {eligibilityResult.workerName}
                            </span>
                          </Link>
                          {" "}is not eligible for this job
                        </>
                      )}
                    </p>
                    {eligibilityResult.isEligible && eligibilityResult.seniorityPosition !== null && (
                      <p className="text-muted-foreground" data-testid="text-seniority-position">
                        Position {eligibilityResult.seniorityPosition} of {eligibilityResult.totalEligible} in the seniority list
                      </p>
                    )}
                    {!eligibilityResult.isEligible && (
                      <p className="text-muted-foreground" data-testid="text-failure-count">
                        {eligibilityResult.pluginResults.filter(r => !r.passed).length} eligibility check(s) failed
                      </p>
                    )}
                  </div>
                </div>

                {eligibilityResult.pluginResults.length > 0 ? (
                  <div>
                    <h4 className="font-medium mb-3" data-testid="text-plugin-results-heading">
                      Eligibility Plugin Results
                    </h4>
                    <Table data-testid="table-plugin-results">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Status</TableHead>
                          <TableHead>Plugin</TableHead>
                          <TableHead>Explanation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {eligibilityResult.pluginResults.map((result) => (
                          <TableRow key={result.pluginId} data-testid={`row-plugin-${result.pluginId}`}>
                            <TableCell data-testid={`status-${result.pluginId}`}>
                              {result.passed ? (
                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" data-testid={`badge-pass-${result.pluginId}`}>
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Pass
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" data-testid={`badge-fail-${result.pluginId}`}>
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Fail
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-medium" data-testid={`text-plugin-name-${result.pluginId}`}>
                              {result.pluginName}
                            </TableCell>
                            <TableCell className="text-muted-foreground" data-testid={`text-plugin-explanation-${result.pluginId}`}>
                              {result.explanation}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 p-4 bg-muted rounded-lg" data-testid="no-plugins-message">
                    <AlertCircle className="h-5 w-5 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      No eligibility plugins are configured for this job type.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-error-message">
                Failed to check eligibility. Please try again.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DispatchJobEligibleWorkersCheckPage() {
  return (
    <DispatchJobLayout activeTab="eligible-workers-check">
      <EligibleWorkersCheckContent />
    </DispatchJobLayout>
  );
}
